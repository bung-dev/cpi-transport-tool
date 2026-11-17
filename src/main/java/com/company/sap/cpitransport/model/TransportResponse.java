package com.company.sap.cpitransport.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
public record TransportResponse(String transportId, String packageId, boolean dryRun, boolean deploy,
        Instant startedAt, Instant finishedAt, TransportSummary summary, List<ArtifactResult> results,
        @JsonInclude(JsonInclude.Include.NON_NULL) TenantRef sourceTenant,
        @JsonInclude(JsonInclude.Include.NON_NULL) TenantRef targetTenant,
        @JsonInclude(JsonInclude.Include.NON_NULL) TemplateRef template) {
    public TransportResponse(String transportId, String packageId, boolean dryRun, boolean deploy,
            Instant startedAt, Instant finishedAt, TransportSummary summary, List<ArtifactResult> results,
            TenantRef sourceTenant, TenantRef targetTenant) {
        this(transportId, packageId, dryRun, deploy, startedAt, finishedAt, summary, results, sourceTenant, targetTenant, null);
    }
    public TransportResponse withTemplate(TemplateRef template) {
        return new TransportResponse(transportId, packageId, dryRun, deploy, startedAt, finishedAt,
                summary, results, sourceTenant, targetTenant, template);
    }
    public TransportResponse(String transportId, String packageId, boolean dryRun, boolean deploy, Instant startedAt, Instant finishedAt, TransportSummary summary, List<ArtifactResult> results) {
        this(transportId, packageId, dryRun, deploy, startedAt, finishedAt, summary, results, null, null);
    }
    public TransportResponse { results = List.copyOf(results); }
}
