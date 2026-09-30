package com.company.sap.cpitransport.model;

public record Replacement(TargetType targetType, String key, ReplacementStatus status,
                          String before, String after, int occurrences) {
    @Override public String toString() { return "Replacement[values redacted]"; }
}
