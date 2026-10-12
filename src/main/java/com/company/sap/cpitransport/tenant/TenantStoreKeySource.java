package com.company.sap.cpitransport.tenant;

import java.util.Optional;

@FunctionalInterface
public interface TenantStoreKeySource {
    Optional<String> storeKey();
}
