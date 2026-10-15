package com.company.sap.cpitransport.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import static com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL;

public record ArtifactError(String code, String message, @JsonInclude(NON_NULL) String detail,
                            @JsonInclude(NON_NULL) Integer detailHttpStatus) {
    public ArtifactError(String code, String message) { this(code, message, null, null); }
}
