package com.company.sap.cpitransport.service;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.xpath.XPathFactory;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.*;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.w3c.dom.Document;
import static org.assertj.core.api.Assertions.*;

@ExtendWith(OutputCaptureExtension.class)
class IflwReplacerTests {
    private static final String FLOW = "src/main/resources/scenarioflows/integrationflow/main.iflw";
    private final IflwReplacer replacer = new IflwReplacer(new SensitiveKeyMatcher(
            new TransportProperties("", null, null, null, List.of("password", "token"))));
    @TempDir Path temp;

    private MappingEntry mapping(TargetType type, String key, String before, String after) {
        return new MappingEntry("artifact", type, key, before, after);
    }
    private MappingEntry endpoint() { return mapping(TargetType.HEADER, "Endpoint", "dev", "prod"); }
    private byte[] fixture() throws Exception {
        try (var stream = getClass().getResourceAsStream("/iflw/content-modifiers.iflw")) { return stream.readAllBytes(); }
    }
    private byte[] zip(Map<String, byte[]> entries) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            for (var entry : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey()));
                zip.write(entry.getValue());
                zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }
    private Map<String, byte[]> unzip(byte[] bytes) throws Exception {
        var result = new LinkedHashMap<String, byte[]>();
        try (var zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) result.put(entry.getName(), zip.readAllBytes());
        }
        return result;
    }
    // Independent parser for successful output: do not verify the serializer using its own parser.
    private Document parse(byte[] bytes) throws Exception {
        var factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        return factory.newDocumentBuilder().parse(new ByteArrayInputStream(bytes));
    }
    private String xpath(Document doc, String path) throws Exception {
        return XPathFactory.newInstance().newXPath().evaluate(path, doc);
    }
    private Document rows(byte[] archive, String activity, String table) throws Exception {
        var outer = parse(unzip(archive).get(FLOW));
        String value = xpath(outer, "//*[local-name()='callActivity'][@id='" + activity
                + "']//*[local-name()='property'][key='" + table + "']/value");
        return parse(("<rows>" + value + "</rows>").getBytes(StandardCharsets.UTF_8));
    }

    @Test @DisplayName("REQ-007 AC-1, AC-5: matching headers and properties aggregate across modifiers")
    void req007_ac1_replacesAllAndPreservesOtherActivities() throws Exception {
        var result = replacer.process(zip(Map.of(FLOW, fixture())), List.of(endpoint(),
                mapping(TargetType.PROPERTY, "Endpoint", "property-dev", "property-prod")), false);
        assertThat(result.changed()).isTrue();
        assertThat(result.replacements()).containsExactly(
                new Replacement(TargetType.HEADER, "Endpoint", ReplacementStatus.APPLIED, "dev", "prod", 2),
                new Replacement(TargetType.HEADER, "Endpoint", ReplacementStatus.VALUE_MISMATCH, "other", "other", 1),
                new Replacement(TargetType.PROPERTY, "Endpoint", ReplacementStatus.APPLIED, "property-dev", "property-prod", 1));
        assertThat(xpath(rows(result.zipBytes(), "one", "headerTable"), "/rows/row[1]/cell[@id='Value']")).isEqualTo("prod");
        assertThat(xpath(rows(result.zipBytes(), "two", "headerTable"), "/rows/row/cell[@id='Value']")).isEqualTo("prod");
        assertThat(xpath(rows(result.zipBytes(), "other", "headerTable"), "/rows/row[1]/cell[@id='Value']")).isEqualTo("dev");
        assertThat(xpath(rows(result.zipBytes(), "one", "propertyTable"), "/rows/row[1]/cell[@id='Value']")).isEqualTo("property-prod");
    }

    @Test @DisplayName("REQ-007 AC-2: mismatch retains first document value and original bytes")
    void req007_ac2_mismatch() throws Exception {
        byte[] original = zip(Map.of(FLOW, fixture()));
        var result = replacer.process(original, List.of(mapping(TargetType.HEADER, "Endpoint", "absent", "prod")), false);
        assertThat(result.replacements()).containsExactly(new Replacement(TargetType.HEADER, "Endpoint",
                ReplacementStatus.VALUE_MISMATCH, "dev", "dev", 3));
        assertThat(result.zipBytes()).isEqualTo(original);
        assertThat(result.changed()).isFalse();
    }

    @Test @DisplayName("REQ-007 AC-3: missing Content Modifier key reports null values and zero occurrences")
    void req007_ac3_missing() throws Exception {
        var result = replacer.process(zip(Map.of(FLOW, fixture())),
                List.of(mapping(TargetType.HEADER, "OnlyOtherStep", "dev", "prod")), false);
        assertThat(result.replacements()).containsExactly(new Replacement(TargetType.HEADER, "OnlyOtherStep",
                ReplacementStatus.KEY_NOT_FOUND, null, null, 0));
    }

    @Test @DisplayName("REQ-007 AC-4: unmapped keys deduplicate by type in document order and log names only")
    void req007_ac4_unmapped(CapturedOutput output) throws Exception {
        var result = replacer.process(zip(Map.of(FLOW, fixture())), List.of(endpoint()), false);
        assertThat(result.unmappedKeys()).containsExactly(new UnmappedKey(TargetType.HEADER, "Unmapped"),
                new UnmappedKey(TargetType.HEADER, "Password"), new UnmappedKey(TargetType.HEADER, "Token"),
                new UnmappedKey(TargetType.PROPERTY, "Endpoint"), new UnmappedKey(TargetType.PROPERTY, "Unmapped"));
        assertThat(output.getAll()).contains("Unmapped").doesNotContain("unchanged", "property-dev", "***");
        assertThat(xpath(rows(result.zipBytes(), "one", "headerTable"), "/rows/row[3]/cell[@id='Value']")).isEqualTo("unchanged");
    }

    @Test @DisplayName("REQ-007 AC-5: results combine multiple iflw entries in mapping then status order")
    void req007_ac5_multipleEntries() throws Exception {
        var entries = new LinkedHashMap<String, byte[]>();
        entries.put(FLOW, fixture());
        entries.put(FLOW.substring(0, FLOW.lastIndexOf('/') + 1) + "second.iflw", fixture());
        var result = replacer.process(zip(entries), List.of(mapping(TargetType.PROPERTY, "Endpoint", "property-dev", "p"), endpoint()), false);
        assertThat(result.replacements()).extracting(Replacement::occurrences).containsExactly(2, 4, 2);
        assertThat(result.replacements()).extracting(Replacement::status).containsExactly(
                ReplacementStatus.APPLIED, ReplacementStatus.APPLIED, ReplacementStatus.VALUE_MISMATCH);
    }

    @Test @DisplayName("REQ-007 AC-6: non-target bytes and entry order survive recompression")
    void req007_ac6_preservesEntries() throws Exception {
        var entries = new LinkedHashMap<String, byte[]>();
        entries.put("directory/", new byte[0]);
        entries.put("binary.dat", new byte[] {0, -1, 42});
        entries.put(FLOW, fixture());
        entries.put("outside.iflw", "not xml".getBytes(StandardCharsets.UTF_8));
        var actual = unzip(replacer.process(zip(entries), List.of(endpoint()), false).zipBytes());
        assertThat(actual.keySet()).containsExactlyElementsOf(entries.keySet());
        for (String name : List.of("directory/", "binary.dat", "outside.iflw")) assertThat(actual.get(name)).isEqualTo(entries.get(name));
    }

    @Test @DisplayName("REQ-007 AC-6: absent targets and empty archives return exact original zip bytes")
    void req007_ac6_noTargets() throws Exception {
        for (var entries : List.of(Map.<String, byte[]>of(), Map.of("other.iflw", fixture()), Map.of(FLOW, fixture()))) {
            byte[] original = zip(entries);
            var result = replacer.process(original, List.of(), false);
            assertThat(Arrays.equals(original, result.zipBytes())).isTrue();
            assertThat(result.changed()).isFalse();
        }
    }

    @Test @DisplayName("REQ-007 AC-7: five XML special characters round-trip and other cells remain unchanged")
    void req007_ac7_specialCharacters() throws Exception {
        String special = "&<>\"'";
        var result = replacer.process(zip(Map.of(FLOW, fixture())),
                List.of(mapping(TargetType.HEADER, "Endpoint", "dev", special)), false);
        var table = rows(result.zipBytes(), "one", "headerTable");
        assertThat(xpath(table, "/rows/row[1]/cell[@id='Value']")).isEqualTo(special);
        assertThat(xpath(table, "/rows/row[1]/cell[@id='Name']")).isEqualTo("Endpoint");
        assertThat(xpath(table, "/rows/row[1]/cell[@id='Type']")).isEqualTo("constant");
        assertThat(xpath(table, "/rows/row[1]/cell[@id='Datatype']")).isEqualTo("java.lang.String");
        assertThat(xpath(table, "/rows/row[2]/cell[@id='Value']")).isEqualTo("other");
        var second = replacer.process(result.zipBytes(), List.of(mapping(TargetType.HEADER, "Endpoint", special, "roundtrip")), false);
        assertThat(second.replacements().getFirst().occurrences()).isEqualTo(2);
    }

    @Test @DisplayName("REQ-007 AC-8: XXE and DOCTYPE fail without leaking file content or parser diagnostics")
    void req007_ac8_xxe(CapturedOutput output) throws Exception {
        Path file = temp.resolve("entity.txt");
        Files.writeString(file, "ENTITY_CONTENT_MUST_NOT_APPEAR");
        String xml = "<!DOCTYPE definitions [<!ENTITY xxe SYSTEM '" + file.toUri() + "'>]><definitions>&xxe;</definitions>";
        for (String invalid : List.of(xml, "<!DOCTYPE definitions><definitions/>")) {
            assertThatThrownBy(() -> replacer.process(zip(Map.of(FLOW, invalid.getBytes(StandardCharsets.UTF_8))), List.of(), false))
                    .isInstanceOf(IflwParseException.class).hasMessageContaining("IFLW_PARSE_ERROR").hasNoCause();
        }
        assertThat(output.getAll()).doesNotContain("ENTITY_CONTENT_MUST_NOT_APPEAR", "DOCTYPE", file.toString());
    }

    @Test @DisplayName("REQ-007 AC-8: broken outer XML and embedded row XML fail")
    void req007_ac8_brokenXml() throws Exception {
        String valid = new String(fixture(), StandardCharsets.UTF_8);
        for (String invalid : List.of("<broken>", valid.replace("<![CDATA[<row>", "<![CDATA[<broken>"),
                valid.replace("<![CDATA[<row>", "<![CDATA[<!DOCTYPE row><row>"))) {
            assertThatThrownBy(() -> replacer.process(zip(Map.of(FLOW, invalid.getBytes(StandardCharsets.UTF_8))), List.of(), false))
                    .isInstanceOf(IflwParseException.class).hasNoCause();
        }
    }

    @Test @DisplayName("REQ-007 AC-8: non-zip and truncated archives fail")
    void req007_ac8_invalidZip() throws Exception {
        byte[] valid = zip(Map.of(FLOW, fixture()));
        for (byte[] invalid : List.of(new byte[0], "not a zip".getBytes(StandardCharsets.UTF_8), Arrays.copyOf(valid, valid.length - 22))) {
            assertThatThrownBy(() -> replacer.process(invalid, List.of(), false)).isInstanceOf(IflwParseException.class);
        }
    }

    @Test @DisplayName("REQ-007 AC-1: namespace and owning activity delimit Content Modifier scope")
    void req007_ac1_namespaceAndScope() throws Exception {
        String xml = new String(fixture(), StandardCharsets.UTF_8);
        for (String ignored : List.of(xml.replace("http://www.omg.org/spec/BPMN/20100524/MODEL", "urn:other"),
                xml.replace("http:///com.sap.ifl.model/Ifl.xsd", "urn:other"),
                xml.replace("<b:extensionElements>", "<b:wrapper>").replace("</b:extensionElements>", "</b:wrapper>")
                        .replace("<value>Enricher</value>", "<value>OtherStep</value>"))) {
            byte[] original = zip(Map.of(FLOW, ignored.getBytes(StandardCharsets.UTF_8)));
            var result = replacer.process(original, List.of(endpoint()), false);
            assertThat(result.replacements().getFirst().status()).isEqualTo(ReplacementStatus.KEY_NOT_FOUND);
            assertThat(result.zipBytes()).isEqualTo(original);
        }
    }

    @Test @DisplayName("REQ-007 AC-6: untouched target iflw bytes remain exact when another entry changes")
    void req007_ac6_unchangedTarget() throws Exception {
        String secondName = FLOW.substring(0, FLOW.lastIndexOf('/') + 1) + "unchanged.iflw";
        byte[] untouched = "<root/>".getBytes(StandardCharsets.UTF_8);
        var entries = new LinkedHashMap<String, byte[]>();
        entries.put(secondName, untouched);
        entries.put(FLOW, fixture());
        var result = replacer.process(zip(entries), List.of(endpoint()), false);
        assertThat(unzip(result.zipBytes()).get(secondName)).isEqualTo(untouched);
    }

    @Test @DisplayName("REQ-012 AC-2: sensitive header and property values survive mixed recompression")
    void req012_ac2_mixedSensitive() throws Exception {
        String xml = new String(fixture(), StandardCharsets.UTF_8).replace("property-dev", "***")
                .replace("<cell id=\"Name\">Endpoint</cell><cell id=\"Value\">***", "<cell id=\"Name\">Password</cell><cell id=\"Value\">***");
        var result = replacer.process(zip(Map.of(FLOW, xml.getBytes(StandardCharsets.UTF_8))), List.of(endpoint(),
                mapping(TargetType.HEADER, "Password", "***", "***"),
                mapping(TargetType.PROPERTY, "Password", "***", "***")), false);
        assertThat(result.changed()).isTrue();
        assertThat(result.replacements().subList(2, 4)).allSatisfy(r -> {
            assertThat(r.status()).isEqualTo(ReplacementStatus.SENSITIVE_SKIPPED);
            assertThat(r.before()).isEqualTo("***");
            assertThat(r.after()).isEqualTo("***");
            assertThat(r.occurrences()).isEqualTo(1);
        });
        assertThat(xpath(rows(result.zipBytes(), "one", "headerTable"), "/rows/row[cell[@id='Name']='Password']/cell[@id='Value']")).isEqualTo("***");
        assertThat(xpath(rows(result.zipBytes(), "one", "propertyTable"), "/rows/row[1]/cell[@id='Value']")).isEqualTo("***");
    }

    @Test @DisplayName("REQ-010 AC-2: dry run reports planned replacements with original bytes")
    void req010_ac2_dryRun() throws Exception {
        byte[] original = zip(Map.of(FLOW, fixture()));
        var result = replacer.process(original, List.of(endpoint()), true);
        assertThat(result.zipBytes()).isEqualTo(original);
        assertThat(result.changed()).isFalse();
        assertThat(result.replacements()).containsExactly(
                new Replacement(TargetType.HEADER, "Endpoint", ReplacementStatus.PLANNED, "dev", "prod", 2),
                new Replacement(TargetType.HEADER, "Endpoint", ReplacementStatus.VALUE_MISMATCH, "other", "other", 1));
    }

    @Test @DisplayName("REQ-012 AC-2, AC-4: sensitive mappings are masked even if absent and unmapped values are omitted")
    void req012_ac2_sensitive(CapturedOutput output) throws Exception {
        byte[] original = zip(Map.of(FLOW, fixture()));
        var result = replacer.process(original, List.of(mapping(TargetType.HEADER, "Password", "***", "***"),
                mapping(TargetType.PROPERTY, "Password", "***", "***")), false);
        assertThat(result.zipBytes()).isEqualTo(original);
        assertThat(result.replacements()).containsExactly(
                new Replacement(TargetType.HEADER, "Password", ReplacementStatus.SENSITIVE_SKIPPED, "***", "***", 1),
                new Replacement(TargetType.PROPERTY, "Password", ReplacementStatus.SENSITIVE_SKIPPED, "***", "***", 0));
        assertThat(result.unmappedKeys()).contains(new UnmappedKey(TargetType.HEADER, "Token"));
        assertThat(output.getAll()).doesNotContain("***");
    }
}
