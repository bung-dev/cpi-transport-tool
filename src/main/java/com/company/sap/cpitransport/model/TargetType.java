package com.company.sap.cpitransport.model;

import com.fasterxml.jackson.annotation.JsonValue;

public enum TargetType {
    EXTERNAL_PARAM("externalParam"), HEADER("header"), PROPERTY("property");
    private final String value;
    TargetType(String value) { this.value = value; }
    @JsonValue
    public String value() { return value; }
}
