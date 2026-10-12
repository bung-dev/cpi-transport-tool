package com.company.sap.cpitransport.controller;

import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.*;
import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.tenant.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.annotation.DirtiesContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = {CpiTransportToolApplication.class, TenantControllerTests.Keys.class})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TenantControllerTests {
    @TempDir static Path directory;
    @LocalServerPort int port;
    @Autowired TenantRegistry registry;
    @Autowired CpiProperties properties;
    @Autowired Clock clock;
    static final ObjectMapper JSON = new ObjectMapper();
    static final String KEY = randomKey();
    static WireMockServer server;

    static String randomKey() {
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }
    @TestConfiguration(proxyBeanMethods = false)
    static class Keys {
        @Bean @Primary TenantStoreKeySource testKey() { return () -> Optional.of(KEY); }
    }
    @TestConfiguration(proxyBeanMethods = false)
    static class RestartKeys {
        static String value;
        @Bean @Primary TenantStoreKeySource restartKey() { return () -> Optional.ofNullable(value); }
    }
    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry values) {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost")); server.start();
        values.add("cpi.tenants.store-file", () -> directory.resolve("tenants.enc").toString());
        values.add("cpi.transport.history.file", () -> directory.resolve("history.jsonl").toString());
        for (String env : List.of("dev", "prd")) {
            String prefix = "cpi.environments." + env + ".";
            values.add(prefix + "api-url", () -> server.baseUrl() + "/api/v1");
            values.add(prefix + "token-url", () -> server.baseUrl() + "/oauth/token");
            values.add(prefix + "client-id", () -> "test-dummy-env-client");
            values.add(prefix + "client-secret", () -> "test-dummy-env-secret");
        }
    }
    @AfterAll static void stop() { if (server != null) server.stop(); }

    static JsonNode body(String name, String base) {
        var node = JSON.createObjectNode().put("name", name);
        var key = node.putObject("serviceKey"); key.put("createdate", "ignored");
        var oauth = key.putObject("oauth");
        oauth.put("url", base + "/api/v1"); oauth.put("tokenurl", base + "/oauth/token");
        oauth.put("clientid", "test-dummy-api-client"); oauth.put("clientsecret", "test-dummy-api-secret");
        return node;
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
    HttpResponse<String> request(String method, String path, String body) throws Exception {
        return request(port, method, path, body);
    }
    static JsonNode response(HttpResponse<String> response, int status) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.body()).doesNotContain("test-dummy-api-client", "test-dummy-api-secret", KEY,
                "test-dummy-new-client", "test-dummy-new-secret",
                "/oauth/token", "clientsecret", "\"serviceKey\"");
        return JSON.readTree(response.body());
    }
    static void error(HttpResponse<String> response, int status, String code, String message) {
        // INVALID_SERVICE_KEY legitimately names fields; never inspect the original key values in logs.
        assertThat(response.statusCode()).isEqualTo(status);
        var node = JSON.readTree(response.body());
        assertThat(node.properties()).hasSize(2);
        assertThat(node.get("error").asString()).isEqualTo(code);
        assertThat(node.get("message").asString()).isEqualTo(message);
        assertThat(response.body()).doesNotContain("test-dummy-api-client", "test-dummy-api-secret", KEY);
    }
    String register(String name) throws Exception {
        return response(request("POST", "/tenants", JSON.writeValueAsString(body(name, server.baseUrl()))), 201)
                .get("id").asString();
    }

    @Test
    @DisplayName("REQ-301 AC-1·AC-3·AC-7·AC-9: exact public fields initial order and confidential values absent")
    void req301_ac1_contract() throws Exception {
        var registered = response(request("POST", "/tenants", JSON.writeValueAsString(body("  API contract  ", server.baseUrl()))), 201);
        assertThat(registered.propertyNames()).containsExactlyInAnyOrder("id", "name", "source", "apiHost", "createdAt");
        assertThat(registered.get("id").asString()).matches("[A-Za-z0-9-]{1,64}").isNotIn("DEV", "PRD");
        assertThat(registered.get("name").asString()).isEqualTo("API contract");
        assertThat(registered.get("source").asString()).isEqualTo("registered");
        assertThat(registered.get("apiHost").asString()).isEqualTo("localhost");
        assertThat(java.time.Instant.parse(registered.get("createdAt").asString())).isNotNull();
        var list = response(request("GET", "/tenants", null), 200);
        assertThat(list.propertyNames()).containsExactlyInAnyOrder("store", "tenants");
        assertThat(list.get("store").asString()).isEqualTo("OK");
        var tenants = list.get("tenants");
        assertThat(tenants.get(0).get("id").asString()).isEqualTo("DEV");
        assertThat(tenants.get(1).get("id").asString()).isEqualTo("PRD");
        assertThat(tenants.get(0).get("createdAt").isNull()).isTrue();
        assertThat(tenants.get(0).get("source").asString()).isEqualTo("env");
        for (JsonNode tenant : tenants) assertThat(tenant.propertyNames())
                .containsExactlyInAnyOrder("id", "name", "source", "apiHost", "createdAt");
        assertThat(server.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-301 AC-1·AC-2·AC-9: JSON name key validation and byte boundaries")
    void req301_ac2_validation() throws Exception {
        for (String invalid : List.of("", "not JSON test-dummy-api-secret", "[]", "null", "1", "{} {}")) {
            error(request("POST", "/tenants", invalid), 400, "INVALID_REQUEST", "Invalid request");
        }
        for (String name : List.of("", " ", "a".repeat(41))) {
            error(request("POST", "/tenants", JSON.writeValueAsString(body(name, server.baseUrl()))),
                    400, "INVALID_REQUEST", "Invalid request");
        }
        var missing = JSON.createObjectNode().put("name", "Missing key");
        error(request("POST", "/tenants", JSON.writeValueAsString(missing)), 400, "INVALID_SERVICE_KEY",
                "oauth.url, oauth.tokenurl, oauth.clientid, oauth.clientsecret");
        var bad = body("Bad key", server.baseUrl());
        ((tools.jackson.databind.node.ObjectNode) bad.get("serviceKey").get("oauth")).put("clientsecret", 1);
        error(request("POST", "/tenants", JSON.writeValueAsString(bad)), 400, "INVALID_SERVICE_KEY", "oauth.clientsecret");
        register("Duplicate api");
        error(request("POST", "/tenants", JSON.writeValueAsString(body("DUPLICATE API", server.baseUrl()))),
                409, "TENANT_NAME_DUPLICATE", "Tenant name already exists");
        error(request("POST", "/tenants", JSON.writeValueAsString(body("dev", server.baseUrl()))),
                409, "TENANT_NAME_DUPLICATE", "Tenant name already exists");
        var padded = (tools.jackson.databind.node.ObjectNode) body("Byte boundary", server.baseUrl());
        padded.put("padding", "");
        int length = JSON.writeValueAsBytes(padded).length;
        padded.put("padding", "x".repeat(65_536 - length));
        String accepted = JSON.writeValueAsString(padded);
        assertThat(accepted.getBytes(StandardCharsets.UTF_8)).hasSize(65_536);
        response(request("POST", "/tenants", accepted), 201);
        error(request("POST", "/tenants", accepted + " "), 400, "INVALID_REQUEST", "Invalid request");
    }

    @Test
    @DisplayName("REQ-301 AC-4·AC-9: partial updates duplicate exclusion readonly precedence and local deletion")
    void req301_ac4_changes() throws Exception {
        String id = register("Modify api");
        String path = "/tenants/" + id;
        response(request("PUT", path, "{\"name\":\"Modify api\"}"), 200);
        response(request("PUT", path, "{\"name\":\"MODIFY API\"}"), 200);
        register("Other api");
        error(request("PUT", path, "{\"name\":\"other API\"}"), 409, "TENANT_NAME_DUPLICATE", "Tenant name already exists");
        var patch = JSON.createObjectNode(); patch.set("serviceKey", body("unused", server.baseUrl()).get("serviceKey"));
        ((tools.jackson.databind.node.ObjectNode) patch.get("serviceKey").get("oauth"))
                .put("clientid", "test-dummy-new-client").put("clientsecret", "test-dummy-new-secret");
        var changed = response(request("PUT", path, JSON.writeValueAsString(patch)), 200);
        assertThat(changed.get("name").asString()).isEqualTo("MODIFY API");
        assertThat(registry.find(id).orElseThrow().clientId()).isEqualTo("test-dummy-new-client");
        assertThat(registry.find(id).orElseThrow().clientSecret()).isEqualTo("test-dummy-new-secret");
        error(request("PUT", path, "{}"), 400, "INVALID_REQUEST", "Invalid request");
        error(request("PUT", path, "[]"), 400, "INVALID_REQUEST", "Invalid request");
        error(request("PUT", "/tenants/missing", "not JSON"), 404, "TENANT_NOT_FOUND", "Tenant not found");
        error(request("DELETE", "/tenants/missing", null), 404, "TENANT_NOT_FOUND", "Tenant not found");
        for (String env : List.of("DEV", "PRD")) {
            error(request("PUT", "/tenants/" + env, "not JSON"), 409, "TENANT_READ_ONLY", "Tenant is read only");
            error(request("DELETE", "/tenants/" + env, null), 409, "TENANT_READ_ONLY", "Tenant is read only");
        }
        var deleted = request("DELETE", path, null);
        assertThat(deleted.statusCode()).isEqualTo(204); assertThat(deleted.body()).isEmpty();
        assertThat(registry.find(id)).isEmpty();
        assertThat(server.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-301 AC-5·AC-9: same key registry recreation retains API registrations")
    void req301_ac5_restart() throws Exception {
        String id = register("Restart api");
        var store = new EncryptedTenantStore(directory.resolve("tenants.enc"), () -> Optional.of(KEY), JSON);
        var restarted = new TenantRegistry(properties, store, clock, event -> {});
        assertThat(restarted.list()).isEqualTo(registry.list());
        assertThat(restarted.find(id)).isPresent();
        assertThat(new String(Files.readAllBytes(directory.resolve("tenants.enc")), StandardCharsets.ISO_8859_1))
                .doesNotContain("test-dummy-api-client", "test-dummy-api-secret", KEY);
    }

    @Test
    @DisplayName("REQ-301 AC-6·AC-7·AC-9: bad store configurations boot and return 409 before absent id without rewriting")
    void req301_ac6_storeContexts() throws Exception {
        Path file = directory.resolve("restart.enc");
        var seed = new EncryptedTenantStore(file, () -> Optional.of(KEY), JSON);
        seed.write(List.of(new StoredTenant("seed", "Seed", server.baseUrl(), server.baseUrl() + "/oauth/token",
                "test-dummy-api-client", "test-dummy-api-secret", java.time.Instant.now())));
        byte[] original = Files.readAllBytes(file);
        for (String value : Arrays.asList(null, "bad", Base64.getEncoder().encodeToString(new byte[16]), randomKey(), KEY)) {
            RestartKeys.value = value;
            boolean unreadable = value != null && (value.equals(KEY) || value.length() > 30);
            if (KEY.equals(value)) Files.write(file, new byte[]{1, 2, 3});
            byte[] before = Files.readAllBytes(file);
            String state = unreadable ? "UNREADABLE" : "NOT_CONFIGURED";
            String code = "TENANT_STORE_" + state;
            String message = unreadable ? "Tenant store unreadable" : "Tenant store not configured";
            List<String> args = new ArrayList<>(List.of("--server.port=0", "--spring.main.banner-mode=off",
                    "--cpi.tenants.store-file=" + file.toString().replace('\\', '/'),
                    "--cpi.transport.history.file=" + directory.resolve("restart-history.jsonl").toString().replace('\\', '/')));
            for (String env : List.of("dev", "prd")) {
                String prefix = "--cpi.environments." + env + ".";
                args.add(prefix + "api-url=" + (env.equals("dev") ? server.baseUrl() : ""));
                args.add(prefix + "token-url=" + (env.equals("dev") ? server.baseUrl() + "/oauth/token" : ""));
                args.add(prefix + "client-id=" + (env.equals("dev") ? "test-dummy-env-client" : ""));
                args.add(prefix + "client-secret=" + (env.equals("dev") ? "test-dummy-env-secret" : ""));
            }
            try (var context = new SpringApplicationBuilder(CpiTransportToolApplication.class, RestartKeys.class)
                    .run(args.toArray(String[]::new))) {
                int localPort = ((org.springframework.boot.web.server.context.WebServerApplicationContext) context)
                        .getWebServer().getPort();
                var list = response(request(localPort, "GET", "/tenants", null), 200);
                assertThat(list.get("store").asString()).isEqualTo(state);
                assertThat(list.get("tenants").size()).isEqualTo(1);
                assertThat(list.get("tenants").get(0).get("id").asString()).isEqualTo("DEV");
                error(request(localPort, "POST", "/tenants", "{}"), 409, code, message);
                error(request(localPort, "POST", "/tenants", "[]"), 400, "INVALID_REQUEST", "Invalid request");
                for (String id : List.of("seed", "missing", "PRD")) {
                    error(request(localPort, "PUT", "/tenants/" + id, "not JSON"), 409, code, message);
                    error(request(localPort, "DELETE", "/tenants/" + id, null), 409, code, message);
                }
                error(request(localPort, "PUT", "/tenants/DEV", "not JSON"), 409, "TENANT_READ_ONLY", "Tenant is read only");
                error(request(localPort, "DELETE", "/tenants/DEV", null), 409, "TENANT_READ_ONLY", "Tenant is read only");
            }
            assertThat(Files.readAllBytes(file)).isEqualTo(before);
            if (!KEY.equals(value)) assertThat(before).isEqualTo(original);
        }
    }
}
