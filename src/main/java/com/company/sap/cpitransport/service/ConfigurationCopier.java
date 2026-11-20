package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.CpiApiClient;
import com.company.sap.cpitransport.model.ConfigurationItem;
import com.company.sap.cpitransport.model.ConfigurationStatus;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ConfigurationCopier {
    private final CpiApiClient api;
    private final SensitiveKeyMatcher sensitiveKeys;

    public ConfigurationCopier(CpiApiClient api, SensitiveKeyMatcher sensitiveKeys) {
        this.api = api;
        this.sensitiveKeys = sensitiveKeys;
    }

    public List<ConfigurationItem> read(String source, String artifactId) {
        return api.getConfigurations(source, artifactId).stream()
                .map(configuration -> new ConfigurationItem(configuration.parameterKey(), configuration.parameterValue(),
                        configuration.dataType(), ConfigurationStatus.PLANNED))
                .toList();
    }

    public List<String> sensitiveValues(List<ConfigurationItem> source) {
        return source.stream().filter(item -> sensitiveKeys.isSensitive(item.key()))
                .map(ConfigurationItem::value).filter(value -> value != null && !value.isEmpty()).toList();
    }
}
