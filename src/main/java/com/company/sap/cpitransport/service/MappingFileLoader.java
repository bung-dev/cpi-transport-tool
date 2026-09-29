package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.MappingEntry;
import com.company.sap.cpitransport.model.MappingInvalidException;
import com.company.sap.cpitransport.model.TargetType;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.dataformat.yaml.YAMLMapper;

@Service
public class MappingFileLoader {
    private final TransportProperties properties;
    private final ObjectMapper json = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private final ObjectMapper yaml = YAMLMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    public MappingFileLoader(TransportProperties properties) {
        this.properties = properties;
    }

    public List<MappingEntry> load() {
        String filename = properties.mappingFile();
        if (filename == null || filename.isBlank()) {
            return List.of();
        }
        String lower = filename.toLowerCase(Locale.ROOT);
        ObjectMapper mapper;
        if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
            mapper = yaml;
        } else if (lower.endsWith(".json")) {
            mapper = json;
        } else {
            throw new MappingInvalidException("Unsupported mapping file extension");
        }
        JsonNode root;
        try {
            root = mapper.readTree(Files.readAllBytes(Path.of(filename)));
        } catch (IOException | InvalidPathException | SecurityException failure) {
            throw new MappingInvalidException("Mapping file cannot be read");
        } catch (JacksonException failure) {
            // AI-NOTE: Parser diagnostics may expose values; deliberately omit the cause.
            throw new MappingInvalidException("Mapping file has invalid syntax");
        }
        if (root == null || !root.isObject() || !root.path("mappings").isArray()) {
            throw new MappingInvalidException("Mapping file must contain a mappings array");
        }
        List<MappingEntry> entries = new ArrayList<>();
        var indices = new HashMap<Identity, Integer>();
        for (JsonNode item : root.get("mappings")) {
            int index = entries.size();
            String prefix = "mappings[" + index + "]: ";
            for (String field : List.of("artifactId", "targetType", "key", "devValue", "prdValue")) {
                if (!item.has(field)) {
                    throw new MappingInvalidException(prefix + "missing field '" + field + "'");
                }
                if (!item.get(field).isString()) {
                    throw new MappingInvalidException(prefix + "field '" + field + "' must be a string");
                }
            }
            TargetType type = switch (item.get("targetType").asString()) {
                case "externalParam" -> TargetType.EXTERNAL_PARAM;
                case "header" -> TargetType.HEADER;
                case "property" -> TargetType.PROPERTY;
                default -> throw new MappingInvalidException(prefix + "invalid targetType");
            };
            var entry = new MappingEntry(item.get("artifactId").asString(), type,
                    item.get("key").asString(), item.get("devValue").asString(),
                    item.get("prdValue").asString());
            Integer previous = indices.putIfAbsent(new Identity(entry.artifactId(), type, entry.key()), index);
            if (previous != null) {
                throw new MappingInvalidException(prefix + "duplicate of mappings[" + previous + "]");
            }
            entries.add(entry);
        }
        return List.copyOf(entries);
    }

    private record Identity(String artifactId, TargetType targetType, String key) {}
}
