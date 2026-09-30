package com.company.sap.cpitransport.model;

public record CpiConfiguration(String parameterKey, String parameterValue, String dataType) {
    @Override
    public String toString() { return "CpiConfiguration[redacted]"; }
}
