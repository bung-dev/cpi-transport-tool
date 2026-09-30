package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.model.MappingEntry;
import com.company.sap.cpitransport.model.MappingInvalidException;
import com.company.sap.cpitransport.model.TargetType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

class MappingFileLoaderTests {
    @TempDir Path directory;
    private static final String ENTRY = """
            {"artifactId":"flow","targetType":"header","key":"Endpoint",
             "devValue":"http://dev.localhost","prdValue":"http://prd.localhost"}
            """;

    private MappingFileLoader loader(String path) {
        return new MappingFileLoader(new TransportProperties(path, null, null, null, List.of()));
    }

    private Path write(String name, String content) throws Exception {
        return Files.writeString(directory.resolve(name), content);
    }

    private MappingInvalidException invalid(String name, String content) throws Exception {
        var failure = catchThrowableOfType(MappingInvalidException.class,
                () -> loader(write(name, content).toString()).load());
        assertThat(failure.code()).isEqualTo(Code.MAPPING_INVALID);
        assertThat(failure.getMessage()).doesNotContain("http://dev.localhost", "http://prd.localhost");
        assertThat(failure.getCause()).isNull();
        return failure;
    }

    @ParameterizedTest
    @ValueSource(strings = {"yml", "yaml", "YML", "YAML"})
    @DisplayName("REQ-006 AC-1, AC-2: YAML and JSON produce identical entries")
    void req006_ac1_formats(String extension) throws Exception {
        String yaml = """
                mappings:
                  - artifactId: flow
                    targetType: header
                    key: Endpoint
                    devValue: http://dev.localhost
                    prdValue: http://prd.localhost
                  - artifactId: flow
                    targetType: property
                    key: Endpoint
                    devValue: ""
                    prdValue: "123"
                  - artifactId: flow
                    targetType: externalParam
                    key: Endpoint
                    devValue: "true"
                    prdValue: ""
                """;
        List<MappingEntry> expected = List.of(
                new MappingEntry("flow", TargetType.HEADER, "Endpoint", "http://dev.localhost", "http://prd.localhost"),
                new MappingEntry("flow", TargetType.PROPERTY, "Endpoint", "", "123"),
                new MappingEntry("flow", TargetType.EXTERNAL_PARAM, "Endpoint", "true", ""));
        String json = "{\"mappings\":" + JsonMapper.builder().build().writeValueAsString(expected) + "}";
        assertThat(loader(write("mapping." + extension, yaml).toString()).load()).isEqualTo(expected);
        assertThat(loader(write("mapping.JSON", json).toString()).load()).isEqualTo(expected);
    }

    @ParameterizedTest
    @ValueSource(strings = {"artifactId", "targetType", "key", "devValue", "prdValue"})
    @DisplayName("REQ-006 AC-3: each missing field reports its array index")
    void req006_ac3_missingFields(String field) throws Exception {
        var node = JsonMapper.builder().build().readTree(ENTRY).deepCopy();
        ((tools.jackson.databind.node.ObjectNode) node).remove(field);
        assertThat(invalid("missing.json", "{\"mappings\":[" + ENTRY + "," + node + "]}").getMessage())
                .contains("mappings[1]", field);
    }

    @ParameterizedTest
    @ValueSource(strings = {"devValue: 123", "prdValue: true", "key: null", "artifactId: {}", "devValue: []", "targetType: Header"})
    @DisplayName("REQ-006 AC-3: invalid types and targetType report array index")
    void req006_ac3_invalidValues(String replacement) throws Exception {
        String field = replacement.substring(0, replacement.indexOf(':'));
        String item = "  - artifactId: flow\n    targetType: header\n    key: Endpoint\n    devValue: http://dev.localhost\n    prdValue: http://prd.localhost\n";
        String changed = item.replaceFirst(field + ": [^\n]*", replacement);
        assertThat(invalid("invalid.yml", "mappings:\n" + item + changed).getMessage()).contains("mappings[1]");
    }

    @Test
    @DisplayName("REQ-006 AC-3: duplicates report both indices without values")
    void req006_ac3_duplicate() throws Exception {
        assertThat(invalid("duplicate.json", "{\"mappings\":[" + ENTRY + "," + ENTRY + "]}").getMessage())
                .contains("mappings[0]", "mappings[1]");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]", "null", "", "{\"mappings\":{}}", "{\"mappings\":null}"})
    @DisplayName("REQ-006 AC-3: root requires mappings array")
    void req006_ac3_invalidRoot(String content) throws Exception {
        assertThat(invalid("root.json", content).getMessage()).contains("Mapping file");
    }

    @ParameterizedTest
    @ValueSource(strings = {"json", "yaml"})
    @DisplayName("REQ-006 AC-3: syntax errors do not expose parser input")
    void req006_ac3_invalidSyntax(String extension) throws Exception {
        assertThat(invalid("syntax." + extension, "{\"mappings\":[" + ENTRY + ",").getMessage())
                .contains("syntax");
    }

    @Test
    @DisplayName("REQ-006 AC-3: unsupported and missing files fail safely")
    void req006_ac3_fileProblems() throws Exception {
        assertThat(invalid("mapping.txt", ENTRY).getMessage()).contains("extension");
        var failure = catchThrowableOfType(MappingInvalidException.class,
                () -> loader(directory.resolve("missing.json").toString()).load());
        assertThat(failure.code()).isEqualTo(Code.MAPPING_INVALID);
        assertThat(failure.getMessage()).contains("file", "read");
    }

    @Test
    @DisplayName("REQ-006 AC-4: blank settings and empty arrays yield no mappings")
    void req006_ac4_empty() throws Exception {
        assertThat(loader("").load()).isEmpty();
        assertThat(loader("  ").load()).isEmpty();
        assertThat(loader(write("empty.json", "{\"mappings\":[]}").toString()).load()).isEmpty();
    }

    @Test
    @DisplayName("REQ-006 AC-5: same path is reloaded on every invocation")
    void req006_ac5_reload() throws Exception {
        Path path = write("reload.json", "{\"mappings\":[" + ENTRY + "]}");
        MappingFileLoader loader = loader(path.toString());
        assertThat(loader.load()).hasSize(1);
        Files.writeString(path, "{\"mappings\":[]}");
        assertThat(loader.load()).isEmpty();
        Files.writeString(path, "broken");
        assertThatThrownBy(loader::load).isInstanceOf(MappingInvalidException.class);
    }
}
