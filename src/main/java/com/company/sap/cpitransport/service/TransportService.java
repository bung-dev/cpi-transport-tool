package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.model.*;
import java.time.Clock;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;

@Service
public class TransportService {
    private static final Logger log = LoggerFactory.getLogger(TransportService.class);
    static final String LOCK_HINT = "대상 테넌트에서 이 아티팩트가 편집 중(잠김)일 수 있습니다. CPI 화면에서 편집을 저장하거나 취소한 뒤 다시 시도하세요.";
    private final CpiApiClient api;
    private final ConfigurationCopier configurations;
    private final DeployService deployment;
    private final Clock clock;

    public TransportService(CpiApiClient api, ConfigurationCopier configurations,
                            DeployService deployment, Clock clock) {
        this.api = api;
        this.configurations = configurations;
        this.deployment = deployment;
        this.clock = clock;
    }

    public TransportResponse execute(TransportRequest request) {
        return execute(request, api.listArtifacts(request.source().id(), request.packageId()));
    }

    // Request validation and environment checks are performed by the controller.
    public TransportResponse preflightAndExecute(TransportRequest request) {
        List<CpiArtifact> artifacts;
        try {
            if (api.getPackage(request.source().id(), request.packageId()).isEmpty()) {
                throw new ErrorResponse.ApiException(ErrorResponse.Code.PACKAGE_NOT_FOUND);
            }
            artifacts = api.listArtifacts(request.source().id(), request.packageId());
        } catch (CpiCallException failure) {
            // A token-endpoint 404 is an authentication failure, not a missing package.
            if (Integer.valueOf(404).equals(failure.httpStatus())
                    && !failure.isTokenStageFailure()) {
                throw new ErrorResponse.ApiException(ErrorResponse.Code.PACKAGE_NOT_FOUND);
            }
            // AI-NOTE: discard upstream summaries and causes before Spring logs this failure (REQ-305 AC-3).
            throw new ErrorResponse.ApiException(ErrorResponse.Code.CPI_UNAVAILABLE);
        }
        return execute(request, artifacts);
    }

    public TransportResponse execute(TransportRequest request, List<CpiArtifact> artifacts) {
        String transportId = UUID.randomUUID().toString();
        var started = clock.instant();
        var ids = request.artifactIds() == null || request.artifactIds().isEmpty()
                ? artifacts.stream().map(CpiArtifact::id).toList() : request.artifactIds();
        var results = new ArrayList<ArtifactResult>();
        for (String id : ids) {
            var previousContext = MDC.getCopyOfContextMap();
            try {
                MDC.put("transportId", transportId);
                MDC.put("artifactId", id);
                results.add(process(transportId, request, id, artifacts));
            } finally {
                if (previousContext == null) MDC.clear();
                else MDC.setContextMap(previousContext);
            }
        }
        int succeeded = (int) results.stream().filter(r -> r.status() == ArtifactStatus.SUCCESS).count();
        return new TransportResponse(transportId, request.packageId(), request.dryRun(), request.deploy(),
                started, clock.instant(), new TransportSummary(results.size(), succeeded, results.size() - succeeded), results, request.source(), request.target());
    }

    private ArtifactResult process(String transportId, TransportRequest request, String id,
                                   List<CpiArtifact> artifacts) {
        Stage stage = Stage.LOOKUP;
        TransportAction action = TransportAction.NONE;
        DeployStatus deployStatus = request.dryRun() && request.deploy()
                ? DeployStatus.SKIPPED_DRY_RUN : DeployStatus.NOT_REQUESTED;
        List<ConfigurationItem> items = List.of();
        ArtifactError error = null;
        var deployFailure = DeployOutcome.DeployFailure.NONE;
        boolean exists = false;
        event(transportId, id, stage, "started");
        try {
            var artifact = artifacts.stream().filter(a -> id.equals(a.id())).findFirst();
            if (artifact.isEmpty()) {
                error = new ArtifactError(stage.code, "LOOKUP: artifact absent from DEV package");
            } else {
                stage = next(transportId, id, stage, Stage.DOWNLOAD);
                byte[] zip = api.downloadArtifact(request.source().id(), id);
                stage = next(transportId, id, stage, Stage.CONFIGURATION_READ);
                var source = configurations.read(request.source().id(), id);
                if (request.dryRun()) {
                    items = source;
                    // Read and write share one PARAMETER_COPY START/END pair, also in preview.
                    stage = next(transportId, id, stage, Stage.CONFIGURATION_UPDATE);
                    skipped(transportId, id, Stage.UPLOAD, "SKIPPED_DRY_RUN");
                } else {
                    stage = next(transportId, id, stage, Stage.TARGET);
                    if (api.getPackage(request.target().id(), request.packageId()).isEmpty()) {
                        error = new ArtifactError("PACKAGE_NOT_FOUND_IN_TARGET", "TARGET: HTTP 404; CPI package not found");
                    } else {
                        exists = api.artifactExists(request.target().id(), id);
                        stage = next(transportId, id, stage, Stage.UPLOAD);
                        String content = Base64.getEncoder().encodeToString(zip);
                        if (exists) api.updateArtifact(request.target().id(), id, artifact.get().name(), content);
                        else api.createArtifact(request.target().id(), artifact.get().name(), id, request.packageId(), content);
                        action = exists ? TransportAction.UPDATED : TransportAction.CREATED;
                        stage = next(transportId, id, stage, Stage.CONFIGURATION_UPDATE);
                        var copied = configurations.copy(request.target().id(), id, source);
                        items = copied.configurations();
                        error = copied.error();
                    }
                }
                if (error == null) {
                    if (request.deploy() && !request.dryRun()) {
                        stage = next(transportId, id, stage, Stage.DEPLOY);
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
                        skipped(transportId, id, Stage.DEPLOY,
                                request.dryRun() ? "SKIPPED_DRY_RUN" : "NOT_REQUESTED");
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
        // TARGET/UPLOAD can fail between the copy read and write phases. Close the open copy span.
        if (stage == Stage.TARGET || stage == Stage.UPLOAD) {
            event(transportId, id, Stage.CONFIGURATION_UPDATE, "failed");
        }
        String logFields = "";
        if (stage == Stage.DEPLOY && deployStatus == DeployStatus.ERROR) {
            logFields = " deployFailure=" + deployFailure;
            if (deployFailure == DeployOutcome.DeployFailure.RUNTIME_ERROR) {
                int length = error.detail() == null ? 0 : error.detail().codePointCount(0, error.detail().length());
                logFields += " detailHttpStatus=" + error.detailHttpStatus() + " detailLength=" + length;
            }
        }
        event(transportId, id, stage, error == null ? "succeeded" : "failed " + error.code(), logFields);
        return new ArtifactResult(id, null, action, items, deployStatus, error);
    }

    private Stage next(String transportId, String id, Stage previous, Stage next) {
        event(transportId, id, previous, "succeeded");
        event(transportId, id, next, "started");
        return next;
    }

    private void event(String transportId, String id, Stage stage, String outcome) {
        event(transportId, id, stage, outcome, "");
    }

    private void event(String transportId, String id, Stage stage, String outcome, String fields) {
        // One copy span covers source read and target writes, including intervening upload.
        if (stage == Stage.CONFIGURATION_READ && outcome.equals("succeeded")
                || stage == Stage.CONFIGURATION_UPDATE && outcome.equals("started")) return;
        String step = switch (stage) {
            case CONFIGURATION_READ, CONFIGURATION_UPDATE -> "PARAMETER_COPY";
            default -> stage.name();
        };
        boolean start = outcome.equals("started");
        String result = outcome.equals("succeeded") ? "OK"
                : outcome.startsWith("failed") ? "FAILED" : outcome;
        log.info("transportId={} artifactId={} step={} phase={} result={}{}",
                transportId, id, step, start ? "START" : "END", start ? "PENDING" : result, fields);
    }

    private void skipped(String transportId, String id, Stage stage, String reason) {
        event(transportId, id, stage, "started");
        event(transportId, id, stage, reason);
    }

    private enum Stage {
        LOOKUP("ARTIFACT_NOT_FOUND"), DOWNLOAD("DOWNLOAD_FAILED"),
        TARGET("TARGET_CHECK_FAILED"), UPLOAD("UPLOAD_FAILED"), CONFIGURATION_READ("CONFIGURATION_READ_FAILED"),
        CONFIGURATION_UPDATE("CONFIGURATION_UPDATE_FAILED"), DEPLOY("DEPLOY_FAILED");
        private final String code;
        Stage(String code) { this.code = code; }
    }
}
