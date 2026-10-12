package com.company.sap.cpitransport.tenant;

public record ServiceKey(String apiUrl, String tokenUrl, String clientId, String clientSecret) {
    @Override
    public String toString() { return "ServiceKey[credentials=***]"; }
}
