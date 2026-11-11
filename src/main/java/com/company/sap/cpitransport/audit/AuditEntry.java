package com.company.sap.cpitransport.audit;

import java.time.Instant;

public record AuditEntry(String id, Instant time, String category, String action,
                         String objectId, String objectName, String detail) {}
