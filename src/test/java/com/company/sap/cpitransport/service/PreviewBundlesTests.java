package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.model.ConfigurationItem;
import com.company.sap.cpitransport.model.ConfigurationStatus;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.List;
import org.junit.jupiter.api.*;
import static org.assertj.core.api.Assertions.*;

/**
 * 20261121-perf-retry S4, REQ-901 미리보기 묶음 보관(메모리).
 * 테스트 계약: {@code PreviewBundles(Clock)}, {@code put(previewId, sourceTenantId, artifactId, version, zip, configurations)},
 * {@code complete(previewId)}(미리보기가 끝남 = 30분 보관 시작), {@code find(previewId, sourceTenantId, artifactId, version)} → Optional&lt;Bundle(zip, configurations)&gt;.
 */
class PreviewBundlesTests {
    static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-11-21T00:00:00Z");
        void advance(Duration duration) { now = now.plus(duration); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
    final MutableClock clock = new MutableClock();
    final List<ConfigurationItem> configurations = List.of(new ConfigurationItem("Endpoint", "dev", "xsd:string", ConfigurationStatus.PLANNED));

    byte[] zip(String id) { return ("zip-" + id).getBytes(StandardCharsets.UTF_8); }

    PreviewBundles stored(String previewId) {
        var bundles = new PreviewBundles(clock);
        bundles.put(previewId, "DEV", "IF_A", "1.0.0", zip("IF_A"), configurations);
        bundles.complete(previewId);
        return bundles;
    }

    @Test
    @DisplayName("REQ-901: a completed preview bundle is found by preview id, source tenant, artifact id and version")
    void req901_found() {
        var bundles = stored("p-1");
        var found = bundles.find("p-1", "DEV", "IF_A", "1.0.0");
        assertThat(found).isPresent();
        assertThat(found.get().zip()).isEqualTo(zip("IF_A"));
        assertThat(found.get().configurations()).isEqualTo(configurations);
    }

    @Test
    @DisplayName("REQ-902 failure: a different source tenant, version, artifact or preview id finds nothing")
    void req902_mismatch() {
        var bundles = stored("p-1");
        assertThat(bundles.find("p-1", "QA", "IF_A", "1.0.0")).isEmpty();
        assertThat(bundles.find("p-1", "DEV", "IF_A", "1.0.1")).isEmpty();
        assertThat(bundles.find("p-1", "DEV", "IF_B", "1.0.0")).isEmpty();
        assertThat(bundles.find("p-2", "DEV", "IF_A", "1.0.0")).isEmpty();
        assertThat(bundles.find(null, "DEV", "IF_A", "1.0.0")).isEmpty();
    }

    @Test
    @DisplayName("REQ-901: a bundle is kept for 30 minutes from the end of the preview and then gone")
    void req901_expiry() {
        var bundles = stored("p-1");
        clock.advance(Duration.ofMinutes(30).minusSeconds(1));
        assertThat(bundles.find("p-1", "DEV", "IF_A", "1.0.0")).isPresent();
        clock.advance(Duration.ofSeconds(2));
        assertThat(bundles.find("p-1", "DEV", "IF_A", "1.0.0")).isEmpty();
    }

    @Test
    @DisplayName("REQ-901: only the latest 5 previews are kept; the 6th drops the oldest")
    void req901_limit() {
        var bundles = new PreviewBundles(clock);
        for (int i = 1; i <= 6; i++) {
            bundles.put("p-" + i, "DEV", "IF_A", "1.0.0", zip("IF_A" + i), configurations);
            bundles.complete("p-" + i);
            clock.advance(Duration.ofSeconds(1));
        }
        assertThat(bundles.find("p-1", "DEV", "IF_A", "1.0.0")).isEmpty();
        for (int i = 2; i <= 6; i++) {
            assertThat(bundles.find("p-" + i, "DEV", "IF_A", "1.0.0")).as("p-" + i).isPresent();
        }
    }
}
