package com.company.sap.cpitransport.model;

import java.time.Instant;
import java.util.List;
public record TransportResponse(String transportId, String packageId, boolean dryRun, boolean deploy,
        Instant startedAt, Instant finishedAt, TransportSummary summary, List<ArtifactResult> results) {
    public TransportResponse { results = List.copyOf(results); }
}
