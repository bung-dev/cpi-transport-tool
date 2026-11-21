package com.company.sap.cpitransport.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ArtifactResult(String packageId, String artifactId, ArtifactStatus status, TransportAction action,
        List<ConfigurationItem> configurations, DeployStatus deployStatus, ArtifactError error,
        @JsonInclude(JsonInclude.Include.NON_NULL) ArtifactGrade grade,
        @JsonInclude(JsonInclude.Include.NON_NULL) Boolean reusedPreview) {
    public ArtifactResult(String packageId, String artifactId, ArtifactStatus status, TransportAction action,
            List<ConfigurationItem> configurations, DeployStatus deployStatus, ArtifactError error, ArtifactGrade grade) {
        this(packageId, artifactId, status, action, configurations, deployStatus, error, grade, false);
    }
    public ArtifactResult(String packageId, String artifactId, ArtifactStatus status, TransportAction action,
            List<ConfigurationItem> configurations, DeployStatus deployStatus, ArtifactError error) {
        this(packageId, artifactId, status, action, configurations, deployStatus, error, null, null);
    }
    public ArtifactResult(String artifactId, ArtifactStatus status, TransportAction action,
            List<ConfigurationItem> configurations, DeployStatus deployStatus, ArtifactError error) {
        this(null, artifactId, status, action, configurations, deployStatus, error);
    }
    public ArtifactResult withPackageId(String packageId) {
        return new ArtifactResult(packageId, artifactId, status, action, configurations, deployStatus, error, grade, reusedPreview);
    }
    public ArtifactResult {
        status = error == null ? ArtifactStatus.SUCCESS : ArtifactStatus.FAILED;
        configurations = configurations == null ? List.of() : List.copyOf(configurations);
    }
}
