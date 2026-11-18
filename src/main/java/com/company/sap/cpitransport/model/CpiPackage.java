package com.company.sap.cpitransport.model;

public record CpiPackage(String id, String name, String version, String shortText, String description, String mode) {
    public CpiPackage(String id, String name, String version) {
        this(id, name, version, null, null, null);
    }
}
