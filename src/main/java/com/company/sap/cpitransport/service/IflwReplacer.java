package com.company.sap.cpitransport.service;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import com.company.sap.cpitransport.model.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

@Service
public class IflwReplacer {
    private static final Logger LOG = LoggerFactory.getLogger(IflwReplacer.class);
    private static final String BPMN = "http://www.omg.org/spec/BPMN/20100524/MODEL";
    // AI-NOTE: The contract omits the ifl namespace URI; use the CPI export namespace. (근거: REQ-007 AC-1, run 20260928-cpi-transport)
    private static final String IFL = "http:///com.sap.ifl.model/Ifl.xsd";
    private static final String PREFIX = "src/main/resources/scenarioflows/integrationflow/";
    private final SensitiveKeyMatcher sensitiveKeys;

    public IflwReplacer(SensitiveKeyMatcher sensitiveKeys) { this.sensitiveKeys = sensitiveKeys; }

    public record Result(byte[] zipBytes, List<Replacement> replacements,
                         List<UnmappedKey> unmappedKeys, boolean changed) {
        public Result {
            replacements = List.copyOf(replacements);
            unmappedKeys = List.copyOf(unmappedKeys);
        }
    }

    public Result process(byte[] zipBytes, List<MappingEntry> mappingsForArtifact, boolean dryRun) {
        var entries = readZip(zipBytes);
        var tables = new ArrayList<Table>();
        for (var entry : entries) {
            if (entry.name.startsWith(PREFIX) && entry.name.endsWith(".iflw")) {
                entry.document = SecureXml.parse(entry.bytes);
                collectTables(entry, tables);
            }
        }
        var rows = tables.stream().flatMap(table -> table.rows.stream()).toList();
        var mappings = mappingsForArtifact.stream()
                .filter(m -> m.targetType() != TargetType.EXTERNAL_PARAM).toList();
        var unmapped = new LinkedHashSet<UnmappedKey>();
        for (var row : rows) {
            if (mappings.stream().noneMatch(m -> m.targetType() == row.type && m.key().equals(row.key))) {
                unmapped.add(new UnmappedKey(row.type, row.key));
            }
        }
        var replacements = new ArrayList<Replacement>();
        boolean changed = false;
        for (var mapping : mappings) {
            var matching = rows.stream().filter(r -> r.type == mapping.targetType()
                    && r.key.equals(mapping.key())).toList();
            if (sensitiveKeys.isSensitive(mapping.key())) {
                replacements.add(result(mapping, ReplacementStatus.SENSITIVE_SKIPPED, "***", "***", matching.size()));
                continue;
            }
            int applied = 0;
            int mismatched = 0;
            String firstMismatch = null;
            for (var row : matching) {
                String current = row.value.getTextContent();
                if (current.equals(mapping.devValue())) {
                    applied++;
                    if (!current.equals(mapping.prdValue()) && !dryRun) {
                        row.value.setTextContent(mapping.prdValue());
                        row.table.changed = true;
                        changed = true;
                    }
                } else {
                    if (mismatched++ == 0) firstMismatch = current;
                }
            }
            if (applied > 0) replacements.add(result(mapping, dryRun ? ReplacementStatus.PLANNED
                    : ReplacementStatus.APPLIED, mapping.devValue(), mapping.prdValue(), applied));
            if (mismatched > 0) replacements.add(result(mapping, ReplacementStatus.VALUE_MISMATCH,
                    firstMismatch, firstMismatch, mismatched));
            if (matching.isEmpty()) replacements.add(result(mapping, ReplacementStatus.KEY_NOT_FOUND, null, null, 0));
        }
        if (changed) {
            for (var table : tables) {
                if (!table.changed) continue;
                var fragment = new StringBuilder();
                for (Node n = table.document.getDocumentElement().getFirstChild(); n != null; n = n.getNextSibling()) {
                    fragment.append(SecureXml.serialize(n));
                }
                table.value.setTextContent(fragment.toString());
                table.entry.changed = true;
            }
        }
        for (var key : unmapped) LOG.info("Unmapped Content Modifier key: {}", key.key());
        // changed describes actual zip changes, and is false for a dry run.
        return new Result(changed ? writeZip(entries) : zipBytes, replacements, new ArrayList<>(unmapped), changed);
    }

    private static Replacement result(MappingEntry m, ReplacementStatus status, String before, String after, int count) {
        return new Replacement(m.targetType(), m.key(), status, before, after, count);
    }

    private static void collectTables(Entry entry, List<Table> tables) {
        var activities = entry.document.getElementsByTagNameNS(BPMN, "callActivity");
        for (int i = 0; i < activities.getLength(); i++) {
            var properties = new ArrayList<Element>();
            for (var child : children(activities.item(i))) {
                if (is(child, IFL, "property")) properties.add(child);
                if (is(child, BPMN, "extensionElements")) {
                    for (var property : children(child)) if (is(property, IFL, "property")) properties.add(property);
                }
            }
            if (properties.stream().noneMatch(p -> "activityType".equals(text(p, "key"))
                    && "Enricher".equals(text(p, "value")))) continue;
            for (var property : properties) {
                String key = text(property, "key");
                TargetType type = "headerTable".equals(key) ? TargetType.HEADER
                        : "propertyTable".equals(key) ? TargetType.PROPERTY : null;
                if (type == null) continue;
                var value = child(property, "value");
                if (value == null) throw new IflwParseException();
                var doc = SecureXml.parse(("<rows>" + value.getTextContent() + "</rows>").getBytes(StandardCharsets.UTF_8));
                var table = new Table(entry, value, doc);
                tables.add(table);
                for (var row : children(doc.getDocumentElement())) {
                    if (!"row".equals(row.getTagName())) continue;
                    Element name = null;
                    Element cellValue = null;
                    for (var cell : children(row)) {
                        if (!"cell".equals(cell.getTagName())) continue;
                        if ("Name".equals(cell.getAttribute("id"))) name = cell;
                        if ("Value".equals(cell.getAttribute("id"))) cellValue = cell;
                    }
                    // Reject incomplete rows rather than silently losing their comparison results.
                    if (name == null || cellValue == null) throw new IflwParseException();
                    table.rows.add(new Row(type, name.getTextContent(), cellValue, table));
                }
            }
        }
    }

    private static boolean is(Element element, String namespace, String name) {
        return namespace.equals(element.getNamespaceURI()) && name.equals(element.getLocalName());
    }
    private static List<Element> children(Node node) {
        var result = new ArrayList<Element>();
        for (Node n = node.getFirstChild(); n != null; n = n.getNextSibling()) if (n instanceof Element e) result.add(e);
        return result;
    }
    private static Element child(Element parent, String name) {
        return children(parent).stream().filter(e -> name.equals(e.getLocalName())).findFirst().orElse(null);
    }
    private static String text(Element parent, String name) {
        var child = child(parent, name);
        return child == null ? null : child.getTextContent();
    }

    private static List<Entry> readZip(byte[] bytes) {
        try {
            // ZipInputStream alone accepts arbitrary input or a missing central directory.
            int end = -1;
            for (int i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
                if (number(bytes, i, 4) == 0x06054b50L && i + 22 + number(bytes, i + 20, 2) == bytes.length) {
                    end = i;
                    break;
                }
            }
            if (end < 0 || number(bytes, end + 4, 4) != 0) throw new IflwParseException();
            long count = number(bytes, end + 10, 2);
            long central = number(bytes, end + 16, 4);
            if (number(bytes, end + 8, 2) != count || central + number(bytes, end + 12, 4) != end) {
                throw new IflwParseException();
            }
            var entries = new ArrayList<Entry>();
            try (var zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) entries.add(new Entry(entry.getName(), zip.readAllBytes()));
            }
            if (entries.size() != count) throw new IflwParseException();
            var names = new LinkedHashSet<String>();
            for (int i = 0; i < count; i++) {
                int offset = Math.toIntExact(central);
                if (number(bytes, offset, 4) != 0x02014b50L) throw new IflwParseException();
                int length = (int) number(bytes, offset + 28, 2);
                String name = new String(bytes, offset + 46, length, StandardCharsets.UTF_8);
                var entry = entries.stream().filter(e -> e.name.equals(name)).findFirst().orElseThrow();
                var crc = new CRC32();
                crc.update(entry.bytes);
                if (!names.add(name) || crc.getValue() != number(bytes, offset + 16, 4)
                        || entry.bytes.length != number(bytes, offset + 24, 4)) throw new IflwParseException();
                central += 46L + length + number(bytes, offset + 30, 2) + number(bytes, offset + 32, 2);
            }
            if (central != end) throw new IflwParseException();
            return entries;
        } catch (Exception e) {
            throw new IflwParseException();
        }
    }
    private static long number(byte[] bytes, int offset, int length) {
        long value = 0;
        for (int i = 0; i < length; i++) value |= (bytes[offset + i] & 0xffL) << (8 * i);
        return value;
    }
    private static byte[] writeZip(List<Entry> entries) {
        try {
            var bytes = new ByteArrayOutputStream();
            try (var zip = new ZipOutputStream(bytes)) {
                for (var entry : entries) {
                    zip.putNextEntry(new ZipEntry(entry.name));
                    zip.write(entry.changed ? SecureXml.serialize(entry.document).getBytes(StandardCharsets.UTF_8) : entry.bytes);
                    zip.closeEntry();
                }
            }
            return bytes.toByteArray();
        } catch (Exception e) {
            throw new IflwParseException();
        }
    }
    private static final class Entry {
        final String name;
        final byte[] bytes;
        Document document;
        boolean changed;
        Entry(String name, byte[] bytes) { this.name = name; this.bytes = bytes; }
    }
    private static final class Table {
        final Entry entry;
        final Element value;
        final Document document;
        final List<Row> rows = new ArrayList<>();
        boolean changed;
        Table(Entry entry, Element value, Document document) { this.entry = entry; this.value = value; this.document = document; }
    }
    private record Row(TargetType type, String key, Element value, Table table) {}
}
