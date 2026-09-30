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
        return new TransportHistoryStore(new TransportProperties("", new TransportProperties.History(file()),
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
    @DisplayName("REQ-012 AC-3: existing replacer masking persists unchanged without sensitive values in logs")
    void req012_ac3_masked(CapturedOutput output) throws Exception {
        var settings = new TransportProperties("", new TransportProperties.History(file()), null, null, List.of("password"));
        var matcher = new SensitiveKeyMatcher(settings);
        assertThat(matcher.isSensitive("Password")).isTrue();
        var bytes = new java.io.ByteArrayOutputStream();
        try (var zip = new java.util.zip.ZipOutputStream(bytes)) {
            zip.putNextEntry(new java.util.zip.ZipEntry("main.iflw"));
            String xml = Files.readString(Path.of("src/test/resources/iflw/content-modifiers.iflw"))
                    .replace("***", "dummy-dev-secret");
            zip.write(xml.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        var processed = new IflwReplacer(matcher).process(bytes.toByteArray(), List.of(
                new MappingEntry("A", TargetType.HEADER, "Password", "dummy-dev-secret", "dummy-prd-secret")), true);
        var replacement = processed.replacements().getFirst();
        assertThat(replacement.status()).isEqualTo(ReplacementStatus.SENSITIVE_SKIPPED);
        assertThat(replacement.before()).isEqualTo("***");
        assertThat(replacement.after()).isEqualTo("***");
        var artifact = new ArtifactResult("A", null, TransportAction.NONE, List.of(replacement),
                List.of(new UnmappedKey(TargetType.HEADER, "Password")), DeployStatus.NOT_REQUESTED, null);
        var base = response(0);
        var masked = new TransportResponse(base.transportId(), base.packageId(), true, false,
                base.startedAt(), base.finishedAt(), new TransportSummary(1, 1, 0), List.of(artifact));
        store().append(masked);
        assertThat(store().findAll()).containsExactly(masked);
        assertThat(json.readTree(Files.readAllLines(file()).getFirst())).isEqualTo(json.valueToTree(masked));
        assertThat(Files.readString(file())).contains("***").doesNotContain("dummy-dev-secret", "dummy-prd-secret");
        assertThat(output.getAll()).doesNotContain("dummy-dev-secret", "dummy-prd-secret");
    }
}
