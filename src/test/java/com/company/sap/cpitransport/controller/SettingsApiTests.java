package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.model.ConcurrencySettings;
import com.company.sap.cpitransport.settings.SettingsService;
import com.company.sap.cpitransport.tenant.TenantStoreKeySource;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;

/**
 * 20261119-transport-speedup S2: REQ-705 동시 처리 설정 API와 저장, REQ-706 설정 변경 감사.
 * 앱은 읽기 전용 모드(기본값)로 띄운다. 설정 저장은 읽기 전용에서도 된다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = {CpiTransportToolApplication.class, SettingsApiTests.TestBeans.class})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@ExtendWith(OutputCaptureExtension.class)
class SettingsApiTests {
    @TempDir static Path directory;
    @LocalServerPort int port;
    @Autowired SettingsService settings;
    static final ObjectMapper JSON = new ObjectMapper();
    static final String KEY = randomKey();

    @TestConfiguration(proxyBeanMethods = false)
    static class TestBeans {
        @Bean @Primary TenantStoreKeySource testKey() { return () -> Optional.of(KEY); }
    }

    static String randomKey() {
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    static Path settingsFile() { return directory.resolve("nested/settings.json"); }

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry values) {
        values.add("cpi.settings.store-file", () -> settingsFile().toString());
        values.add("cpi.tenants.store-file", () -> directory.resolve("tenants.enc").toString());
        values.add("cpi.transport.history.file", () -> directory.resolve("history.jsonl").toString());
        values.add("cpi.templates.store-file", () -> directory.resolve("templates.json").toString());
        values.add("cpi.audit.file", () -> directory.resolve("audit.jsonl").toString());
        values.add("cpi.transport.read-only", () -> "true");
    }

    // ---- REQ-705 ----

    @Test @Order(1)
    @DisplayName("REQ-705: without a saved file GET /settings returns the configured defaults 4 and 4 and creates no file")
    void req705_defaults() throws Exception {
        assertThat(ok(request("GET", "/settings", null))).isEqualTo(JSON.readTree(
                "{\"previewConcurrency\":4,\"transportConcurrency\":4}"));
        assertThat(Files.exists(settingsFile())).isFalse();
        assertThat(settings.current()).isEqualTo(new ConcurrencySettings(4, 4));
    }

    @Test @Order(2)
    @DisplayName("REQ-705, REQ-706: read-only mode saves new values to the store file, returns them, applies them and audits only changed values")
    void req705_save() throws Exception {
        var saved = ok(request("PUT", "/settings", "{\"previewConcurrency\":6,\"transportConcurrency\":2}"));
        assertThat(saved).isEqualTo(JSON.readTree("{\"previewConcurrency\":6,\"transportConcurrency\":2}"));
        assertThat(ok(request("GET", "/settings", null))).isEqualTo(saved);
        assertThat(settings.current()).isEqualTo(new ConcurrencySettings(6, 2));
        var file = JSON.readTree(Files.readString(settingsFile()));
        assertThat(file.get("previewConcurrency").asInt()).isEqualTo(6);
        assertThat(file.get("transportConcurrency").asInt()).isEqualTo(2);
        var audit = settingsAudit();
        assertThat(audit).hasSize(1);
        assertThat(audit.getFirst().get("category").asString()).isEqualTo("settings");
        assertThat(audit.getFirst().get("action").asString()).isEqualTo("updated");
        assertThat(audit.getFirst().get("objectName").asString()).isEqualTo("동시 처리");
        assertThat(audit.getFirst().get("detail").asString()).isEqualTo("미리보기 4→6, 실제 이관 4→2");

        ok(request("PUT", "/settings", "{\"previewConcurrency\":6,\"transportConcurrency\":3}"));
        audit = settingsAudit();
        assertThat(audit).hasSize(2);
        assertThat(audit.getFirst().get("detail").asString()).isEqualTo("실제 이관 2→3");

        ok(request("PUT", "/settings", "{\"previewConcurrency\":1,\"transportConcurrency\":3}"));
        assertThat(settingsAudit().getFirst().get("detail").asString()).isEqualTo("미리보기 6→1");
    }

    @Test @Order(3)
    @DisplayName("REQ-706: saving the same values succeeds without an audit entry and the settings category filters audit history")
    void req706_unchangedNotAudited() throws Exception {
        int before = settingsAudit().size();
        var same = ok(request("PUT", "/settings", "{\"previewConcurrency\":1,\"transportConcurrency\":3}"));
        assertThat(same).isEqualTo(JSON.readTree("{\"previewConcurrency\":1,\"transportConcurrency\":3}"));
        assertThat(settingsAudit()).hasSize(before);
        var all = ok(request("GET", "/audit", null));
        int settingsEntries = 0;
        for (var entry : all) if (entry.get("category").asString().equals("settings")) settingsEntries++;
        assertThat(settingsEntries).isEqualTo(before);
    }

    @ParameterizedTest(name = "{displayName} [{index}] {0}")
    @ValueSource(strings = {
            "{\"previewConcurrency\":0,\"transportConcurrency\":3}",
            "{\"previewConcurrency\":1,\"transportConcurrency\":9}",
            "{\"previewConcurrency\":-1,\"transportConcurrency\":3}",
            "{\"previewConcurrency\":2.5,\"transportConcurrency\":3}",
            "{\"previewConcurrency\":\"2\",\"transportConcurrency\":3}",
            "{\"previewConcurrency\":null,\"transportConcurrency\":3}",
            "{\"transportConcurrency\":3}",
            "{\"previewConcurrency\":2}",
            "{}", "[]", "not json", ""})
    @Order(4)
    @DisplayName("REQ-705: missing, non-integer or out-of-range values are rejected with 400 INVALID_REQUEST and nothing changes")
    void req705_invalid(String body) throws Exception {
        String fileBefore = Files.readString(settingsFile());
        int auditBefore = settingsAudit().size();
        var response = request("PUT", "/settings", body);
        assertThat(response.statusCode()).as(response.body()).isEqualTo(400);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("INVALID_REQUEST");
        assertThat(ok(request("GET", "/settings", null))).isEqualTo(JSON.readTree(
                "{\"previewConcurrency\":1,\"transportConcurrency\":3}"));
        assertThat(Files.readString(settingsFile())).isEqualTo(fileBefore);
        assertThat(settingsAudit()).hasSize(auditBefore);
    }

    @Test @Order(5)
    @DisplayName("REQ-705: saved values survive an application restart")
    void req705_restart() throws Exception {
        try (var context = start(settingsFile(), Map.of())) {
            assertThat(ok(request(port(context), "GET", "/settings", null))).isEqualTo(JSON.readTree(
                    "{\"previewConcurrency\":1,\"transportConcurrency\":3}"));
        }
    }

    @Test @Order(6)
    @DisplayName("REQ-705: an unreadable store file falls back to configured values with a warning and the next PUT rewrites it")
    void req705_brokenFile(CapturedOutput output) throws Exception {
        Path broken = directory.resolve("broken/settings.json");
        Files.createDirectories(broken.getParent());
        Files.writeString(broken, "{broken-private-content");
        try (var context = start(broken, Map.of("cpi.transport.preview-concurrency", "2"))) {
            int other = port(context);
            assertThat(ok(request(other, "GET", "/settings", null))).isEqualTo(JSON.readTree(
                    "{\"previewConcurrency\":2,\"transportConcurrency\":4}"));
            assertThat(output.getAll()).containsIgnoringCase("WARN").containsIgnoringCase("settings")
                    .doesNotContain("broken-private-content");
            ok(request(other, "PUT", "/settings", "{\"previewConcurrency\":5,\"transportConcurrency\":5}"));
            var file = JSON.readTree(Files.readString(broken));
            assertThat(file.get("previewConcurrency").asInt()).isEqualTo(5);
            assertThat(file.get("transportConcurrency").asInt()).isEqualTo(5);
        }
    }

    @ParameterizedTest(name = "{displayName} [{0}={1}]")
    @CsvSource({
            "cpi.transport.preview-concurrency, 0", "cpi.transport.preview-concurrency, 9",
            "cpi.transport.transport-concurrency, 0", "cpi.transport.transport-concurrency, 9"})
    @Order(7)
    @DisplayName("REQ-705: a configured concurrency outside 1..8 stops the application and names the property")
    void req705_invalidConfiguration(String property, String value) {
        assertThatThrownBy(() -> start(directory.resolve("never/settings.json"), Map.of(property, value)).close())
                .satisfies(failure -> {
                    var messages = new StringBuilder();
                    for (Throwable t = failure; t != null; t = t.getCause()) messages.append(t.getMessage()).append('\n');
                    assertThat(messages.toString()).contains(property);
                });
    }

    // ---- helpers ----

    List<JsonNode> settingsAudit() throws Exception {
        var list = new ArrayList<JsonNode>();
        for (var entry : ok(request("GET", "/audit?category=settings", null))) list.add(entry);
        assertThat(list).allSatisfy(e -> assertThat(e.get("category").asString()).isEqualTo("settings"));
        return list;
    }
    HttpResponse<String> request(String method, String path, String body) throws Exception {
        return request(port, method, path, body);
    }
    static HttpResponse<String> request(int port, String method, String path, String body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        try (var client = HttpClient.newHttpClient()) {
            return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        }
    }
    static JsonNode ok(HttpResponse<String> response) {
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return JSON.readTree(response.body());
    }
    ConfigurableApplicationContext start(Path store, Map<String, String> extra) {
        List<String> args = new ArrayList<>(List.of("--server.port=0", "--spring.main.banner-mode=off",
                "--cpi.settings.store-file=" + slash(store),
                "--cpi.tenants.store-file=" + slash(directory.resolve("other-tenants.enc")),
                "--cpi.transport.history.file=" + slash(directory.resolve("other-history.jsonl")),
                "--cpi.templates.store-file=" + slash(directory.resolve("other-templates.json")),
                "--cpi.audit.file=" + slash(directory.resolve("other-audit.jsonl"))));
        extra.forEach((key, value) -> args.add("--" + key + "=" + value));
        return new SpringApplicationBuilder(CpiTransportToolApplication.class, TestBeans.class).run(args.toArray(String[]::new));
    }
    static String slash(Path path) { return path.toString().replace('\\', '/'); }
    static int port(ConfigurableApplicationContext context) {
        return ((org.springframework.boot.web.server.context.WebServerApplicationContext) context).getWebServer().getPort();
    }
}
