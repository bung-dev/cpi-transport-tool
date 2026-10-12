package com.company.sap.cpitransport.model;

import java.util.List;
public record TransportRequest(String packageId, List<String> artifactIds, boolean dryRun, boolean deploy, TenantRef source, TenantRef target) {
    public TransportRequest(String packageId, List<String> artifactIds, boolean dryRun, boolean deploy) {
        this(packageId, artifactIds, dryRun, deploy, new TenantRef("DEV", "DEV"), new TenantRef("PRD", "PRD"));
    }
    public TransportRequest { if (artifactIds != null) artifactIds = List.copyOf(artifactIds); }
}
