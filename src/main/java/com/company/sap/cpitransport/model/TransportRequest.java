package com.company.sap.cpitransport.model;

import java.util.List;
public record TransportRequest(String packageId, List<String> artifactIds, boolean dryRun, boolean deploy) {
    public TransportRequest { if (artifactIds != null) artifactIds = List.copyOf(artifactIds); }
}
