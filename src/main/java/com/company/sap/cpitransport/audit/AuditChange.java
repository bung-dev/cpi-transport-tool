package com.company.sap.cpitransport.audit;

// Pass only public metadata, never request bodies or credentials.
public record AuditChange(String category, String action, String objectId, String objectName, String detail) {}
