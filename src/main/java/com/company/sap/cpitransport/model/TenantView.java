package com.company.sap.cpitransport.model;

import java.time.Instant;

public record TenantView(String id, String name, String source, String apiHost, Instant createdAt) {}
