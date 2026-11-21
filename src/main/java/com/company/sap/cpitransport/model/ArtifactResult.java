package com.company.sap.cpitransport.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ArtifactResult(String packageId, String artifactId, ArtifactStatus status, TransportAction action,
        List<ConfigurationItem> configurations, DeployStatus deployStatus, ArtifactError error,
        @JsonInclude(JsonInclude.Include.NON_NULL) ArtifactGrade grade) {
    public ArtifactResult(String packageId, String artifactId, ArtifactStatus status, TransportAction action,
            List<ConfigurationItem> configurations, DeployStatus deployStatus, ArtifactError error) {
        this(packageId, artifactId, status, action, configurations, deployStatus, error, null);
    }
    public ArtifactResult(String artifactId, ArtifactStatus status, TransportAction action,
            List<ConfigurationItem> configurations, DeployStatus deployStatus, ArtifactError error) {
        this(null, artifactId, status, action, configurations, deployStatus, error);
    }
    public ArtifactResult withPackageId(String packageId) {
        return new ArtifactResult(packageId, artifactId, status, action, configurations, deployStatus, error, grade);
    }
    public ArtifactResult {
        status = error == null ? ArtifactStatus.SUCCESS : ArtifactStatus.FAILED;
        configurations = configurations == null ? List.of() : List.copyOf(configurations);
    }
}
