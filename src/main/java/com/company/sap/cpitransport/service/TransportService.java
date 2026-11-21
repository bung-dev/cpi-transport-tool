package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.job.TransportRun;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.settings.SettingsService;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.stream.Collectors;
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
    private final PreviewBundles previewBundles;
    private final Supplier<ConcurrencySettings> settings;

    public TransportService(CpiApiClient api, ConfigurationCopier configurations,
                            DeployService deployment, Clock clock) {
        this(api, configurations, deployment, clock, () -> new ConcurrencySettings(1, 1));
    }

    @Autowired
    TransportService(CpiApiClient api, ConfigurationCopier configurations,
                     DeployService deployment, Clock clock, SettingsService settings, PreviewBundles previewBundles) {
        this(api, configurations, deployment, clock, settings::current, previewBundles);
    }

    public TransportService(CpiApiClient api, ConfigurationCopier configurations,
                            DeployService deployment, Clock clock, Supplier<ConcurrencySettings> settings) {
        this(api, configurations, deployment, clock, settings, new PreviewBundles(clock));
    }

    private TransportService(CpiApiClient api, ConfigurationCopier configurations, DeployService deployment,
                             Clock clock, Supplier<ConcurrencySettings> settings, PreviewBundles previewBundles) {
        this.previewBundles = previewBundles;
        this.settings = settings;
        this.api = api;
        this.configurations = configurations;
        this.deployment = deployment;
        this.clock = clock;
    }

    private record SourcePackage(CpiPackage metadata, List<SelectedArtifact> artifacts) {}

    private record SelectedArtifact(String packageId, ArtifactType type, String id, CpiArtifact source) {
        int stageOrder() {
            return switch (type) {
                case SCRIPT_COLLECTION, MESSAGE_MAPPING -> 1;
                case VALUE_MAPPING -> 2;
                case INTEGRATION_FLOW -> 3;
            };
        }

        ArtifactResult result(TransportAction action, ArtifactError error, ArtifactGrade grade) {
            return result(action, DeployStatus.NOT_REQUESTED, error, grade);
        }

        ArtifactResult result(TransportAction action, DeployStatus deployStatus, ArtifactError error, ArtifactGrade grade) {
            return new ArtifactResult(packageId, id, null, action, List.of(), deployStatus, error, grade, false, type);
        }

        ArtifactResult failed(ArtifactError error, ArtifactGrade grade) {
            return result(TransportAction.NONE, error, grade);
        }
    }

    private SourcePackage loadSource(String tenant, PackageSelection selection, CpiPackage metadata,
                                     List<CpiArtifact> suppliedFlows) {
        var artifacts = new ArrayList<SelectedArtifact>();
        for (var type : ArtifactType.values()) {
            var ids = selection.ids(type);
            boolean allFlows = type == ArtifactType.INTEGRATION_FLOW && ids == null;
            if (!allFlows && (ids == null || ids.isEmpty())) continue;
            List<CpiArtifact> listed;
            if (type == ArtifactType.INTEGRATION_FLOW) {
                listed = suppliedFlows != null ? suppliedFlows : api.listArtifacts(tenant, metadata.id());
            } else {
                listed = api.listArtifacts(tenant, metadata.id(), type);
            }
            if (allFlows) {
                for (var artifact : listed) {
                    artifacts.add(new SelectedArtifact(metadata.id(), type, artifact.id(), artifact));
                }
            } else {
                var byId = new HashMap<String, CpiArtifact>();
                for (var artifact : listed) byId.putIfAbsent(artifact.id(), artifact);
                for (var id : ids) artifacts.add(new SelectedArtifact(metadata.id(), type, id, byId.get(id)));
            }
        }
        return new SourcePackage(metadata, List.copyOf(artifacts));
    }

    private record TargetPackage(TargetPackageStatus status, ArtifactError error, ArtifactGrade grade) {}

    public TransportResponse execute(TransportRequest request) {
        int limit = concurrency(request);
        var sources = new ArrayList<SourcePackage>();
        for (var selected : request.packages()) {
            sources.add(loadSource(request.source().id(), selected, new CpiPackage(selected.packageId(), null, null), null));
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
                sources.add(loadSource(request.source().id(), selected, metadata.get(i), null));
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
        var source = loadSource(request.source().id(), selected, new CpiPackage(selected.packageId(), null, null), artifacts);
        return new PreparedTransport(request, List.of(source), false, concurrency(request)).executeSynchronously();
    }

    private int concurrency(TransportRequest request) {
        var current = settings.get();
        return request.dryRun() ? current.previewConcurrency() : current.transportConcurrency();
    }

    // Owned by one artifact worker. Deployment acceptance can release its permit early.
    private static final class ProcessingSlot implements AutoCloseable {
        private final Semaphore permits;
        private boolean released;

        ProcessingSlot(Semaphore permits) {
            this.permits = permits;
            try {
                permits.acquire();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new CancellationException();
            }
        }

        @Override public void close() {
            if (!released) {
                released = true;
                permits.release();
            }
        }
    }

    public final class PreparedTransport {
        private final TransportRequest request;
        private final List<SourcePackage> sources;
        private final List<List<SelectedArtifact>> stages;
        private final boolean preflight;
        private final int limit;

        private PreparedTransport(TransportRequest request, List<SourcePackage> sources, boolean preflight, int limit) {
            this.request = request;
            this.sources = List.copyOf(sources);
            var byStage = sources.stream().flatMap(source -> source.artifacts().stream())
                    .collect(Collectors.groupingBy(SelectedArtifact::stageOrder, TreeMap::new, Collectors.toList()));
            this.stages = List.copyOf(byStage.values());
            this.preflight = preflight;
            this.limit = limit;
        }

        public TransportRun newRun(TemplateRef template, Consumer<TransportResponse> history) {
            var packages = new ArrayList<TransportPackage>();
            for (var source : sources) {
                packages.add(new TransportPackage(source.metadata().id(), source.metadata().name(), TargetPackageStatus.NOT_CHECKED));
            }
            var items = stages.stream().flatMap(List::stream).map(a -> new TransportRun.Item(a.packageId(), a.id(), Stage.WAITING, null, a.type()))
                    .toList();
            return new TransportRun(clock, request, packages, items, template, history,
                    request.dryRun() ? previewBundles::complete : null);
        }

        private TransportResponse executeSynchronously() {
            var run = newRun(null, null);
            try {
                return execute(run);
            } finally {
                if (request.dryRun()) previewBundles.discardPending(run.id());
            }
        }

        public TransportResponse execute(TransportRun run) {
            var targets = new HashMap<String, TargetPackage>();
            for (int i = 0; i < sources.size(); i++) {
                if (run.isShuttingDown()) return null;
                var source = sources.get(i);
                var target = targets.computeIfAbsent(source.metadata().id(),
                        id -> prepareTarget(run.id(), request, source.metadata()));
                run.targetPrepared(i, target.status());
            }

            int offset = 0;
            for (var stage : stages) {
                executeStage(run, targets, stage, offset);
                offset += stage.size();
            }
            return run.finish();
        }

        private void executeStage(TransportRun run, Map<String, TargetPackage> targets,
                                  List<SelectedArtifact> artifacts, int offset) {
            var callerContext = MDC.getCopyOfContextMap();
            var pending = new ArrayList<CompletableFuture<Void>>();
            var slots = new Semaphore(limit);
            boolean batchFlows = artifacts.getFirst().type() == ArtifactType.INTEGRATION_FLOW && request.deploy() && !request.dryRun();
            try (var batch = batchFlows ? deployment.newBatch(request.target().id()) : null;
                 var pool = Executors.newVirtualThreadPerTaskExecutor()) {
                for (var selected : artifacts) {
                    var target = targets.get(selected.packageId());
                    int index = offset + pending.size();
                    var slot = new ProcessingSlot(slots);
                    pending.add(CompletableFuture.runAsync(() -> {
                        try (slot) {
                            if (!run.startItem(index)) return;
                            if (callerContext != null) MDC.setContextMap(callerContext);
                            MDC.put("transportId", run.id());
                            MDC.put("packageId", selected.packageId());
                            MDC.put("artifactId", selected.id());
                            var artifact = processSelected(run.id(), request, selected, target, preflight,
                                    stage -> run.stage(index, stage), batch, slot);
                            run.completed(index, artifact);
                        } finally {
                            MDC.clear();
                        }
                    }, pool));
                }
            }
            if (Thread.currentThread().isInterrupted()) throw new CancellationException();
            pending.forEach(CompletableFuture::join);
        }
    }

    private ArtifactResult processSelected(String transportId, TransportRequest request, SelectedArtifact selected,
                                           TargetPackage target, boolean preflight, Consumer<Stage> progress,
                                           DeployBatch batch, ProcessingSlot slot) {
        String id = selected.id();
        // Supplied artifacts keep source-stage failure precedence. Preflight rejects the entire package first.
        if (preflight && target.error() != null) {
            progress.accept(Stage.TARGET);
            event(transportId, id, Stage.TARGET, "started");
            event(transportId, id, Stage.TARGET, "failed");
            return selected.failed(target.error(), target.grade());
        }
        event(transportId, id, Stage.LOOKUP, "started");
        if (selected.source() == null) {
            event(transportId, id, Stage.LOOKUP, "failed");
            var deployStatus = request.dryRun() && request.deploy() ? DeployStatus.SKIPPED_DRY_RUN : DeployStatus.NOT_REQUESTED;
            return new ArtifactResult(selected.packageId(), id, null, TransportAction.NONE, List.of(), deployStatus,
                    new ArtifactError(Stage.LOOKUP.code, "LOOKUP: artifact absent from DEV package"),
                    ArtifactGrade.FIX_REQUIRED, false, selected.type());
        }
        event(transportId, id, Stage.LOOKUP, "succeeded");
        if (selected.type() != ArtifactType.INTEGRATION_FLOW) {
            var transfer = processObject(transportId, request, selected, target, progress);
            if (!request.deploy()) return transfer;
            if (request.dryRun()) {
                return selected.result(transfer.action(), DeployStatus.SKIPPED_DRY_RUN, transfer.error(), transfer.grade());
            }
            if (transfer.error() != null) return transfer;
            progress.accept(Stage.DEPLOY);
            return deployObject(transportId, request.target().id(), selected, transfer.action(), slot);
        }
        return process(transportId, request, selected.packageId(), id, selected.source(), target, progress, batch, slot);
    }

    private TargetPackage prepareTarget(String transportId, TransportRequest request, CpiPackage source) {
        if (request.dryRun()) return new TargetPackage(TargetPackageStatus.NOT_CHECKED, null, null);
        try {
            if (api.getPackage(request.target().id(), source.id()).isPresent())
                return new TargetPackage(TargetPackageStatus.EXISTING, null, null);
        } catch (RuntimeException failure) {
            return targetFailure(TargetPackageStatus.CHECK_FAILED, "TARGET_CHECK_FAILED", failure);
        }
        if (!request.createPackages().contains(source.id())) {
            return new TargetPackage(TargetPackageStatus.NOT_FOUND,
                    new ArtifactError("PACKAGE_NOT_FOUND_IN_TARGET", "TARGET: HTTP 404; CPI package not found"),
                    ArtifactGrade.FIX_REQUIRED);
        }
        log.info("transportId={} packageId={} step=PACKAGE_CREATE phase=START result=PENDING", transportId, source.id());
        try {
            api.createPackage(request.target().id(), source);
            log.info("transportId={} packageId={} step=PACKAGE_CREATE phase=END result=OK", transportId, source.id());
            return new TargetPackage(TargetPackageStatus.CREATED, null, null);
        } catch (RuntimeException failure) {
            log.info("transportId={} packageId={} step=PACKAGE_CREATE phase=END result=FAILED", transportId, source.id());
            return targetFailure(TargetPackageStatus.CREATE_FAILED, "PACKAGE_CREATE_FAILED", failure);
        }
    }

    private TargetPackage targetFailure(TargetPackageStatus status, String code, RuntimeException failure) {
        return new TargetPackage(status, new ArtifactError(code, "TARGET: " + failureDescription(failure)), callFailureGrade(failure));
    }

    private static String failureDescription(RuntimeException failure) {
        return failure instanceof CpiCallException call
                ? "HTTP " + call.httpStatus() + "; CPI call failed" : "CPI processing failed";
    }

    private static ArtifactGrade callFailureGrade(RuntimeException failure) {
        Integer status = failure instanceof CpiCallException call ? call.httpStatus() : null;
        if (status != null && status >= 400 && status < 500 && status != 408 && status != 429) {
            return ArtifactGrade.FIX_REQUIRED;
        }
        return ArtifactGrade.RETRYABLE;
    }

    private ArtifactResult process(String transportId, TransportRequest request, String packageId, String id,
                                   CpiArtifact artifact, TargetPackage target, Consumer<Stage> progress,
                                   DeployBatch batch, ProcessingSlot slot) {
        Stage stage = Stage.LOOKUP;
        TransportAction action = TransportAction.NONE;
        DeployStatus deployStatus = request.dryRun() && request.deploy()
                ? DeployStatus.SKIPPED_DRY_RUN : DeployStatus.NOT_REQUESTED;
        List<ConfigurationItem> items = List.of();
        ArtifactError error = null;
        ArtifactGrade grade = ArtifactGrade.SUCCESS;
        String successResult = "succeeded";
        var deployFailure = DeployOutcome.DeployFailure.NONE;
        boolean exists = false;
        boolean reusedPreview = false;
        try {
            String tenantId = request.source().id();
            String version = artifact.version();
            var cached = request.dryRun() ? Optional.<PreviewBundles.Bundle>empty()
                    : previewBundles.find(request.previewId(), tenantId, id, version);
            SourceReads reads;
            if (cached.isPresent()) {
                var bundle = cached.get();
                reads = new SourceReads(bundle.zip(), bundle.configurations());
                reusedPreview = true;
            } else {
                progress.accept(Stage.DOWNLOAD);
                reads = readSources(transportId, tenantId, id);
            }
            var source = reads.configurations();
            stage = request.dryRun() ? Stage.UPLOAD : Stage.TARGET;
            event(transportId, id, stage, "started");
            progress.accept(stage);
            if (request.dryRun()) {
                items = source;
                previewBundles.put(transportId, tenantId, id, version, reads.zip(), items);
            } else if (target.error() != null) {
                error = target.error();
                grade = target.grade();
            } else {
                exists = api.artifactExists(request.target().id(), id);
                stage = next(transportId, id, stage, Stage.UPLOAD, progress);
                String content = Base64.getEncoder().encodeToString(reads.zip());
                if (exists) api.updateArtifact(request.target().id(), id, artifact.name(), content);
                else api.createArtifact(request.target().id(), artifact.name(), id, packageId, content);
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
                    var outcome = batch.deployAndAwait(id, slot::close);
                    deployStatus = outcome.status();
                    deployFailure = outcome.failure();
                    if (deployStatus != DeployStatus.STARTED) {
                        error = new ArtifactError(deployStatus == DeployStatus.TIMEOUT ? "DEPLOY_TIMEOUT" : stage.code,
                                "DEPLOY: CPI deployment " + deployStatus);
                        if (deployFailure == DeployOutcome.DeployFailure.RUNTIME_ERROR) {
                            grade = ArtifactGrade.FIX_REQUIRED;
                            error = deployment.errorDetail(request.target().id(), id, configurations.sensitiveValues(items));
                        } else {
                            grade = ArtifactGrade.RETRYABLE;
                        }
                    }
                } else {
                    successResult = request.dryRun() ? "SKIPPED_DRY_RUN" : "NOT_REQUESTED";
                }
            }
        } catch (ReadFailure failure) {
            return new ArtifactResult(packageId, id, null, action, items, deployStatus, failure.error, failure.grade);
        } catch (RuntimeException failure) {
            if (stage == Stage.DEPLOY) {
                deployStatus = DeployStatus.ERROR;
                if (deployFailure != DeployOutcome.DeployFailure.RUNTIME_ERROR) {
                    deployFailure = DeployOutcome.DeployFailure.CALL_FAILED;
                    grade = ArtifactGrade.RETRYABLE;
                }
            } else {
                grade = callFailureGrade(failure);
            }
            // AI-NOTE: CPI bodies can echo unknown sensitive values; use a categorical summary. (근거: REQ-012 AC-3, run 20260928-cpi-transport)
            // REQ-309 permits only masked ErrorInformation in ArtifactError.detail; other failures remain categorical.
            String detail = failureDescription(failure);
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
        return new ArtifactResult(packageId, id, null, action, items, deployStatus, error, grade, reusedPreview);
    }

    private ArtifactResult processObject(String transportId, TransportRequest request, SelectedArtifact selected,
                                         TargetPackage target, Consumer<Stage> progress) {
        String id = selected.id();
        var type = selected.type();
        Stage stage = Stage.DOWNLOAD;
        progress.accept(stage);
        event(transportId, id, stage, "started");
        try {
            byte[] zip = objectZip(request.source().id(), id, type);
            stage = next(transportId, id, stage, Stage.TARGET, progress);
            if (target.error() != null) {
                event(transportId, id, stage, "failed");
                return selected.failed(target.error(), target.grade());
            }
            String tenant = request.target().id();
            boolean exists = api.artifactExists(tenant, id, type);
            TransportAction action = TransportAction.CREATED;
            if (exists) action = type == ArtifactType.VALUE_MAPPING ? TransportAction.REPLACED : TransportAction.UPDATED;
            if (request.dryRun()) {
                event(transportId, id, stage, "succeeded");
                return selected.result(action, null, ArtifactGrade.SUCCESS);
            }

            stage = next(transportId, id, stage, Stage.UPLOAD, progress);
            String content = Base64.getEncoder().encodeToString(zip);
            ArtifactResult result;
            if (action == TransportAction.REPLACED) {
                result = replaceValueMapping(tenant, selected, content);
            } else {
                if (exists) api.updateArtifactContent(tenant, id, type, content);
                else createObject(tenant, selected, content);
                result = selected.result(action, null, ArtifactGrade.SUCCESS);
            }
            if (result.error() == null) event(transportId, id, stage, "succeeded");
            else event(transportId, id, stage, "failed", " code=" + result.error().code());
            return result;
        } catch (RuntimeException failure) {
            event(transportId, id, stage, "failed", " code=" + stage.code);
            return selected.failed(new ArtifactError(stage.code, stage + ": " + failureDescription(failure)),
                    callFailureGrade(failure));
        }
    }

    private ArtifactResult deployObject(String transportId, String tenant, SelectedArtifact selected,
                                        TransportAction action, ProcessingSlot slot) {
        String id = selected.id();
        event(transportId, id, Stage.DEPLOY, "started");
        DeployOutcome outcome;
        try {
            outcome = deployment.deployObjectAndAwait(tenant, id, selected.type(), slot::close);
        } catch (RuntimeException failure) {
            event(transportId, id, Stage.DEPLOY, "failed", " deployFailure=CALL_FAILED");
            return selected.result(action, DeployStatus.ERROR,
                    new ArtifactError(Stage.DEPLOY.code, "DEPLOY: " + failureDescription(failure)), callFailureGrade(failure));
        }
        if (outcome.status() == DeployStatus.STARTED) {
            event(transportId, id, Stage.DEPLOY, "succeeded");
            return selected.result(action, outcome.status(), null, ArtifactGrade.SUCCESS);
        }
        String code = outcome.status() == DeployStatus.TIMEOUT ? "DEPLOY_TIMEOUT" : Stage.DEPLOY.code;
        var grade = outcome.failure() == DeployOutcome.DeployFailure.RUNTIME_ERROR ? ArtifactGrade.FIX_REQUIRED : ArtifactGrade.RETRYABLE;
        event(transportId, id, Stage.DEPLOY, "failed", " code=" + code + " deployFailure=" + outcome.failure());
        return selected.result(action, outcome.status(), new ArtifactError(code, "DEPLOY: CPI deployment " + outcome.status()), grade);
    }

    private byte[] objectZip(String tenant, String id, ArtifactType type) {
        byte[] zip = api.downloadArtifact(tenant, id, type);
        if (zip == null || zip.length == 0) throw new CpiCallException(null, "Empty CPI artifact content");
        return zip;
    }

    private void createObject(String tenant, SelectedArtifact selected, String content) {
        api.createArtifact(tenant, selected.source().name(), selected.id(), selected.packageId(), content, selected.type());
    }

    private ArtifactResult replaceValueMapping(String tenant, SelectedArtifact selected, String content) {
        byte[] backup = objectZip(tenant, selected.id(), selected.type());
        api.deleteArtifact(tenant, selected.id(), selected.type());
        try {
            createObject(tenant, selected, content);
        } catch (RuntimeException createFailure) {
            try {
                createObject(tenant, selected, Base64.getEncoder().encodeToString(backup));
            } catch (RuntimeException restoreFailure) {
                return selected.failed(new ArtifactError("VALUE_MAPPING_LOST",
                        "대상에서 밸류 매핑이 지워졌고 되살리지 못했습니다. CPI에서 직접 확인하세요"), ArtifactGrade.FIX_REQUIRED);
            }
            return selected.failed(new ArtifactError(Stage.UPLOAD.code,
                    "UPLOAD: " + failureDescription(createFailure) + ". 이전 버전으로 되살렸습니다"), callFailureGrade(createFailure));
        }
        return selected.result(TransportAction.REPLACED, null, ArtifactGrade.SUCCESS);
    }

    private record SourceReads(byte[] zip, List<ConfigurationItem> configurations) {}

    private static final class ReadFailure extends RuntimeException {
        final ArtifactError error;
        final ArtifactGrade grade;

        ReadFailure(Stage stage, RuntimeException cause) {
            error = new ArtifactError(stage.code, stage + ": " + failureDescription(cause));
            grade = callFailureGrade(cause);
        }
    }

    private SourceReads readSources(String transportId, String tenantId, String id) {
        var context = MDC.getCopyOfContextMap();
        CompletableFuture<List<ConfigurationItem>> configuration;
        byte[] zip;
        // Closing waits for both reads and propagates a shutdown interrupt to the child.
        try (var reader = Executors.newVirtualThreadPerTaskExecutor()) {
            configuration = CompletableFuture.supplyAsync(() -> {
                MDC.setContextMap(context);
                try {
                    return readStep(transportId, id, Stage.CONFIGURATION_READ, () -> configurations.read(tenantId, id));
                } finally {
                    MDC.clear();
                }
            }, reader);
            zip = readStep(transportId, id, Stage.DOWNLOAD, () -> api.downloadArtifact(tenantId, id));
        }
        try {
            return new SourceReads(zip, configuration.join());
        } catch (CompletionException failure) {
            if (failure.getCause() instanceof ReadFailure read) throw read;
            throw failure;
        }
    }

    private <T> T readStep(String transportId, String id, Stage stage, Supplier<T> read) {
        event(transportId, id, stage, "started");
        try {
            T value = read.get();
            event(transportId, id, stage, "succeeded");
            return value;
        } catch (RuntimeException failure) {
            event(transportId, id, stage, "failed");
            throw new ReadFailure(stage, failure);
        }
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
