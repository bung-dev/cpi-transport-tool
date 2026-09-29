package com.company.sap.cpitransport.model;

public record MappingEntry(String artifactId, TargetType targetType, String key,
                           String devValue, String prdValue) {
    @Override
    public String toString() { return "MappingEntry[values redacted]"; }
}
