package com.company.sap.cpitransport.model;

import java.util.List;
import com.company.sap.cpitransport.tenant.StoreStatus;

public record TenantListResponse(StoreStatus store, List<TenantView> tenants) {
    public TenantListResponse { tenants = List.copyOf(tenants); }
}
