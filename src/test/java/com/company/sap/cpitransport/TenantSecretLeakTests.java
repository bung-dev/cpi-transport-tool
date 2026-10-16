package com.company.sap.cpitransport;

import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.stub.LocalCpiStubs;
import com.company.sap.cpitransport.tenant.TenantStoreKeySource;
import com.github.tomakehurst.wiremock.WireMockServer;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = {CpiTransportToolApplication.class, TenantSecretLeakTests.TestSettings.class},
        properties = {"cpi.transport.read-only=false", "logging.level.org.springframework.web=TRACE",
                "logging.level.com.company=TRACE"})
@ExtendWith(OutputCaptureExtension.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TenantSecretLeakTests {
    @TempDir static Path directory;
    @LocalServerPort int port;
    private static final JsonMapper JSON = new JsonMapper();
    private static final String STORE_KEY = randomKey();
    private static final Set<String> SECRETS = new LinkedHashSet<>(List.of(STORE_KEY,
            "dummy-dev-client", "dummy-dev-secret", "dummy-prd-client", "dummy-prd-secret",
            "dummy-dev-token-0001", "dummy-prd-token-0001", "dummy-dev-csrf-0001", "dummy-prd-csrf-0001",
            "dummy-dev-session-0001", "dummy-prd-session-0001",
            "dummy-dev-apikey-123", "dummy-prd-apikey-456", "dummy-dev-pass-XYZ", "dummy-prd-pass-UVW"));
    private final List<String> responses = new ArrayList<>();
    private LocalCpiStubs stubs;
    private String sourceId;
    private String targetId;
    private String sourceClient;
    private String sourceSecret;

    private static String randomKey() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestSettings {
        @Bean @Primary TenantStoreKeySource testStoreKey() { return () -> Optional.of(STORE_KEY); }
        @Bean @Primary Clock testClock() { return Clock.fixed(Instant.parse("2026-10-16T00:00:00Z"), ZoneOffset.UTC); }
        @Bean @Primary Sleeper testSleeper() { return duration -> {}; }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry values) {
        values.add("cpi.tenants.store-file", () -> directory.resolve("tenants.enc").toString());
        values.add("cpi.transport.history.file", () -> directory.resolve("history.jsonl").toString());
        values.add("cpi.transport.mapping-file", () -> Path.of("examples/mapping-example.yml").toAbsolutePath().toString());
        // AI-NOTE: isolate both initial tenants from the caller's configuration (REQ-305 AC-3).
        for (String env : List.of("dev", "prd")) {
            for (String field : List.of("api-url", "token-url", "client-id", "client-secret")) {
                values.add("cpi.environments." + env + "." + field, () -> "");
            }
        }
    }

    @BeforeEach
    void registerTenants() throws Exception {
        stubs = new LocalCpiStubs(directory.resolve(UUID.randomUUID().toString()));
        stubs.start(0, 0);
        String suffix = UUID.randomUUID().toString();
        sourceClient = "test-dummy-source-client-" + suffix;
        sourceSecret = "test-dummy-source-secret-" + suffix;
        sourceId = register("Source " + suffix.substring(0, 8), stubs.dev(), "dev", sourceClient, sourceSecret);
        targetId = register("Target " + suffix.substring(0, 8), stubs.prd(), "prd",
                "test-dummy-target-client-" + suffix, "test-dummy-target-secret-" + suffix);
        for (WireMockServer server : List.of(stubs.dev(), stubs.prd())) {
            server.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages?$top=1")).atPriority(0)
                    .willReturn(okJson("{\"d\":{\"results\":[]}}")));
        }
    }

    @AfterEach
    void stopStubs() { if (stubs != null) stubs.stop(); }

    private String register(String name, WireMockServer server, String env, String client, String secret) throws Exception {
        token(server, env, client, secret);
        var response = request("POST", "/tenants", registration(name, server, client, secret), 201);
        return JSON.readTree(response).path("id").asString();
    }

    private void token(WireMockServer server, String env, String client, String secret) {
        SECRETS.add(client);
        SECRETS.add(secret);
        SECRETS.add(Base64.getEncoder().encodeToString((client + ":" + secret).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        server.stubFor(post(urlEqualTo("/oauth/token")).atPriority(0).withBasicAuth(client, secret)
                .willReturn(okJson(JSON.writeValueAsString(Map.of("access_token", "dummy-" + env + "-token-0001",
                        "token_type", "bearer", "expires_in", 3600)))));
    }

    private String registration(String name, WireMockServer server, String client, String secret) {
        return JSON.writeValueAsString(Map.of("name", name, "serviceKey", Map.of("oauth", Map.of(
                "url", server.baseUrl(), "tokenurl", server.baseUrl() + "/oauth/token",
                "clientid", client, "clientsecret", secret))));
    }

    private String request(String method, String path, String body, int expectedStatus) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        try (var client = HttpClient.newHttpClient()) {
            var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            responses.add(response.body());
            assertThat(response.statusCode()).isEqualTo(expectedStatus);
            return response.body();
        }
    }

    private JsonNode status(String id, String expectedCheck) throws Exception {
        var body = JSON.readTree(request("GET", "/tenants/status?tenantId=" + id + "&refresh=true", null, 200));
        assertThat(body.path("readOnly").asBoolean()).isFalse();
        assertThat(body.path("tenants").get(0).path("check").asString()).isEqualTo(expectedCheck);
        return body;
    }

    private JsonNode transport(boolean dryRun, String packageId, List<String> ids) throws Exception {
        return JSON.readTree(request("POST", "/transport", JSON.writeValueAsString(Map.of(
                "packageId", packageId, "artifactIds", ids, "dryRun", dryRun, "deploy", true,
                "sourceTenantId", sourceId, "targetTenantId", targetId)), 200));
    }

    private void noLeaks(CapturedOutput output) throws Exception {
        request("GET", "/transport/history", null, 200);
        String[] forbidden = SECRETS.toArray(String[]::new);
        assertThat(output.getAll()).contains("TRACE").doesNotContain(forbidden)
                .doesNotContain("\"oauth\":{", "\"serviceKey\":{");
        for (String response : responses) {
            assertThat(response).doesNotContain(forbidden).doesNotContain("\"oauth\":{", "\"serviceKey\":{");
        }
        Path history = directory.resolve("history.jsonl");
        if (Files.exists(history)) {
            assertThat(Files.readString(history)).doesNotContain(forbidden)
                    .doesNotContain("\"oauth\":{", "\"serviceKey\":{");
        }
        // Check encrypted bytes as well as public responses and the persisted history.
        assertThat(new String(Files.readAllBytes(directory.resolve("tenants.enc")),
                java.nio.charset.StandardCharsets.ISO_8859_1)).doesNotContain(forbidden);
    }

    @Test
    @DisplayName("REQ-305 AC-3: registration update and malformed service keys remain private at TRACE")
    void req305_ac3_registrationUpdate(CapturedOutput output) throws Exception {
        String client = "test-dummy-rotated-client";
        String secret = "test-dummy-rotated-secret";
        token(stubs.dev(), "dev", client, secret);
        request("PUT", "/tenants/" + sourceId, registration("Rotated source", stubs.dev(), client, secret), 200);
        status(sourceId, "OK");
        stubs.dev().verify(1, postRequestedFor(urlEqualTo("/oauth/token")).withBasicAuth(new com.github.tomakehurst.wiremock.client.BasicCredentials(client, secret)));
        String invalid = registration("Invalid source", stubs.dev(), client, secret)
                .replace(stubs.dev().baseUrl() + "/oauth/token", "test-dummy-invalid-uri");
        SECRETS.add("test-dummy-invalid-uri");
        request("POST", "/tenants", invalid, 400);
        request("PUT", "/tenants/" + sourceId, invalid, 400);
        String broken = "{\"serviceKey\":{\"oauth\":{\"clientsecret\":\"" + secret + "\",\"clientid\":\"" + client;
        request("POST", "/tenants", broken, 400);
        request("PUT", "/tenants/" + sourceId, broken, 400);
        request("GET", "/tenants", null, 200);
        noLeaks(output);
    }

    @Test
    @DisplayName("REQ-305 AC-3: registered status dry run upload parameters and deployment hide secrets in responses logs and history")
    void req305_ac3_transports(CapturedOutput output) throws Exception {
        status(sourceId, "OK");
        status(targetId, "OK");
        int targetRequests = stubs.prd().getAllServeEvents().size();
        var dry = transport(true, "PkgTransportDemo", List.of("IF_Order_Sync", "IF_Customer_Push"));
        assertThat(dry.path("summary").path("succeeded").asInt()).isEqualTo(2);
        assertThat(stubs.prd().getAllServeEvents()).hasSize(targetRequests);
        var real = transport(false, "PkgTransportDemo", List.of("IF_Order_Sync", "IF_Customer_Push"));
        assertThat(real.path("summary").path("succeeded").asInt()).isEqualTo(2);
        assertThat(real.path("summary").path("failed").asInt()).isZero();
        for (var result : real.path("results")) {
            assertThat(result.path("deployStatus").asString()).isEqualTo("STARTED");
        }
        stubs.prd().verify(1, postRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts")));
        stubs.prd().verify(2, postRequestedFor(urlPathEqualTo("/api/v1/DeployIntegrationDesigntimeArtifact")));
        assertThat(Files.readString(directory.resolve("history.jsonl"))).contains(dry.path("transportId").asString(),
                real.path("transportId").asString());
        noLeaks(output);
    }

    @Test
    @DisplayName("REQ-305 AC-3: token 403 HTML foreign next page and transport failures never echo upstream secrets")
    void req305_ac3_failures(CapturedOutput output) throws Exception {
        String echo = String.join(" ", SECRETS);
        stubs.dev().stubFor(post(urlEqualTo("/oauth/token")).atPriority(0)
                .willReturn(aResponse().withStatus(401).withBody(echo)));
        status(sourceId, "TOKEN_FAILED");
        request("GET", "/packages?tenantId=" + sourceId, null, 502);
        noLeaks(output);

        token(stubs.dev(), "dev", sourceClient, sourceSecret);
        stubs.dev().stubFor(get(urlPathEqualTo("/api/v1/IntegrationPackages")).atPriority(0)
                .willReturn(aResponse().withStatus(403).withBody(echo)));
        status(sourceId, "API_FORBIDDEN");
        request("GET", "/packages?tenantId=" + sourceId, null, 502);
        noLeaks(output);

        stubs.dev().stubFor(get(urlPathEqualTo("/api/v1/IntegrationPackages")).atPriority(0)
                .willReturn(ok("<html>" + echo + "</html>").withHeader("Content-Type", "text/html")));
        status(sourceId, "ERROR");
        request("GET", "/packages?tenantId=" + sourceId, null, 502);
        noLeaks(output);

        // AI-NOTE: a different localhost spelling is a different host; never follow it with a token (REQ-305 AC-3).
        String next = "http://127.0.0.1:" + stubs.dev().port() + "/must-not-follow?value=" + sourceSecret;
        stubs.dev().stubFor(get(urlEqualTo("/api/v1/IntegrationPackages")).atPriority(0)
                .willReturn(okJson(JSON.writeValueAsString(Map.of("d", Map.of("results", List.of(), "__next", next))))));
        request("GET", "/packages?tenantId=" + sourceId, null, 502);
        stubs.dev().verify(0, getRequestedFor(urlPathEqualTo("/must-not-follow")));
        noLeaks(output);

        stubs.dev().stubFor(get(urlEqualTo("/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Fault_Download400',Version='active')/$value"))
                .atPriority(0).willReturn(aResponse().withStatus(400).withBody(echo)));
        var failed = transport(false, "PkgFaultDemo", List.of("IF_Fault_Download400", "IF_Fault_A"));
        assertThat(failed.path("summary").path("failed").asInt()).isEqualTo(1);
        assertThat(failed.path("summary").path("succeeded").asInt()).isEqualTo(1);
        assertThat(failed.path("results").get(0).path("error").path("code").asString()).isEqualTo("DOWNLOAD_FAILED");
        noLeaks(output);
    }
}
