package com.company.sap.cpitransport.model;

import java.util.List;

public record PackageSelection(String packageId, List<String> artifactIds) {
    public PackageSelection {
        if (artifactIds != null) artifactIds = List.copyOf(artifactIds);
    }
}
