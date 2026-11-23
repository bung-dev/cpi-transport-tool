package com.company.sap.cpitransport.service;

import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
class TransportHistoryStoreTests {
    @TempDir Path temporary;
    private final JsonMapper json = JsonMapper.builder().build();
    private Path file() { return temporary.resolve("nested/history.jsonl"); }
    private TransportHistoryStore store() {
        return new TransportHistoryStore(new TransportProperties(new TransportProperties.History(file()),
                null, null, List.of("password")), json);
    }
    private TransportResponse response(int index) {
        var time = Instant.parse("2026-09-29T00:00:00Z").plusSeconds(index);
        return new TransportResponse("id-" + index, "패키지", true, false, time, time,
                new TransportSummary(0, 0, 0), List.of());
    }

    @Test
    @DisplayName("REQ-011 AC-1, AC-3: nested directory creation, UTF-8 JSON line and restart persistence")
    void req011_ac1_persistence() throws Exception {
        var response = response(0);
        store().append(response);
        var lines = Files.readAllLines(file());
        assertThat(lines).hasSize(1);
        assertThat(json.readTree(lines.getFirst())).isEqualTo(json.valueToTree(response));
        assertThat(Files.readString(file())).endsWith("\n").doesNotContain("\r");
        assertThat(store().findAll()).containsExactly(response);
    }

    @Test
    @DisplayName("REQ-011 AC-2: absent history returns empty without creating files")
    void req011_ac2_missing() {
        assertThat(store().findAll()).isEmpty();
        assertThat(Files.exists(file().getParent())).isFalse();
    }

    @Test
    @DisplayName("REQ-011 AC-4, AC-2: bad lines skipped with line-number-only warnings and newest first")
    void req011_ac4_corruption(CapturedOutput output) throws Exception {
        store().append(response(1));
        Files.writeString(file(), "\n  \n{broken-private-content\nnull\n{}\n", StandardOpenOption.APPEND);
        store().append(response(3));
        store().append(response(2));
        assertThat(store().findAll()).containsExactly(response(3), response(2), response(1));
        assertThat(output.getAll()).contains("Skipping unreadable history line 4",
                "Skipping unreadable history line 5", "Skipping unreadable history line 6")
                .doesNotContain("broken-private-content");
    }

    @Test
    @DisplayName("REQ-011 AC-5: twenty concurrent writers across store instances retain complete records")
    void req011_ac5_concurrent() throws Exception {
        var ready = new CountDownLatch(20);
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(20)) {
            var futures = new ArrayList<Future<?>>();
            for (int i = 0; i < 20; i++) {
                int index = i;
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Start timed out");
                    store().append(response(index));
                    return null;
                }));
            }
            try { assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue(); }
            finally { start.countDown(); }
            for (var future : futures) future.get(10, TimeUnit.SECONDS);
        }
        var lines = Files.readAllLines(file());
        assertThat(lines).hasSize(20);
        var ids = new HashSet<String>();
        for (var line : lines) ids.add(json.readValue(line, TransportResponse.class).transportId());
        assertThat(ids).hasSize(20);
        assertThat(store().findAll()).hasSize(20).isSortedAccordingTo(
                Comparator.comparing(TransportResponse::startedAt).reversed());
    }

    @Test
    @DisplayName("REQ-504: configurations persist in the response format with sensitive values in plain text and no value in logs")
    void req504_configurationsPersist(CapturedOutput output) throws Exception {
        var artifact = new ArtifactResult("A", null, TransportAction.CREATED, List.of(
                new ConfigurationItem("ClientPassword", "dummy-dev-pass-history", "xsd:string", ConfigurationStatus.COPIED),
                new ConfigurationItem("Endpoint", "http://dev.localhost/history", "xsd:string", ConfigurationStatus.FAILED)),
                DeployStatus.NOT_REQUESTED, null);
        var base = response(0);
        var saved = new TransportResponse(base.transportId(), "패키지", false, false,
                base.startedAt(), base.finishedAt(), new TransportSummary(1, 1, 0), List.of(artifact));
        store().append(saved);
        assertThat(store().findAll()).containsExactly(saved);
        var line = json.readTree(Files.readAllLines(file()).getFirst());
        assertThat(line).isEqualTo(json.valueToTree(saved));
        assertThat(line.at("/results/0").propertyNames())
                // 20261121-package-objects REQ-1003: 이력 결과에 오브젝트 종류(type)가 기록된다.
                .containsExactlyInAnyOrder("type", "packageId", "artifactId", "status", "action", "configurations", "deployStatus", "error");
        assertThat(line.at("/results/0/configurations/0").propertyNames())
                .containsExactlyInAnyOrder("key", "value", "dataType", "status");
        assertThat(line.at("/results/0/configurations/0/value").asString()).isEqualTo("dummy-dev-pass-history");
        assertThat(output.getAll()).doesNotContain("dummy-dev-pass-history", "http://dev.localhost/history");
    }

    @Test
    @DisplayName("REQ-504: a legacy line with replacements and unmappedKeys is returned with empty configurations and the file is left unchanged")
    void req504_legacyLine() throws Exception {
        Files.createDirectories(file().getParent());
        String legacy = "{\"transportId\":\"legacy-1\",\"packageId\":\"Pkg\",\"dryRun\":false,\"deploy\":false,"
                + "\"startedAt\":\"2026-09-29T00:00:00Z\",\"finishedAt\":\"2026-09-29T00:00:01Z\","
                + "\"summary\":{\"total\":1,\"succeeded\":1,\"failed\":0},\"results\":[{\"artifactId\":\"A\",\"status\":\"SUCCESS\","
                + "\"action\":\"UPDATED\",\"replacements\":[{\"targetType\":\"HEADER\",\"key\":\"K\",\"status\":\"APPLIED\","
                + "\"before\":\"dev\",\"after\":\"prd\",\"occurrences\":1}],\"unmappedKeys\":[{\"targetType\":\"PROPERTY\",\"key\":\"U\"}],"
                + "\"deployStatus\":\"NOT_REQUESTED\",\"error\":null}],\"sourceTenant\":{\"id\":\"DEV\",\"name\":\"DEV\"},"
                + "\"targetTenant\":{\"id\":\"PRD\",\"name\":\"PRD\"}}\n";
        Files.writeString(file(), legacy);
        store().append(response(5));
        var all = store().findAll();
        assertThat(all).extracting(TransportResponse::transportId).containsExactly("id-5", "legacy-1");
        var old = all.get(1).results().getFirst();
        assertThat(old.artifactId()).isEqualTo("A");
        assertThat(old.action()).isEqualTo(TransportAction.UPDATED);
        assertThat(old.configurations()).isEmpty();
        assertThat(Files.readAllLines(file()).getFirst() + "\n").isEqualTo(legacy);
    }

    @Test
    @DisplayName("REQ-702: legacy configuration statuses COPIED, SKIPPED_EMPTY and FAILED are returned as written next to new BUNDLED rows and the file is left unchanged")
    void req702_legacyConfigurationStatuses() throws Exception {
        Files.createDirectories(file().getParent());
        String legacy = "{\"transportId\":\"legacy-2\",\"packageId\":\"Pkg\",\"dryRun\":false,\"deploy\":false,"
                + "\"startedAt\":\"2026-09-29T00:00:00Z\",\"finishedAt\":\"2026-09-29T00:00:01Z\","
                + "\"summary\":{\"total\":1,\"succeeded\":0,\"failed\":1},\"results\":[{\"artifactId\":\"A\",\"status\":\"FAILED\","
                + "\"action\":\"CREATED\",\"configurations\":["
                + "{\"key\":\"Endpoint\",\"value\":\"dev\",\"dataType\":\"xsd:string\",\"status\":\"COPIED\"},"
                + "{\"key\":\"Password\",\"value\":\"\",\"dataType\":\"xsd:string\",\"status\":\"SKIPPED_EMPTY\"},"
                + "{\"key\":\"Next\",\"value\":\"42\",\"dataType\":\"xsd:integer\",\"status\":\"FAILED\"}],"
                + "\"deployStatus\":\"NOT_REQUESTED\",\"error\":{\"code\":\"CONFIGURATION_UPDATE_FAILED\","
                + "\"message\":\"CONFIGURATION_UPDATE: Next: HTTP 500\"}}]}\n";
        Files.writeString(file(), legacy);
        var base = response(6);
        var bundled = new TransportResponse(base.transportId(), "패키지", false, false, base.startedAt(), base.finishedAt(),
                new TransportSummary(1, 1, 0), List.of(new ArtifactResult("B", null, TransportAction.CREATED,
                List.of(new ConfigurationItem("Endpoint", "dev", "xsd:string", ConfigurationStatus.BUNDLED)),
                DeployStatus.NOT_REQUESTED, null)));
        store().append(bundled);
        var all = store().findAll();
        assertThat(all).extracting(TransportResponse::transportId).containsExactly("id-6", "legacy-2");
        assertThat(all.get(0).results().getFirst().configurations()).extracting(ConfigurationItem::status)
                .containsExactly(ConfigurationStatus.BUNDLED);
        var old = all.get(1).results().getFirst();
        assertThat(old.configurations()).extracting(ConfigurationItem::key, ConfigurationItem::status).containsExactly(
                org.assertj.core.groups.Tuple.tuple("Endpoint", ConfigurationStatus.COPIED),
                org.assertj.core.groups.Tuple.tuple("Password", ConfigurationStatus.SKIPPED_EMPTY),
                org.assertj.core.groups.Tuple.tuple("Next", ConfigurationStatus.FAILED));
        assertThat(old.error().code()).isEqualTo("CONFIGURATION_UPDATE_FAILED");
        assertThat(Files.readAllLines(file()).getFirst() + "\n").isEqualTo(legacy);
        assertThat(json.readTree(Files.readAllLines(file()).get(1)).at("/results/0/configurations/0/status").asString())
                .isEqualTo("BUNDLED");
    }
}
