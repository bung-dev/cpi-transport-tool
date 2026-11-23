package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.job.TransportRun;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.settings.SettingsService;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class TransportService {
    private static final Logger log = LoggerFactory.getLogger(TransportService.class);
    static final String LOCK_HINT = "대상 테넌트에서 이 아티팩트가 편집 중(잠김)일 수 있습니다. CPI 화면에서 편집을 저장하거나 취소한 뒤 다시 시도하세요.";
    private final CpiApiClient api;
    private final ConfigurationCopier configurations;
    private final DeployService deployment;
    private final Clock clock;
    private final Supplier<ConcurrencySettings> settings;

    public TransportService(CpiApiClient api, ConfigurationCopier configurations,
                            DeployService deployment, Clock clock) {
        this(api, configurations, deployment, clock, () -> new ConcurrencySettings(1, 1));
    }

    @Autowired
    TransportService(CpiApiClient api, ConfigurationCopier configurations,
                     DeployService deployment, Clock clock, SettingsService settings) {
        this(api, configurations, deployment, clock, settings::current);
    }

    public TransportService(CpiApiClient api, ConfigurationCopier configurations,
                            DeployService deployment, Clock clock, Supplier<ConcurrencySettings> settings) {
        this.settings = settings;
        this.api = api;
        this.configurations = configurations;
        this.deployment = deployment;
        this.clock = clock;
    }

    private record SourcePackage(PackageSelection selection, CpiPackage metadata, List<CpiArtifact> artifacts) {
        List<String> artifactIds() {
            var selected = selection.artifactIds();
            return selected == null || selected.isEmpty() ? artifacts.stream().map(CpiArtifact::id).toList() : selected;
        }
    }
    private record TargetPackage(TargetPackageStatus status, ArtifactError error) {}

    public TransportResponse execute(TransportRequest request) {
        int limit = concurrency(request);
        var sources = new ArrayList<SourcePackage>();
        for (var selected : request.packages()) {
            sources.add(new SourcePackage(selected, new CpiPackage(selected.packageId(), null, null),
                    api.listArtifacts(request.source().id(), selected.packageId())));
        }
        return new PreparedTransport(request, sources, false, limit).executeSynchronously();
    }

    // Request validation and environment checks are performed by the controller.
    public TransportResponse preflightAndExecute(TransportRequest request) {
        return prepare(request).executeSynchronously();
    }

    public PreparedTransport prepare(TransportRequest request) {
        int limit = concurrency(request);
        var sources = new ArrayList<SourcePackage>();
        try {
            var metadata = new ArrayList<CpiPackage>();
            for (var selected : request.packages()) {
                metadata.add(api.getPackage(request.source().id(), selected.packageId())
                        .orElseThrow(() -> new ErrorResponse.ApiException(ErrorResponse.Code.PACKAGE_NOT_FOUND)));
            }
            for (int i = 0; i < request.packages().size(); i++) {
                var selected = request.packages().get(i);
                sources.add(new SourcePackage(selected, metadata.get(i),
                        api.listArtifacts(request.source().id(), selected.packageId())));
            }
        } catch (CpiCallException failure) {
            // A token-endpoint 404 is an authentication failure, not a missing package.
            if (Integer.valueOf(404).equals(failure.httpStatus()) && !failure.isTokenStageFailure()) {
                throw new ErrorResponse.ApiException(ErrorResponse.Code.PACKAGE_NOT_FOUND);
            }
            throw new ErrorResponse.ApiException(ErrorResponse.Code.CPI_UNAVAILABLE);
        }
        return new PreparedTransport(request, sources, true, limit);
    }

    public TransportResponse execute(TransportRequest request, List<CpiArtifact> artifacts) {
        if (request.packages().size() != 1) throw new IllegalArgumentException("One package required for supplied artifacts");
        var selected = request.packages().getFirst();
        return new PreparedTransport(request, List.of(new SourcePackage(selected,
                new CpiPackage(selected.packageId(), null, null), artifacts)), false, concurrency(request)).executeSynchronously();
    }

    private int concurrency(TransportRequest request) {
        var current = settings.get();
        return request.dryRun() ? current.previewConcurrency() : current.transportConcurrency();
    }

    public final class PreparedTransport {
        private final TransportRequest request;
        private final List<SourcePackage> sources;
        private final boolean preflight;
        private final int limit;

        private PreparedTransport(TransportRequest request, List<SourcePackage> sources, boolean preflight, int limit) {
            this.request = request;
            this.sources = List.copyOf(sources);
            this.preflight = preflight;
            this.limit = limit;
        }

        public TransportRun newRun(TemplateRef template, Consumer<TransportResponse> history) {
            var packages = new ArrayList<TransportPackage>();
            var items = new ArrayList<TransportRun.Item>();
            for (var source : sources) {
                String packageId = source.selection().packageId();
                packages.add(new TransportPackage(packageId, source.metadata().name(), TargetPackageStatus.NOT_CHECKED));
                for (String id : source.artifactIds()) items.add(new TransportRun.Item(packageId, id, Stage.WAITING, null));
            }
            return new TransportRun(clock, request, packages, items, template, history);
        }

        private TransportResponse executeSynchronously() {
            return execute(newRun(null, null));
        }

        public TransportResponse execute(TransportRun run) {
            var targets = new HashMap<String, TargetPackage>();
            for (int i = 0; i < sources.size(); i++) {
                if (run.isShuttingDown()) return null;
                var source = sources.get(i);
                var target = targets.computeIfAbsent(source.selection().packageId(),
                        id -> prepareTarget(run.id(), request, source.metadata()));
                run.targetPrepared(i, target.status());
            }

            var callerContext = MDC.getCopyOfContextMap();
            var pending = new ArrayList<CompletableFuture<Void>>();
            // Wait in pool.close() so a coordinator interrupt also interrupts the iFlow workers.
            try (var pool = Executors.newFixedThreadPool(limit, Thread.ofVirtual().factory())) {
                for (var source : sources) {
                    String packageId = source.selection().packageId();
                    var target = targets.get(packageId);
                    for (String id : source.artifactIds()) {
                        int index = pending.size();
                        pending.add(CompletableFuture.runAsync(() -> {
                            if (!run.startItem(index)) return;
                            try {
                                if (callerContext != null) MDC.setContextMap(callerContext);
                                MDC.put("transportId", run.id());
                                MDC.put("packageId", packageId);
                                MDC.put("artifactId", id);
                                var artifact = processSelected(run.id(), request, source, id, target, preflight,
                                        stage -> run.stage(index, stage));
                                run.completed(index, artifact);
                            } finally {
                                MDC.clear();
                            }
                        }, pool));
                    }
                }
            }
            if (Thread.currentThread().isInterrupted()) throw new CancellationException();
            pending.forEach(CompletableFuture::join);
            return run.finish();
        }
    }

    private ArtifactResult processSelected(String transportId, TransportRequest request, SourcePackage source,
                                           String id, TargetPackage target, boolean preflight, Consumer<Stage> progress) {
        String packageId = source.selection().packageId();
        // Supplied artifacts keep source-stage failure precedence. Preflight rejects the entire package first.
        if (preflight && target.error() != null) {
            progress.accept(Stage.TARGET);
            event(transportId, id, Stage.TARGET, "started");
            event(transportId, id, Stage.TARGET, "failed");
            return new ArtifactResult(packageId, id, null, TransportAction.NONE,
                    List.of(), DeployStatus.NOT_REQUESTED, target.error());
        }
        return process(transportId, request, packageId, id, source.artifacts(), target.error(), progress).withPackageId(packageId);
    }

    private TargetPackage prepareTarget(String transportId, TransportRequest request, CpiPackage source) {
        if (request.dryRun()) return new TargetPackage(TargetPackageStatus.NOT_CHECKED, null);
        try {
            if (api.getPackage(request.target().id(), source.id()).isPresent())
                return new TargetPackage(TargetPackageStatus.EXISTING, null);
        } catch (RuntimeException failure) {
            return new TargetPackage(TargetPackageStatus.CHECK_FAILED, targetError("TARGET_CHECK_FAILED", failure));
        }
        if (!request.createPackages().contains(source.id())) {
            return new TargetPackage(TargetPackageStatus.NOT_FOUND,
                    new ArtifactError("PACKAGE_NOT_FOUND_IN_TARGET", "TARGET: HTTP 404; CPI package not found"));
        }
        log.info("transportId={} packageId={} step=PACKAGE_CREATE phase=START result=PENDING", transportId, source.id());
        try {
            api.createPackage(request.target().id(), source);
            log.info("transportId={} packageId={} step=PACKAGE_CREATE phase=END result=OK", transportId, source.id());
            return new TargetPackage(TargetPackageStatus.CREATED, null);
        } catch (RuntimeException failure) {
            log.info("transportId={} packageId={} step=PACKAGE_CREATE phase=END result=FAILED", transportId, source.id());
            return new TargetPackage(TargetPackageStatus.CREATE_FAILED, targetError("PACKAGE_CREATE_FAILED", failure));
        }
    }

    private ArtifactError targetError(String code, RuntimeException failure) {
        String detail = failure instanceof CpiCallException call
                ? "HTTP " + call.httpStatus() + "; CPI call failed" : "CPI processing failed";
        return new ArtifactError(code, "TARGET: " + detail);
    }

    private ArtifactResult process(String transportId, TransportRequest request, String packageId, String id,
                                   List<CpiArtifact> artifacts, ArtifactError packageError, Consumer<Stage> progress) {
        Stage stage = Stage.LOOKUP;
        TransportAction action = TransportAction.NONE;
        DeployStatus deployStatus = request.dryRun() && request.deploy()
                ? DeployStatus.SKIPPED_DRY_RUN : DeployStatus.NOT_REQUESTED;
        List<ConfigurationItem> items = List.of();
        ArtifactError error = null;
        String successResult = "succeeded";
        var deployFailure = DeployOutcome.DeployFailure.NONE;
        boolean exists = false;
        event(transportId, id, stage, "started");
        try {
            var artifact = artifacts.stream().filter(a -> id.equals(a.id())).findFirst();
            if (artifact.isEmpty()) {
                error = new ArtifactError(stage.code, "LOOKUP: artifact absent from DEV package");
            } else {
                stage = next(transportId, id, stage, Stage.DOWNLOAD, progress);
                byte[] zip = api.downloadArtifact(request.source().id(), id);
                stage = next(transportId, id, stage, Stage.CONFIGURATION_READ, progress);
                var source = configurations.read(request.source().id(), id);
                stage = next(transportId, id, stage, request.dryRun() ? Stage.UPLOAD : Stage.TARGET, progress);
                if (request.dryRun()) {
                    items = source;
                } else if (packageError != null) {
                    error = packageError;
                } else {
                    exists = api.artifactExists(request.target().id(), id);
                    stage = next(transportId, id, stage, Stage.UPLOAD, progress);
                    String content = Base64.getEncoder().encodeToString(zip);
                    if (exists) api.updateArtifact(request.target().id(), id, artifact.get().name(), content);
                    else api.createArtifact(request.target().id(), artifact.get().name(), id, packageId, content);
                    action = exists ? TransportAction.UPDATED : TransportAction.CREATED;
                    items = source.stream()
                            .map(item -> new ConfigurationItem(item.key(), item.value(), item.dataType(),
                                    ConfigurationStatus.BUNDLED))
                            .toList();
                }
                if (error == null) {
                    event(transportId, id, stage, request.dryRun() ? "SKIPPED_DRY_RUN" : "succeeded");
                    stage = Stage.DEPLOY;
                    event(transportId, id, stage, "started");
                    if (request.deploy() && !request.dryRun()) {
                        progress.accept(stage);
                        var outcome = deployment.deployAndWaitOutcome(request.target().id(), id);
                        deployStatus = outcome.status();
                        deployFailure = outcome.failure();
                        if (deployStatus != DeployStatus.STARTED) {
                            error = new ArtifactError(deployStatus == DeployStatus.TIMEOUT ? "DEPLOY_TIMEOUT" : stage.code,
                                    "DEPLOY: CPI deployment " + deployStatus);
                            if (deployFailure == DeployOutcome.DeployFailure.RUNTIME_ERROR) {
                                error = deployment.errorDetail(request.target().id(), id, configurations.sensitiveValues(source));
                            }
                        }
                    } else {
                        successResult = request.dryRun() ? "SKIPPED_DRY_RUN" : "NOT_REQUESTED";
                    }
                }
            }
        } catch (RuntimeException failure) {
            if (stage == Stage.DEPLOY) {
                deployStatus = DeployStatus.ERROR;
                deployFailure = DeployOutcome.DeployFailure.CALL_FAILED;
            }
            // AI-NOTE: CPI bodies can echo unknown sensitive values; use a categorical summary. (근거: REQ-012 AC-3, run 20260928-cpi-transport)
            // REQ-309 permits only masked ErrorInformation in ArtifactError.detail; other failures remain categorical.
            String detail = failure instanceof CpiCallException call
                    ? "HTTP " + call.httpStatus() + "; CPI call failed" : "CPI processing failed";
            // AI-NOTE: 갱신 PUT의 "400, 본문 없음"은 직전 run에서 편집 락 때 한 번 관찰한 형태일 뿐 락만의 신호가 아니다.
            // 그래서 락을 감지·해제하지 않고 안내만 붙인다. 생성 POST·Configurations·DEPLOY·본문 있는 400에는 붙이지 않는다.
            // (근거: REQ-315 AC-1·AC-2, 01_spec.md B2, run 20261020-defect-fix)
            if (stage == Stage.UPLOAD && exists && failure instanceof CpiCallException call
                    && Integer.valueOf(400).equals(call.httpStatus()) && call.hasEmptyBody()) {
                detail += ". " + LOCK_HINT;
            }
            error = stage == Stage.DEPLOY
                    ? new ArtifactError(stage.code, "DEPLOY: CPI deployment ERROR")
                    : new ArtifactError(stage.code, stage + ": " + detail);
        }
        String logFields = "";
        if (stage == Stage.DEPLOY && deployStatus == DeployStatus.ERROR) {
            logFields = " deployFailure=" + deployFailure;
            if (deployFailure == DeployOutcome.DeployFailure.RUNTIME_ERROR) {
                int length = error.detail() == null ? 0 : error.detail().codePointCount(0, error.detail().length());
                logFields += " detailHttpStatus=" + error.detailHttpStatus() + " detailLength=" + length;
            }
        }
        event(transportId, id, stage, error == null ? successResult : "failed " + error.code(), logFields);
        return new ArtifactResult(id, null, action, items, deployStatus, error);
    }

    private Stage next(String transportId, String id, Stage previous, Stage next, Consumer<Stage> progress) {
        event(transportId, id, previous, "succeeded");
        event(transportId, id, next, "started");
        progress.accept(next);
        return next;
    }

    private void event(String transportId, String id, Stage stage, String outcome) {
        event(transportId, id, stage, outcome, "");
    }

    private void event(String transportId, String id, Stage stage, String outcome, String fields) {
        String step = stage == Stage.CONFIGURATION_READ ? "PARAMETER_COPY" : stage.name();
        boolean start = outcome.equals("started");
        String result = outcome.equals("succeeded") ? "OK"
                : outcome.startsWith("failed") ? "FAILED" : outcome;
        log.info("packageId={} transportId={} artifactId={} step={} phase={} result={}{}",
                MDC.get("packageId"), transportId, id, step, start ? "START" : "END", start ? "PENDING" : result, fields);
    }

    public enum Stage {
        WAITING(null), DONE(null), SKIPPED(null),
        LOOKUP("ARTIFACT_NOT_FOUND"), DOWNLOAD("DOWNLOAD_FAILED"),
        TARGET("TARGET_CHECK_FAILED"), UPLOAD("UPLOAD_FAILED"), CONFIGURATION_READ("CONFIGURATION_READ_FAILED"),
        DEPLOY("DEPLOY_FAILED");
        private final String code;
        Stage(String code) { this.code = code; }
    }
}
