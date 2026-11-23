package com.company.sap.cpitransport.model;

public enum ArtifactType {
    INTEGRATION_FLOW("Integration"),
    SCRIPT_COLLECTION("ScriptCollection"),
    MESSAGE_MAPPING("MessageMapping"),
    VALUE_MAPPING("ValueMapping");

    private final String odataPrefix;

    ArtifactType(String odataPrefix) {
        this.odataPrefix = odataPrefix;
    }

    public String odataPrefix() {
        return odataPrefix;
    }
}
