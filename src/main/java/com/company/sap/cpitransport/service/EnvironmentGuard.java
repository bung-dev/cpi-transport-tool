package com.company.sap.cpitransport.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.CpiProperties.Environment;
import org.springframework.stereotype.Service;

@Service
public class EnvironmentGuard {
    private final CpiProperties properties;

    public EnvironmentGuard(CpiProperties properties) {
        this.properties = properties;
    }

    public List<String> missingKeys(Environment environment) {
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
