package com.company.sap.cpitransport.template;

import java.time.Instant;

public record StoredTemplate(String id, String name, String sourceTenantId, String targetTenantId,
                             Instant createdAt, Instant updatedAt) {}
