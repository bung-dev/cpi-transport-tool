package com.company.sap.cpitransport.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.List;
public record TransportResponse(String transportId, List<TransportPackage> packages, boolean dryRun, boolean deploy,
        Instant startedAt, Instant finishedAt, TransportSummary summary, List<ArtifactResult> results,
        @JsonInclude(JsonInclude.Include.NON_NULL) TenantRef sourceTenant,
        @JsonInclude(JsonInclude.Include.NON_NULL) TenantRef targetTenant,
        @JsonInclude(JsonInclude.Include.NON_NULL) TemplateRef template,
        @JsonProperty("jobStatus") @JsonInclude(JsonInclude.Include.NON_NULL) JobStatus recordedJobStatus,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<SkippedItem> skipped,
        @JsonInclude(JsonInclude.Include.NON_NULL) String retryOf) {
    public record SkippedItem(String packageId, String artifactId, ArtifactType type) {
        public SkippedItem(String packageId, String artifactId) {
            this(packageId, artifactId, ArtifactType.INTEGRATION_FLOW);
        }
        public SkippedItem {
            if (type == null) type = ArtifactType.INTEGRATION_FLOW;
        }
    }

    public JobStatus jobStatus() {
        return recordedJobStatus == null ? JobStatus.COMPLETED : recordedJobStatus;
    }

    public TransportResponse(String transportId, List<TransportPackage> packages, boolean dryRun, boolean deploy,
            Instant startedAt, Instant finishedAt, TransportSummary summary, List<ArtifactResult> results,
            TenantRef sourceTenant, TenantRef targetTenant, TemplateRef template, JobStatus recordedJobStatus) {
        this(transportId, packages, dryRun, deploy, startedAt, finishedAt, summary, results,
                sourceTenant, targetTenant, template, recordedJobStatus, null, null);
    }

    public TransportResponse(String transportId, List<TransportPackage> packages, boolean dryRun, boolean deploy,
            Instant startedAt, Instant finishedAt, TransportSummary summary, List<ArtifactResult> results,
            TenantRef sourceTenant, TenantRef targetTenant, TemplateRef template) {
        this(transportId, packages, dryRun, deploy, startedAt, finishedAt, summary, results,
                sourceTenant, targetTenant, template, null);
    }
    public TransportResponse(String transportId, String packageId, boolean dryRun, boolean deploy,
            Instant startedAt, Instant finishedAt, TransportSummary summary, List<ArtifactResult> results,
            TenantRef sourceTenant, TenantRef targetTenant) {
        this(transportId, List.of(new TransportPackage(packageId, null, null)), dryRun, deploy,
                startedAt, finishedAt, summary, results.stream()
                        .map(r -> r.packageId() == null ? r.withPackageId(packageId) : r).toList(),
                sourceTenant, targetTenant, null);
    }
    public TransportResponse withTemplate(TemplateRef template) {
        return new TransportResponse(transportId, packages, dryRun, deploy, startedAt, finishedAt,
                summary, results, sourceTenant, targetTenant, template, recordedJobStatus, skipped, retryOf);
    }
    public TransportResponse(String transportId, String packageId, boolean dryRun, boolean deploy, Instant startedAt, Instant finishedAt, TransportSummary summary, List<ArtifactResult> results) {
        this(transportId, packageId, dryRun, deploy, startedAt, finishedAt, summary, results, null, null);
    }
    public TransportResponse {
        packages = List.copyOf(packages);
        results = List.copyOf(results);
        if (skipped != null) skipped = List.copyOf(skipped);
    }
}
