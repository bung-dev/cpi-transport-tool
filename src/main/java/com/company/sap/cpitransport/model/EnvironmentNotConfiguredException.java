package com.company.sap.cpitransport.model;

import java.util.List;

public class EnvironmentNotConfiguredException extends RuntimeException {
    private final List<String> missingKeys;

    public EnvironmentNotConfiguredException(List<String> missingKeys) {
        super(String.join(", ", missingKeys));
        this.missingKeys = List.copyOf(missingKeys);
    }

    public List<String> missingKeys() {
        return missingKeys;
    }
}
