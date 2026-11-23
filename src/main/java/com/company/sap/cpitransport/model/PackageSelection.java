package com.company.sap.cpitransport.model;

import java.util.List;

public record PackageSelection(String packageId, List<String> artifactIds, List<String> scriptCollectionIds,
                               List<String> messageMappingIds, List<String> valueMappingIds) {
    public PackageSelection(String packageId, List<String> artifactIds) {
        this(packageId, artifactIds, null, null, null);
    }

    public PackageSelection {
        // A missing iFlow list requests all flows. Legacy callers can also send an empty list.
        if (scriptCollectionIds == null && messageMappingIds == null && valueMappingIds == null
                && artifactIds != null && artifactIds.isEmpty()) artifactIds = null;
        artifactIds = copy(artifactIds);
        scriptCollectionIds = copy(scriptCollectionIds);
        messageMappingIds = copy(messageMappingIds);
        valueMappingIds = copy(valueMappingIds);
    }

    private static List<String> copy(List<String> ids) {
        return ids == null ? null : List.copyOf(ids);
    }

    public List<String> ids(ArtifactType type) {
        return switch (type) {
            case INTEGRATION_FLOW -> artifactIds;
            case SCRIPT_COLLECTION -> scriptCollectionIds;
            case MESSAGE_MAPPING -> messageMappingIds;
            case VALUE_MAPPING -> valueMappingIds;
        };
    }
}
