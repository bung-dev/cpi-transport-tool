package com.company.sap.cpitransport.controller;

import java.nio.file.*;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;
import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.*;
import com.company.sap.cpitransport.tenant.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.assertThat;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class TransportTenantSelectionTests {
    @TempDir Path directory;
    private final JsonMapper json = new JsonMapper();
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-07T00:00:00Z"), ZoneOffset.UTC);
    private WireMockServer source, target;
    private TenantRegistry tenants;
    private MockMvc mvc;
    private TransportHistoryStore history;
    private String targetId;
    private TransportProperties settings;
    private CpiProperties properties;

    @BeforeEach void setUp() {
        source = new WireMockServer(wireMockConfig().dynamicPort());
        target = new WireMockServer(wireMockConfig().dynamicPort());
        source.start(); target.start();
        source.stubFor(post(urlEqualTo("/oauth/token")).willReturn(okJson("{\"access_token\":\"test-dummy-token\",\"expires_in\":3600}")));
        source.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages('Pkg')")).willReturn(okJson("{\"d\":{\"Id\":\"Pkg\",\"Name\":\"Source package\",\"Version\":\"1\"}}")));
        source.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages('Pkg')/IntegrationDesigntimeArtifacts")).willReturn(okJson("{\"d\":{\"results\":[]}}")));
        source.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages")).willReturn(okJson("{\"d\":{\"results\":[{\"Id\":\"Pkg\",\"Name\":\"Source package\",\"Version\":\"1\"}]}}")));
        settings = new TransportProperties("", new TransportProperties.History(directory.resolve("history.jsonl")),
                new TransportProperties.Retry(1, Duration.ZERO), new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of());
        configure(true, true, false);
    }
    @AfterEach void stop() { if (source != null) source.stop(); if (target != null) target.stop(); }

    private CpiProperties.Connection connection(WireMockServer server) {
        return new CpiProperties.Connection(server.baseUrl(), server.baseUrl() + "/oauth/token", "test-dummy-client", "test-dummy-secret");
    }
    private void configure(boolean dev, boolean prd, boolean readOnly) {
        var empty = new CpiProperties.Connection("", "", "", "");
        properties = new CpiProperties(dev ? connection(source) : empty, prd ? connection(target) : empty);
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        String key = Base64.getEncoder().encodeToString(bytes);
        tenants = new TenantRegistry(properties, new EncryptedTenantStore(directory.resolve(UUID.randomUUID() + ".enc"), () -> Optional.of(key), json), clock, event -> {});
        targetId = tenants.register(registration("Registered target", target)).id();
        var tokens = new OAuthTokenProvider(tenants, settings, clock, duration -> {});
        var api = new CpiApiClient(new CpiHttpExecutor(tenants, tokens, new CsrfTokenStore(), settings, duration -> {}), json);
        var sensitive = new SensitiveKeyMatcher(settings);
        var transport = new TransportService(api, new IflwReplacer(sensitive), new ExternalParameterReplacer(api, sensitive),
                new DeployService(api, settings, clock, duration -> {}), new MappingFileLoader(settings), clock);
        history = new TransportHistoryStore(settings, json);
        var guard = new EnvironmentGuard(properties, tenants);
        mvc = MockMvcBuilders.standaloneSetup(new TransportController(transport, guard, history, new ReadOnlyProperties(readOnly)),
                new PackageController(new PackageQueryService(guard, api))).setControllerAdvice(new ApiExceptionHandler()).build();
    }
    private tools.jackson.databind.JsonNode registration(String name, WireMockServer server) {
        var body = json.createObjectNode(); body.put("name", name);
        var oauth = body.putObject("serviceKey").putObject("oauth");
        oauth.put("url", server.baseUrl()); oauth.put("tokenurl", server.baseUrl() + "/oauth/token");
        oauth.put("clientid", "test-dummy-client"); oauth.put("clientsecret", "test-dummy-secret");
        return body;
    }
    private org.springframework.test.web.servlet.ResultActions transport(Map<String, Object> extra) throws Exception {
        var body = new LinkedHashMap<String, Object>(); body.put("packageId", "Pkg"); body.putAll(extra);
        return mvc.perform(MockMvcRequestBuilders.post("/transport").contentType("application/json").content(json.writeValueAsString(body)));
    }
    private void error(Map<String, Object> body, int status, String code) throws Exception {
        transport(body).andExpect(status().is(status)).andExpect(jsonPath("$.error").value(code));
        assertThat(source.getAllServeEvents()).isEmpty(); assertThat(target.getAllServeEvents()).isEmpty();
    }

    @Test @DisplayName("REQ-308 AC-1·AC-7: defaults and registered dry-run target receive no target requests")
    void req308_ac1_defaultsAndDryRun() throws Exception {
        transport(Map.of()).andExpect(status().isOk()).andExpect(jsonPath("$.sourceTenant.id").value("DEV"))
                .andExpect(jsonPath("$.targetTenant.id").value("PRD"));
        transport(Map.of("dryRun", true, "targetTenantId", targetId)).andExpect(status().isOk())
                .andExpect(jsonPath("$.targetTenant.name").value("Registered target"));
        assertThat(target.getAllServeEvents()).isEmpty();
        configure(true, false, false);
        transport(Map.of("dryRun", true)).andExpect(status().isOk()).andExpect(jsonPath("$.targetTenant.name").value("PRD"));
        assertThat(target.getAllServeEvents()).isEmpty();
    }

    @Test @DisplayName("REQ-302 AC-2 / REQ-308 AC-1·AC-7: validation precedes read-only then unknown tenants then missing keys")
    void req302_ac2_order() throws Exception {
        configure(false, false, true);
        error(Map.of("sourceTenantId", "unknown", "artifactIds", List.of("bad id")), 400, "INVALID_REQUEST");
        error(Map.of("sourceTenantId", "unknown"), 409, "READ_ONLY_MODE");
        error(Map.of("sourceTenantId", "unknown", "dryRun", true), 400, "TENANT_NOT_FOUND");
        configure(false, false, false);
        error(Map.of("targetTenantId", "unknown"), 400, "TENANT_NOT_FOUND");
        error(Map.of("sourceTenantId", "unknown", "dryRun", true), 400, "TENANT_NOT_FOUND");
        error(Map.of("sourceTenantId", "DEV", "targetTenantId", "DEV"), 400, "INVALID_REQUEST");
        for (Object value : List.of("", 1, true)) {
            error(Map.of("sourceTenantId", value), 400, "INVALID_REQUEST");
            error(Map.of("targetTenantId", value), 400, "INVALID_REQUEST");
        }
        var nullId = new HashMap<String, Object>(); nullId.put("sourceTenantId", null);
        error(nullId, 400, "INVALID_REQUEST");
        transport(Map.of()).andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.message").value(
                "cpi.environments.dev.api-url, cpi.environments.dev.token-url, cpi.environments.dev.client-id, cpi.environments.dev.client-secret, cpi.environments.prd.api-url, cpi.environments.prd.token-url, cpi.environments.prd.client-id, cpi.environments.prd.client-secret"));
        assertThat(source.getAllServeEvents()).isEmpty(); assertThat(target.getAllServeEvents()).isEmpty();
    }

    @Test @DisplayName("REQ-308 AC-2·AC-7: package and artifact queries use selected tenant with reserved missing and unknown checks")
    void req308_ac2_queries() throws Exception {
        String id = tenants.register(registration("Registered source", source)).id();
        mvc.perform(MockMvcRequestBuilders.get("/packages").param("tenantId", id)).andExpect(status().isOk()).andExpect(jsonPath("$[0].name").value("Source package"));
        mvc.perform(MockMvcRequestBuilders.get("/packages/Pkg/artifacts").param("tenantId", id)).andExpect(status().isOk()).andExpect(content().json("[]"));
        assertThat(target.getAllServeEvents()).isEmpty();
        source.resetRequests();
        mvc.perform(MockMvcRequestBuilders.get("/packages").param("tenantId", "unknown")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("TENANT_NOT_FOUND"));
        mvc.perform(MockMvcRequestBuilders.get("/packages/Pkg/artifacts").param("tenantId", "unknown")).andExpect(status().isBadRequest());
        configure(false, true, false);
        mvc.perform(MockMvcRequestBuilders.get("/packages")).andExpect(status().isServiceUnavailable());
        mvc.perform(MockMvcRequestBuilders.get("/packages/Pkg/artifacts")).andExpect(status().isServiceUnavailable());
        assertThat(source.getAllServeEvents()).isEmpty();
    }

    @Test @DisplayName("REQ-308 AC-4·AC-7: history preserves transport names after rename and removal and reads legacy field set")
    void req308_ac4_history() throws Exception {
        transport(Map.of("dryRun", true, "targetTenantId", targetId)).andExpect(status().isOk());
        var rename = json.createObjectNode(); rename.put("name", "Renamed target"); tenants.update(targetId, rename); tenants.delete(targetId);
        assertThat(history.findAll()).singleElement().satisfies(r -> {
            assertThat(r.sourceTenant()).isEqualTo(new TenantRef("DEV", "DEV"));
            assertThat(r.targetTenant()).isEqualTo(new TenantRef(targetId, "Registered target"));
        });
        var legacy = new TransportResponse("legacy", "Pkg", true, false, clock.instant(), clock.instant(), new TransportSummary(0, 0, 0), List.of());
        var tree = json.readTree(json.writeValueAsString(legacy));
        assertThat(tree.has("sourceTenant")).isFalse(); assertThat(tree.has("targetTenant")).isFalse();
        assertThat(tree.size()).isEqualTo(8);
        history.append(legacy);
        assertThat(history.findAll()).filteredOn(r -> r.transportId().equals("legacy")).singleElement().satisfies(r -> {
            assertThat(r.sourceTenant()).isNull(); assertThat(r.targetTenant()).isNull();
        });
    }
}
