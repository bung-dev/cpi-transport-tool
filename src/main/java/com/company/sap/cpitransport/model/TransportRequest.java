package com.company.sap.cpitransport.model;

import java.util.List;

public record TransportRequest(List<PackageSelection> packages, List<String> createPackages,
        boolean dryRun, boolean deploy, TenantRef source, TenantRef target, String previewId) {
    public TransportRequest(List<PackageSelection> packages, List<String> createPackages,
                            boolean dryRun, boolean deploy, TenantRef source, TenantRef target) {
        this(packages, createPackages, dryRun, deploy, source, target, null);
    }
    public TransportRequest(String packageId, List<String> artifactIds, boolean dryRun, boolean deploy,
                            TenantRef source, TenantRef target) {
        this(List.of(new PackageSelection(packageId, artifactIds)), List.of(), dryRun, deploy, source, target);
    }
    public TransportRequest(String packageId, List<String> artifactIds, boolean dryRun, boolean deploy) {
        this(packageId, artifactIds, dryRun, deploy, new TenantRef("DEV", "DEV"), new TenantRef("PRD", "PRD"));
    }
    public TransportRequest {
        packages = List.copyOf(packages);
        createPackages = createPackages == null ? List.of() : List.copyOf(createPackages);
    }
}
