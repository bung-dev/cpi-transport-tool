package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.model.*;
import java.time.Clock;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class TransportService {
    private static final Logger log = LoggerFactory.getLogger(TransportService.class);
    private final CpiApiClient api;
    private final IflwReplacer iflw;
    private final ExternalParameterReplacer parameters;
    private final DeployService deployment;
    private final MappingFileLoader mappings;
    private final Clock clock;

    public TransportService(CpiApiClient api, IflwReplacer iflw, ExternalParameterReplacer parameters,
                            DeployService deployment, MappingFileLoader mappings, Clock clock) {
        this.api = api;
        this.iflw = iflw;
        this.parameters = parameters;
        this.deployment = deployment;
        this.mappings = mappings;
        this.clock = clock;
    }

    // AI-NOTE: Request validation, EnvironmentGuard and DEV package validation belong to TODO-014.
    // Preflight can pass its already loaded snapshot to the overload to avoid duplicate reads.
    public TransportResponse execute(TransportRequest request) {
        var loaded = mappings.load();
        return execute(request, api.listArtifacts(CpiEnvironment.DEV, request.packageId()), loaded);
    }

    public TransportResponse execute(TransportRequest request, List<CpiArtifact> artifacts,
                                     List<MappingEntry> loadedMappings) {
        String transportId = UUID.randomUUID().toString();
        var started = clock.instant();
        var ids = request.artifactIds() == null || request.artifactIds().isEmpty()
                ? artifacts.stream().map(CpiArtifact::id).toList() : request.artifactIds();
        var results = new ArrayList<ArtifactResult>();
        for (String id : ids) results.add(process(transportId, request, id, artifacts, loadedMappings));
        int succeeded = (int) results.stream().filter(r -> r.status() == ArtifactStatus.SUCCESS).count();
        return new TransportResponse(transportId, request.packageId(), request.dryRun(), request.deploy(),
                started, clock.instant(), new TransportSummary(results.size(), succeeded, results.size() - succeeded), results);
    }

    private ArtifactResult process(String transportId, TransportRequest request, String id,
                                   List<CpiArtifact> artifacts, List<MappingEntry> loadedMappings) {
        Stage stage = Stage.LOOKUP;
        TransportAction action = TransportAction.NONE;
        DeployStatus deployStatus = request.dryRun() && request.deploy()
                ? DeployStatus.SKIPPED_DRY_RUN : DeployStatus.NOT_REQUESTED;
        var replacements = new ArrayList<Replacement>();
        var unmapped = new ArrayList<UnmappedKey>();
        ArtifactError error = null;
        event(transportId, id, stage, "started");
        try {
            var artifact = artifacts.stream().filter(a -> id.equals(a.id())).findFirst();
            if (artifact.isEmpty()) {
                error = new ArtifactError(stage.code, "LOOKUP: artifact absent from DEV package");
            } else {
                stage = next(transportId, id, stage, Stage.DOWNLOAD);
                byte[] zip = api.downloadArtifact(CpiEnvironment.DEV, id);
                stage = next(transportId, id, stage, Stage.IFLW);
                var applicable = loadedMappings.stream().filter(m -> id.equals(m.artifactId())).toList();
                var replaced = iflw.process(zip, applicable, request.dryRun());
                replacements.addAll(replaced.replacements());
                unmapped.addAll(replaced.unmappedKeys());
                if (!request.dryRun()) {
                    stage = next(transportId, id, stage, Stage.TARGET);
                    if (api.getPackage(CpiEnvironment.PRD, request.packageId()).isEmpty()) {
                        error = new ArtifactError("PACKAGE_NOT_FOUND_IN_TARGET", "TARGET: HTTP 404; CPI package not found");
                    } else {
                        boolean exists = api.artifactExists(CpiEnvironment.PRD, id);
                        stage = next(transportId, id, stage, Stage.UPLOAD);
                        String content = Base64.getEncoder().encodeToString(replaced.zipBytes());
                        if (exists) api.updateArtifact(CpiEnvironment.PRD, id, artifact.get().name(), content);
                        else api.createArtifact(CpiEnvironment.PRD, artifact.get().name(), id, request.packageId(), content);
                        action = exists ? TransportAction.UPDATED : TransportAction.CREATED;
                    }
                }
                if (error == null) {
                    stage = next(transportId, id, stage, Stage.CONFIGURATION_READ);
                    // Existing replacer owns stages 6 and 7: PUT failures returned, GET failures thrown.
                    var external = parameters.process(id, applicable, request.dryRun());
                    replacements.addAll(external.replacements());
                    unmapped.addAll(external.unmappedKeys());
                    stage = next(transportId, id, stage, Stage.CONFIGURATION_UPDATE);
                    if (external.error() != null) {
                        error = new ArtifactError(stage.code, "CONFIGURATION_UPDATE: " + external.error().message());
                    } else if (request.deploy() && !request.dryRun()) {
                        stage = next(transportId, id, stage, Stage.DEPLOY);
                        deployStatus = deployment.deployAndWait(id);
                        if (deployStatus != DeployStatus.STARTED) {
                            error = new ArtifactError(deployStatus == DeployStatus.TIMEOUT ? "DEPLOY_TIMEOUT" : stage.code,
                                    "DEPLOY: CPI deployment " + deployStatus);
                        }
                    }
                }
            }
        } catch (RuntimeException failure) {
            if (stage == Stage.DEPLOY) deployStatus = DeployStatus.ERROR;
            // AI-NOTE: CPI bodies can echo unknown sensitive values; use a categorical summary.
            // DeployService returns only status, so HTTP details are unavailable for returned failures.
            String detail = failure instanceof CpiCallException call
                    ? "HTTP " + call.httpStatus() + "; CPI call failed" : "CPI processing failed";
            error = new ArtifactError(stage.code, stage + ": " + detail);
        }
        if (action == TransportAction.NONE) {
            replacements.replaceAll(r -> r.status() == ReplacementStatus.APPLIED
                    ? new Replacement(r.targetType(), r.key(), ReplacementStatus.PLANNED, r.before(), r.after(), r.occurrences()) : r);
        }
        event(transportId, id, stage, error == null ? "succeeded" : "failed " + error.code());
        return new ArtifactResult(id, null, action, replacements, unmapped, deployStatus, error);
    }

    private Stage next(String transportId, String id, Stage previous, Stage next) {
        event(transportId, id, previous, "succeeded");
        event(transportId, id, next, "started");
        return next;
    }

    private void event(String transportId, String id, Stage stage, String outcome) {
        log.info("transportId={} artifactId={} stage={} {}", transportId, id, stage, outcome);
    }

    private enum Stage {
        LOOKUP("ARTIFACT_NOT_FOUND"), DOWNLOAD("DOWNLOAD_FAILED"), IFLW("IFLW_PARSE_ERROR"),
        TARGET("TARGET_CHECK_FAILED"), UPLOAD("UPLOAD_FAILED"), CONFIGURATION_READ("CONFIGURATION_READ_FAILED"),
        CONFIGURATION_UPDATE("CONFIGURATION_UPDATE_FAILED"), DEPLOY("DEPLOY_FAILED");
        private final String code;
        Stage(String code) { this.code = code; }
    }
}
