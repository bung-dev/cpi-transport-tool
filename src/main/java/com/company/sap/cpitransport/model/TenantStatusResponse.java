package com.company.sap.cpitransport.model;
import java.util.List;
public record TenantStatusResponse(boolean readOnly, List<Item> tenants) {
    public enum Check { OK, TOKEN_FAILED, API_FORBIDDEN, UNREACHABLE, ERROR }
    public record Item(String id, String name, String source, String apiHost, Check check) {}
}
