package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.CpiApiClient;
import com.company.sap.cpitransport.client.CpiCallException;
import com.company.sap.cpitransport.model.*;
import java.util.ArrayList;
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
        return api.getConfigurations(source, artifactId).stream().map(configuration -> {
            String value = configuration.parameterValue();
            var status = sensitiveKeys.isSensitive(configuration.parameterKey())
                    && (value == null || value.isEmpty())
                    ? ConfigurationStatus.SKIPPED_EMPTY : ConfigurationStatus.PLANNED;
            return new ConfigurationItem(configuration.parameterKey(), value, configuration.dataType(), status);
        }).toList();
    }

    public record Result(List<ConfigurationItem> configurations, ArtifactError error) {
        public Result { configurations = List.copyOf(configurations); }
    }

    public Result copy(String target, String artifactId, List<ConfigurationItem> source) {
        var items = new ArrayList<ConfigurationItem>();
        var failures = new ArrayList<String>();
        for (var item : source) {
            if (item.status() == ConfigurationStatus.SKIPPED_EMPTY) {
                items.add(item);
                continue;
            }
            ConfigurationStatus status;
            try {
                api.updateConfiguration(target, artifactId, item.key(), item.value(), item.dataType());
                status = ConfigurationStatus.COPIED;
            } catch (CpiCallException failure) {
                status = ConfigurationStatus.FAILED;
                // Upstream messages and bodies can contain values; retain only key and status.
                failures.add(item.key() + ": HTTP " + failure.httpStatus());
            }
            items.add(new ConfigurationItem(item.key(), item.value(), item.dataType(), status));
        }
        return new Result(items, failures.isEmpty() ? null
                : new ArtifactError("CONFIGURATION_UPDATE_FAILED", "CONFIGURATION_UPDATE: " + String.join("; ", failures)));
    }

    public List<String> sensitiveValues(List<ConfigurationItem> source) {
        return source.stream().filter(item -> sensitiveKeys.isSensitive(item.key()))
                .map(ConfigurationItem::value).filter(value -> value != null && !value.isEmpty()).toList();
    }
}
