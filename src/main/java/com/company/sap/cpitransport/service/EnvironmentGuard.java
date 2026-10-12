package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.tenant.TenantRegistry;
import com.company.sap.cpitransport.model.TenantRef;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.ObjectProvider;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.CpiProperties.Environment;
import org.springframework.stereotype.Service;

@Service
public class EnvironmentGuard {
    private final CpiProperties properties;
    private final TenantRegistry tenants;

    public EnvironmentGuard(CpiProperties properties) {
        this(properties, TenantRegistry.initial(properties));
    }

    public EnvironmentGuard(CpiProperties properties, TenantRegistry tenants) {
        this.properties = properties;
        this.tenants = tenants;
    }

    @Autowired
    public EnvironmentGuard(CpiProperties properties, ObjectProvider<TenantRegistry> tenants) {
        this(properties, tenants.getIfAvailable(() -> TenantRegistry.initial(properties)));
    }

    public TenantRef resolve(String id) {
        return tenants.find(id).map(t -> new TenantRef(t.id(), t.name()))
                .orElseGet(() -> {
                    if (reserved(id)) return new TenantRef(id, id);
                    throw new ApiException(Code.TENANT_NOT_FOUND, 400, null);
                });
    }

    public static boolean reserved(String id) { return "DEV".equals(id) || "PRD".equals(id); }

    public List<String> missingKeys(String id) {
        return reserved(id) ? missingKeys(Environment.valueOf(id)) : List.of();
    }

    public static List<String> missingKeys(CpiProperties properties, Environment environment) {
        return missingConnectionKeys(properties, environment);
    }

    public List<String> missingKeys(Environment environment) {
        return missingConnectionKeys(properties, environment);
    }

    private static List<String> missingConnectionKeys(CpiProperties properties, Environment environment) {
        var connection = properties.connection(environment);
        String prefix = "cpi.environments." + environment.name().toLowerCase(Locale.ROOT) + ".";
        List<String> missing = new ArrayList<>();
        addIfBlank(missing, prefix + "api-url", connection.apiUrl());
        addIfBlank(missing, prefix + "token-url", connection.tokenUrl());
        addIfBlank(missing, prefix + "client-id", connection.clientId());
        addIfBlank(missing, prefix + "client-secret", connection.clientSecret());
        return List.copyOf(missing);
    }

    private static void addIfBlank(List<String> missing, String key, String value) {
        if (value == null || value.isBlank()) {
            missing.add(key);
        }
    }
}
