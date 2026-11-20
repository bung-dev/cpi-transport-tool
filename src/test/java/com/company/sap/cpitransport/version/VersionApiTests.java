package com.company.sap.cpitransport.version;

import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.tenant.TenantStoreKeySource;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 20261120-versioning S1: REQ-001 빌드 정보, REQ-002 GET /version, REQ-003 기동 로그 한 줄.
 * 앱을 새로 띄워 기동 로그를 잡는다(캐시된 컨텍스트는 로그가 이미 지나가 있음). 테넌트 없이, 읽기 전용(기본값)으로 띄운다.
 */
@ExtendWith(OutputCaptureExtension.class)
class VersionApiTests {
    @TempDir static Path directory;
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

    static String slash(Path path) { return path.toString().replace('\\', '/'); }

    ConfigurableApplicationContext start() {
        List<String> args = List.of("--server.port=0", "--spring.main.banner-mode=off",
                "--cpi.settings.store-file=" + slash(directory.resolve("settings.json")),
                "--cpi.tenants.store-file=" + slash(directory.resolve("tenants.enc")),
                "--cpi.transport.history.file=" + slash(directory.resolve("history.jsonl")),
                "--cpi.templates.store-file=" + slash(directory.resolve("templates.json")),
                "--cpi.audit.file=" + slash(directory.resolve("audit.jsonl")));
        return new SpringApplicationBuilder(CpiTransportToolApplication.class, TestBeans.class).run(args.toArray(String[]::new));
    }

    static HttpResponse<String> get(ConfigurableApplicationContext context, String path) throws Exception {
        int port = ((WebServerApplicationContext) context).getWebServer().getPort();
        try (var client = HttpClient.newHttpClient()) {
            return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
        }
    }

    @Test
    @DisplayName("REQ-001, REQ-002: GET /version returns the build.gradle version, a 7-char commit or unknown and an ISO-8601 UTC build time in read-only mode without tenants")
    void versionApi() throws Exception {
        String expected = System.getProperty("app.expectedVersion");
        assertThat(expected).as("test task passes build.gradle version").isNotBlank();
        try (var context = start()) {
            var response = get(context, "/version");
            assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
            JsonNode body = JSON.readTree(response.body());
            assertThat(body.get("version").asString()).isEqualTo(expected);
            assertThat(body.get("commit").asString()).matches("[0-9a-f]{7}|unknown");
            String time = body.get("buildTime").asString();
            assertThat(time).endsWith("Z").doesNotContain(".");
            assertThat(Instant.parse(time)).isNotNull();
        }
    }

    @Test
    @DisplayName("REQ-003: startup logs exactly one version line with the same values as GET /version")
    void startupLine(CapturedOutput output) throws Exception {
        try (var context = start()) {
            JsonNode body = JSON.readTree(get(context, "/version").body());
            String line = "CPI Transport Tool " + body.get("version").asString() + " (커밋 " + body.get("commit").asString()
                    + ", 빌드 " + body.get("buildTime").asString() + ")";
            var matcher = Pattern.compile(Pattern.quote("CPI Transport Tool ")).matcher(output.getOut());
            int count = 0;
            while (matcher.find()) count++;
            assertThat(count).as(output.getOut()).isEqualTo(1);
            assertThat(output.getOut()).contains(line);
        }
    }
}
