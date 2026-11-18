package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.service.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.stream.IntStream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** REQ-601, REQ-602, REQ-603 through the HTTP API. */
class MultiPackageControllerTests {
    private static final String PACKAGES = "/api/v1/IntegrationPackages";
    private static final String COLLECTION = "/api/v1/IntegrationDesigntimeArtifacts";
    private final JsonMapper json = JsonMapper.builder().build();
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-18T00:00:00Z"), ZoneOffset.UTC);
    private WireMockServer dev, prd;
    private MockMvc mvc;
    private TransportHistoryStore history;
    @TempDir Path temporary;

    @BeforeEach
    void setUp() {
        dev = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        prd = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        dev.start();
        prd.start();
        configure(false);
        dev.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo("/token"))
                .willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo("/token"))
                .willReturn(okJson("{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(get(urlEqualTo("/api/v1/")).willReturn(ok().withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
        for (String id : List.of("P1", "P2")) {
            String name = id.equals("P1") ? "Package One" : "Package Two";
            dev.stubFor(get(urlEqualTo(pkg(id))).willReturn(okJson("{\"d\":{\"Id\":\"" + id + "\",\"Name\":\"" + name
                    + "\",\"ShortText\":\"short\",\"Description\":\"long\",\"Version\":\"1.0.0\"}}")));
            String artifact = id.equals("P1") ? "A" : "C";
            dev.stubFor(get(urlEqualTo(pkg(id) + "/IntegrationDesigntimeArtifacts")).willReturn(okJson(
                    "{\"d\":{\"results\":[{\"Id\":\"" + artifact + "\",\"Name\":\"Name " + artifact + "\",\"Version\":\"1.0\"}]}}")));
            dev.stubFor(get(urlEqualTo(path(artifact) + "/$value")).willReturn(ok().withBody("bundle-" + artifact)));
            dev.stubFor(get(urlEqualTo(path(artifact) + "/Configurations")).willReturn(okJson("{\"d\":{\"results\":[]}}")));
            prd.stubFor(get(urlEqualTo(path(artifact))).willReturn(notFound()));
        }
        dev.stubFor(get(urlEqualTo(pkg("Missing"))).willReturn(notFound()));
        prd.stubFor(get(urlEqualTo(pkg("P1"))).willReturn(okJson("{\"d\":{\"Id\":\"P1\",\"Name\":\"Package One\",\"Version\":\"1.0.0\"}}")));
        prd.stubFor(get(urlEqualTo(pkg("P2"))).willReturn(notFound()));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(PACKAGES)).willReturn(created()));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(COLLECTION)).willReturn(created()));
    }

    @AfterEach void tearDown() { if (dev != null) dev.stop(); if (prd != null) prd.stop(); }

    private void configure(boolean prdMissing) {
        String devBase = "http://localhost:" + dev.port();
        String prdBase = "http://localhost:" + prd.port();
        var props = new CpiProperties(
                new CpiProperties.Connection(devBase, devBase + "/token", "dummy-dev-client", "dummy-dev-secret"),
                prdMissing ? new CpiProperties.Connection("", "", "", "")
                        : new CpiProperties.Connection(prdBase, prdBase + "/token", "dummy-prd-client", "dummy-prd-secret"));
        var settings = new TransportProperties(new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of());
        Sleeper sleeper = duration -> {};
        var tokens = new OAuthTokenProvider(props, settings, clock, sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(props, tokens, new CsrfTokenStore(), settings, sleeper), json);
        var service = new TransportService(api, new ConfigurationCopier(api, new SensitiveKeyMatcher(settings)),
                new DeployService(api, settings, clock, sleeper), clock);
        var guard = new EnvironmentGuard(props);
        history = new TransportHistoryStore(settings, json);
        mvc = MockMvcBuilders.standaloneSetup(
                        new TransportController(service, guard, history, new ReadOnlyProperties(false)),
                        new PackageController(new PackageQueryService(guard, api)))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    private ResultActions transport(String body) throws Exception {
        return mvc.perform(post("/transport").contentType("application/json").content(body));
    }
    private JsonNode accepted(String body) throws Exception {
        return json.readTree(transport(body).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
    private ResultActions targetStatus(String query) throws Exception {
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/packages/target-status?" + query));
    }

    @ParameterizedTest(name = "{displayName} [{index}]")
    @ValueSource(strings = {
            "{\"packages\":[{\"packageId\":\"P1\"}],\"packageId\":\"P1\"}",
            "{\"packages\":[]}",
            "{\"packages\":{}}",
            "{\"packages\":\"P1\"}",
            "{\"packages\":null}",
            "{\"packages\":[null]}",
            "{\"packages\":[\"P1\"]}",
            "{\"packages\":[{}]}",
            "{\"packages\":[{\"artifactIds\":[]}]}",
            "{\"packages\":[{\"packageId\":\"P1\"},{\"packageId\":\"P1\"}]}",
            "{\"packages\":[{\"packageId\":\"a b\"}]}",
            "{\"packages\":[{\"packageId\":\"P1\",\"artifactIds\":[\"a'b\"]}]}",
            "{\"packages\":[{\"packageId\":\"P1\",\"artifactIds\":{}}]}",
            "many",
            "{\"packages\":[{\"packageId\":\"P1\"}],\"createPackages\":[\"P2\"]}",
            "{\"packages\":[{\"packageId\":\"P1\"}],\"createPackages\":\"P1\"}",
            "{\"packages\":[{\"packageId\":\"P1\"}],\"createPackages\":[\"a b\"]}",
            "{\"packageId\":\"P1\",\"createPackages\":[\"P2\"]}"})
    @DisplayName("REQ-601, REQ-604: invalid packages or createPackages return 400 INVALID_REQUEST with zero CPI calls and no history")
    void req601_invalid(String body) throws Exception {
        if (body.equals("many")) body = json.writeValueAsString(Map.of("packages", List.of(
                Map.of("packageId", "P1"), Map.of("packageId", "P2", "artifactIds", IntStream.range(0, 101).mapToObj(i -> "A" + i).toList()))));
        transport(body).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
        assertThat(dev.getAllServeEvents()).isEmpty();
        assertThat(prd.getAllServeEvents()).isEmpty();
        assertThat(Files.exists(temporary.resolve("history.jsonl"))).isFalse();
    }

    @Test
    @DisplayName("REQ-601: 100 artifact IDs in one package of several pass validation")
    void req601_boundary() throws Exception {
        var root = accepted(json.writeValueAsString(Map.of("dryRun", true, "packages", List.of(
                Map.of("packageId", "P1", "artifactIds", IntStream.range(0, 100).mapToObj(i -> "A" + i).toList()),
                Map.of("packageId", "P2")))));
        assertThat(root.at("/summary/total").asInt()).isEqualTo(101);
    }

    @Test
    @DisplayName("REQ-601, REQ-602: the legacy packageId body is handled as one package and the response has packages instead of packageId")
    void req601_legacyBody() throws Exception {
        var root = accepted("{\"packageId\":\"P1\",\"artifactIds\":[\"A\"],\"dryRun\":true}");
        assertThat(root.has("packageId")).isFalse();
        assertThat(root.path("packages")).isEqualTo(json.readTree(
                "[{\"packageId\":\"P1\",\"packageName\":\"Package One\",\"targetPackage\":\"NOT_CHECKED\"}]"));
        assertThat(root.at("/results/0/packageId").asString()).isEqualTo("P1");
        assertThat(root.at("/results/0/artifactId").asString()).isEqualTo("A");
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-601: preview of several packages sends no target request")
    void req601_previewNoTarget() throws Exception {
        var root = accepted("{\"dryRun\":true,\"packages\":[{\"packageId\":\"P2\"},{\"packageId\":\"P1\"}],\"createPackages\":[\"P2\"]}");
        assertThat(root.at("/results/0/packageId").asString()).isEqualTo("P2");
        assertThat(root.at("/results/1/packageId").asString()).isEqualTo("P1");
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-601: a package missing from the source returns 404 PACKAGE_NOT_FOUND before any package is processed")
    void req601_missingSource() throws Exception {
        transport("{\"packages\":[{\"packageId\":\"P1\"},{\"packageId\":\"Missing\"}],\"createPackages\":[\"Missing\"]}")
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("PACKAGE_NOT_FOUND"));
        assertThat(prd.getAllServeEvents()).isEmpty();
        dev.verify(0, getRequestedFor(urlMatching(".*/\\$value")));
        assertThat(Files.exists(temporary.resolve("history.jsonl"))).isFalse();
    }

    @Test
    @DisplayName("REQ-601: a source lookup failure stays 502 CPI_UNAVAILABLE")
    void req601_sourceUnavailable() throws Exception {
        dev.stubFor(get(urlEqualTo(pkg("P2"))).willReturn(serverError()));
        transport("{\"dryRun\":true,\"packages\":[{\"packageId\":\"P1\"},{\"packageId\":\"P2\"}]}")
                .andExpect(status().isBadGateway()).andExpect(jsonPath("$.error").value("CPI_UNAVAILABLE"));
        dev.verify(0, getRequestedFor(urlMatching(".*/\\$value")));
    }

    @Test
    @DisplayName("REQ-601, REQ-602: one transport of two packages appends one history line in the response format")
    void req602_history() throws Exception {
        var root = accepted("{\"packages\":[{\"packageId\":\"P1\"},{\"packageId\":\"P2\"}],\"createPackages\":[\"P2\"]}");
        assertThat(root.has("packageId")).isFalse();
        assertThat(root.path("packages")).isEqualTo(json.readTree(
                "[{\"packageId\":\"P1\",\"packageName\":\"Package One\",\"targetPackage\":\"EXISTING\"},"
                        + "{\"packageId\":\"P2\",\"packageName\":\"Package Two\",\"targetPackage\":\"CREATED\"}]"));
        assertThat(root.at("/results/0/packageId").asString()).isEqualTo("P1");
        assertThat(root.at("/results/1/packageId").asString()).isEqualTo("P2");
        assertThat(root.at("/summary/total").asInt()).isEqualTo(2);
        var lines = Files.readAllLines(temporary.resolve("history.jsonl"));
        assertThat(lines).hasSize(1);
        assertThat(json.readTree(lines.getFirst())).isEqualTo(root);
        String listed = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/transport/history"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(listed).get(0)).isEqualTo(root);
    }

    @Test
    @DisplayName("REQ-602: a legacy history line is returned with one package entry and packageId on every result, file unchanged")
    void req602_legacyHistory() throws Exception {
        String legacy = "{\"transportId\":\"legacy-1\",\"packageId\":\"Pkg\",\"dryRun\":false,\"deploy\":false,"
                + "\"startedAt\":\"2026-09-28T00:00:00Z\",\"finishedAt\":\"2026-09-28T00:00:01Z\","
                + "\"summary\":{\"total\":2,\"succeeded\":2,\"failed\":0},\"results\":["
                + "{\"artifactId\":\"A\",\"status\":\"SUCCESS\",\"action\":\"CREATED\",\"configurations\":[],\"deployStatus\":\"NOT_REQUESTED\",\"error\":null},"
                + "{\"artifactId\":\"B\",\"status\":\"SUCCESS\",\"action\":\"UPDATED\",\"configurations\":[],\"deployStatus\":\"NOT_REQUESTED\",\"error\":null}]}\n";
        Files.writeString(temporary.resolve("history.jsonl"), legacy);
        String body = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/transport/history"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var entry = json.readTree(body).get(0);
        assertThat(entry.has("packageId")).isFalse();
        assertThat(entry.path("packages")).isEqualTo(json.readTree(
                "[{\"packageId\":\"Pkg\",\"packageName\":null,\"targetPackage\":null}]"));
        assertThat(entry.at("/results/0/packageId").asString()).isEqualTo("Pkg");
        assertThat(entry.at("/results/1/packageId").asString()).isEqualTo("Pkg");
        assertThat(Files.readString(temporary.resolve("history.jsonl"))).isEqualTo(legacy);
    }

    @Test
    @DisplayName("REQ-603: target-status reads each package with GET only and answers in request order")
    void req603_targetStatus() throws Exception {
        String body = targetStatus("tenantId=PRD&packageIds=P2,P1").andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(body)).isEqualTo(json.readTree(
                "[{\"packageId\":\"P2\",\"exists\":false},{\"packageId\":\"P1\",\"exists\":true}]"));
        assertThat(prd.getAllServeEvents()).filteredOn(e -> e.getRequest().getUrl().startsWith("/api/"))
                .allSatisfy(e -> assertThat(e.getRequest().getMethod().getName()).isEqualTo("GET"));
        prd.verify(1, getRequestedFor(urlEqualTo(pkg("P1"))));
        prd.verify(1, getRequestedFor(urlEqualTo(pkg("P2"))));
        assertThat(dev.getAllServeEvents()).isEmpty();
    }

    @ParameterizedTest(name = "{displayName} [{index}]")
    @ValueSource(strings = {"tenantId=PRD", "tenantId=PRD&packageIds=", "tenantId=PRD&packageIds=a%20b",
            "tenantId=PRD&packageIds=P1,P1", "tenantId=PRD&packageIds=P1,,P2", "tenantId=PRD&packageIds=a'b"})
    @DisplayName("REQ-603: missing, empty, invalid or duplicate packageIds return 400 INVALID_REQUEST without CPI calls")
    void req603_invalid(String query) throws Exception {
        targetStatus(query).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-603: an unregistered tenant returns 400 TENANT_NOT_FOUND like the other APIs")
    void req603_unknownTenant() throws Exception {
        targetStatus("tenantId=unknown&packageIds=P1").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("TENANT_NOT_FOUND"));
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-603: a target without connection settings returns 503 ENVIRONMENT_NOT_CONFIGURED")
    void req603_notConfigured() throws Exception {
        configure(true);
        targetStatus("tenantId=PRD&packageIds=P1").andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("ENVIRONMENT_NOT_CONFIGURED"));
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-603: a non-404 target failure returns 502 CPI_UNAVAILABLE without the CPI body")
    void req603_cpiFailure() throws Exception {
        prd.stubFor(get(urlEqualTo(pkg("P1"))).willReturn(serverError().withBody("dummy-prd-secret Password=hidden-value")));
        String body = targetStatus("tenantId=PRD&packageIds=P1").andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").value("CPI_UNAVAILABLE")).andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("dummy-prd-secret", "hidden-value");
    }

    private static String pkg(String id) { return PACKAGES + "('" + id + "')"; }
    private static String path(String id) { return COLLECTION + "(Id='" + id + "',Version='active')"; }
}
