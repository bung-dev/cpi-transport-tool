package com.company.sap.cpitransport.tenant;

import java.time.Instant;

public record StoredTenant(String id, String name, String apiUrl, String tokenUrl,
                           String clientId, String clientSecret, Instant createdAt) {
    @Override
    public String toString() { return "StoredTenant[credentials=***]"; }
}
