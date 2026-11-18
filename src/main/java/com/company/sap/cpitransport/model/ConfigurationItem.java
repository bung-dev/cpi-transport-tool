package com.company.sap.cpitransport.model;

public record ConfigurationItem(String key, String value, String dataType, ConfigurationStatus status) {
    @Override
    public String toString() { return "ConfigurationItem[values redacted]"; }
}
