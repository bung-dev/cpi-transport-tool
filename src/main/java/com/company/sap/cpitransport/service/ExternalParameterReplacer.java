package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.CpiApiClient;
import com.company.sap.cpitransport.client.CpiCallException;
import com.company.sap.cpitransport.model.*;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class ExternalParameterReplacer {
    private static final Logger log = LoggerFactory.getLogger(ExternalParameterReplacer.class);
    private final CpiApiClient api;
    private final SensitiveKeyMatcher sensitiveKeys;

    public ExternalParameterReplacer(CpiApiClient api, SensitiveKeyMatcher sensitiveKeys) {
        this.api = api;
        this.sensitiveKeys = sensitiveKeys;
    }

    public record Error(String code, String message) {}

    public record Result(List<Replacement> replacements, List<UnmappedKey> unmappedKeys, Error error) {
        public Result {
            replacements = List.copyOf(replacements);
            unmappedKeys = List.copyOf(unmappedKeys);
        }
    }

    public Result process(String artifactId, List<MappingEntry> mappings, boolean dryRun) {
        return process(dryRun ? "DEV" : "PRD", artifactId, mappings, dryRun);
    }

    public Result process(String environment, String artifactId, List<MappingEntry> mappings, boolean dryRun) {
        var configurations = new LinkedHashMap<String, CpiConfiguration>();
        for (var configuration : api.getConfigurations(environment, artifactId)) {
            configurations.put(configuration.parameterKey(), configuration);
        }
        var applicable = mappings.stream()
                .filter(m -> artifactId.equals(m.artifactId()) && m.targetType() == TargetType.EXTERNAL_PARAM)
                .toList();
        var mappedKeys = applicable.stream().map(MappingEntry::key).collect(Collectors.toSet());
        var unmapped = new ArrayList<UnmappedKey>();
        for (String key : configurations.keySet()) {
            if (!mappedKeys.contains(key)) {
                unmapped.add(new UnmappedKey(TargetType.EXTERNAL_PARAM, key));
                log.info("Unmapped externalParam key: {}", key);
            }
        }
        var replacements = new ArrayList<Replacement>();
        var failures = new ArrayList<String>();
        for (var mapping : applicable) {
            var current = configurations.get(mapping.key());
            ReplacementStatus status;
            String before = current == null ? null : current.parameterValue();
            String after = before;
            int occurrences = current == null ? 0 : 1;
            if (sensitiveKeys.isSensitive(mapping.key())) {
                status = ReplacementStatus.SENSITIVE_SKIPPED;
                before = after = "***";
            } else if (current == null) {
                status = ReplacementStatus.KEY_NOT_FOUND;
            } else if (!Objects.equals(before, mapping.devValue())) {
                status = ReplacementStatus.VALUE_MISMATCH;
            } else {
                after = mapping.prdValue();
                status = ReplacementStatus.PLANNED;
                if (!dryRun) {
                    try {
                        api.updateConfiguration(environment, artifactId, mapping.key(), after, current.dataType());
                        status = ReplacementStatus.APPLIED;
                    } catch (CpiCallException exception) {
                        status = ReplacementStatus.FAILED;
                        // AI-NOTE: A transport failure has no HTTP status; never include its message or body. (근거: REQ-012 AC-3, run 20260928-cpi-transport)
                        failures.add(mapping.key() + ": HTTP " + exception.httpStatus());
                    }
                }
            }
            replacements.add(new Replacement(TargetType.EXTERNAL_PARAM, mapping.key(), status,
                    before, after, occurrences));
        }
        return new Result(replacements, unmapped, failures.isEmpty() ? null
                : new Error("CONFIGURATION_UPDATE_FAILED", String.join("; ", failures)));
    }
}