package com.company.sap.cpitransport.tenant;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.*;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;

class TenantRegistryTests {
    @TempDir Path directory;
    private final ObjectMapper json = new ObjectMapper();
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-07T00:00:00Z"), ZoneOffset.UTC);
    private final List<Object> events = new ArrayList<>();
    private final CpiProperties.Connection full = new CpiProperties.Connection("http://localhost:1/api",
            "http://localhost:1/oauth/token", "test-dummy-env-client", "test-dummy-env-secret");
    private final CpiProperties.Connection empty = new CpiProperties.Connection("", "", "", "");

    private String key() {
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }
    private EncryptedTenantStore store(String key) {
        return new EncryptedTenantStore(directory.resolve("tenants.enc"), () -> Optional.ofNullable(key), json);
    }
    private TenantRegistry registry(CpiProperties properties, String key) {
        return new TenantRegistry(properties, store(key), clock, events::add);
    }
    private JsonNode body(String name) {
        var node = json.createObjectNode(); node.put("name", name);
        var oauth = node.putObject("serviceKey").putObject("oauth");
        oauth.put("url", "http://localhost:2/api/v1");
        oauth.put("tokenurl", "http://localhost:2/oauth/token");
        oauth.put("clientid", "test-dummy-client"); oauth.put("clientsecret", "test-dummy-secret");
        return node;
    }
    private void error(Runnable action, Code code) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class,
                failure -> assertThat(failure.code()).isEqualTo(code)).hasNoCause();
    }

    @Test
    @DisplayName("REQ-301 AC-7·AC-9: complete initial tenants only and no initial credentials persisted")
    void req301_ac7_initial() {
        for (String key : Arrays.asList(null, "invalid", key())) {
            var registry = registry(new CpiProperties(full, full), key);
            assertThat(registry.list()).extracting(v -> v.id()).containsExactly("DEV", "PRD");
            assertThat(registry.list()).allSatisfy(v -> {
                assertThat(v.source()).isEqualTo("env"); assertThat(v.createdAt()).isNull();
                assertThat(v.apiHost()).isEqualTo("localhost");
            });
            assertThat(directory.resolve("tenants.enc")).doesNotExist();
        }
        assertThat(TenantRegistry.initial(new CpiProperties(empty, empty)).list()).isEmpty();
        String[] values = {full.apiUrl(), full.tokenUrl(), full.clientId(), full.clientSecret()};
        for (int i = 0; i < 4; i++) {
            String[] incomplete = values.clone(); incomplete[i] = i % 2 == 0 ? " " : null;
            var connection = new CpiProperties.Connection(incomplete[0], incomplete[1], incomplete[2], incomplete[3]);
            var registry = TenantRegistry.initial(new CpiProperties(connection, full));
            assertThat(registry.list()).extracting(v -> v.id()).containsExactly("PRD");
            assertThat(registry.missingKeys(CpiProperties.Environment.DEV)).containsExactly(
                    "cpi.environments.dev." + List.of("api-url", "token-url", "client-id", "client-secret").get(i));
        }
    }

    @Test
    @DisplayName("REQ-301 AC-1·AC-3·AC-5·AC-9: UUID names code points duplicate names order and restart")
    void req301_ac1_register() {
        String key = key();
        var registry = registry(new CpiProperties(full, full), key);
        var first = registry.register(body("  First  "));
        assertThat(first.id()).matches("[A-Za-z0-9-]{1,64}").isNotIn("DEV", "PRD");
        assertThat(first.name()).isEqualTo("First");
        assertThat(first.createdAt()).isEqualTo(clock.instant());
        assertThat(first.source()).isEqualTo("registered");
        var second = registry.register(body("😀".repeat(40)));
        assertThat(second.id()).isNotEqualTo(first.id());
        error(() -> registry.register(body("x".repeat(41))), Code.INVALID_REQUEST);
        error(() -> registry.register(body("😀".repeat(41))), Code.INVALID_REQUEST);
        error(() -> registry.register(body("  ")), Code.INVALID_REQUEST);
        error(() -> registry.register(body("FIRST")), Code.TENANT_NAME_DUPLICATE);
        error(() -> registry.register(body("dev")), Code.TENANT_NAME_DUPLICATE);
        assertThat(registry.list()).extracting(v -> v.id()).containsExactly("DEV", "PRD", first.id(), second.id());
        var restarted = registry(new CpiProperties(full, full), key);
        assertThat(restarted.list()).isEqualTo(registry.list());
        assertThat(store(key).read().tenants()).extracting(StoredTenant::id).containsExactly(first.id(), second.id());
        assertThat(registry.find(first.id()).orElseThrow().toString()).doesNotContain("test-dummy");
        assertThat(registry(new CpiProperties(empty, empty), key).register(body("DEV")).name()).isEqualTo("DEV");
    }

    @Test
    @DisplayName("REQ-301 AC-4·AC-9: updates preserve identity emit events after persistence and protect env")
    void req301_ac4_changes() {
        String key = key();
        var registry = registry(new CpiProperties(full, full), key);
        var first = registry.register(body("First"));
        registry.register(body("Other"));
        assertThat(events).isEmpty();
        var patch = json.createObjectNode().put("name", "first");
        var updated = registry.update(first.id(), patch);
        assertThat(updated.createdAt()).isEqualTo(first.createdAt());
        assertThat(events).containsExactly(new TenantChangedEvent(first.id()));
        assertThat(registry(new CpiProperties(full, full), key).find(first.id()).orElseThrow().name()).isEqualTo("first");
        error(() -> registry.update(first.id(), json.createObjectNode().put("name", "OTHER")), Code.TENANT_NAME_DUPLICATE);
        error(() -> registry.update(first.id(), json.createObjectNode()), Code.INVALID_REQUEST);
        error(() -> registry.update("DEV", () -> { throw new AssertionError("must not read body"); }), Code.TENANT_READ_ONLY);
        error(() -> registry.delete("PRD"), Code.TENANT_READ_ONLY);
        error(() -> registry.delete("absent"), Code.TENANT_NOT_FOUND);
        registry.delete(first.id());
        assertThat(events).containsExactly(new TenantChangedEvent(first.id()), new TenantChangedEvent(first.id()));
        assertThat(registry.find(first.id())).isEmpty();
        assertThat(registry(new CpiProperties(full, full), key).find(first.id())).isEmpty();
    }

    @Test
    @DisplayName("REQ-301 AC-6·AC-9: failed writes leave memory and events unchanged and enforce store before id")
    void req301_ac6_failure() throws Exception {
        String key = key();
        var registry = registry(new CpiProperties(full, empty), key);
        var first = registry.register(body("First"));
        byte[] corrupt = {1, 2, 3}; Files.write(directory.resolve("tenants.enc"), corrupt);
        error(() -> registry.update(first.id(), json.createObjectNode().put("name", "Changed")), Code.TENANT_STORE_UNREADABLE);
        assertThat(registry.find(first.id()).orElseThrow().name()).isEqualTo("First");
        assertThat(events).isEmpty();
        assertThat(Files.readAllBytes(directory.resolve("tenants.enc"))).isEqualTo(corrupt);
        var broken = registry(new CpiProperties(full, empty), key);
        assertThat(broken.list()).extracting(v -> v.id()).containsExactly("DEV");
        error(() -> broken.update("missing", () -> { throw new AssertionError("must not read body"); }), Code.TENANT_STORE_UNREADABLE);
        error(() -> broken.delete("PRD"), Code.TENANT_STORE_UNREADABLE);
        var missing = registry(new CpiProperties(full, empty), null);
        error(() -> missing.register(body("Name")), Code.TENANT_STORE_NOT_CONFIGURED);
        error(() -> missing.delete("unknown"), Code.TENANT_STORE_NOT_CONFIGURED);
        error(() -> missing.delete("DEV"), Code.TENANT_READ_ONLY);
    }

    @Test
    @DisplayName("REQ-301 AC-1·AC-5·AC-9: concurrent registrations serialize without losing persisted entries")
    void req301_ac1_concurrent() throws Exception {
        String key = key();
        var registry = registry(new CpiProperties(empty, empty), key);
        try (var executor = Executors.newFixedThreadPool(4)) {
            List<Callable<String>> jobs = new ArrayList<>();
            for (int i = 0; i < 12; i++) {
                String name = "Tenant " + i;
                jobs.add(() -> registry.register(body(name)).id());
            }
            Set<String> ids = new HashSet<>();
            for (var result : executor.invokeAll(jobs)) ids.add(result.get());
            assertThat(ids).hasSize(12);
            assertThat(registry.list()).hasSize(12);
            assertThat(registry(new CpiProperties(empty, empty), key).list()).isEqualTo(registry.list());
        }
    }
}
