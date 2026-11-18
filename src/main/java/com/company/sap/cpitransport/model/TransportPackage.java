package com.company.sap.cpitransport.model;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record TransportPackage(String packageId, String packageName, TargetPackageStatus targetPackage) {}
