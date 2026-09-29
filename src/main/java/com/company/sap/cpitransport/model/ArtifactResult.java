package com.company.sap.cpitransport.model;

import java.util.List;
public record ArtifactResult(String artifactId, ArtifactStatus status, TransportAction action,
        List<Replacement> replacements, List<UnmappedKey> unmappedKeys, DeployStatus deployStatus, ArtifactError error) {
    public ArtifactResult {
        status = error == null ? ArtifactStatus.SUCCESS : ArtifactStatus.FAILED;
        replacements = List.copyOf(replacements);
        unmappedKeys = List.copyOf(unmappedKeys);
    }
}
