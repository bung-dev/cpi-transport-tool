package com.company.sap.cpitransport.controller;

import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.stream.IntStream;
import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class TransportControllerTests {
    private static final String PACKAGE = "/api/v1/IntegrationPackages('Pkg')";
    private static final String ARTIFACTS = PACKAGE + "/IntegrationDesigntimeArtifacts";
    private final JsonMapper json = JsonMapper.builder().build();
    private final Clock clock = Clock.fixed(Instant.parse("2026-09-29T00:00:00Z"), ZoneOffset.UTC);
    private WireMockServer server;
    private MockMvc mvc;
    private EnvironmentGuard guard;
    private TransportService transportService;
    private TransportHistoryStore history;
    private final List<Duration> waits = new ArrayList<>();
    @TempDir Path temporary;

    @BeforeEach void setUp() {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        server.start();
        configure(-1, -1, "");
        server.stubFor(post(urlEqualTo("/token")).willReturn(okJson(
                "{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        stub(PACKAGE, "{\"d\":{\"Id\":\"Pkg\",\"Name\":\"Package\",\"Version\":\"1\"}}");
        stub(ARTIFACTS, "{\"d\":{\"results\":[]}}");
    }
    @AfterEach void tearDown() { if (server != null) server.stop(); }

    private void configure(int devMissing, int prdMissing, String mapping) {
        String base = "http://localhost:" + server.port();
        String[] dev = {base, base + "/token", "dummy-dev-client", "dummy-dev-secret"};
        String[] prd = {base, base + "/token", "dummy-prd-client", "dummy-prd-secret"};
        if (devMissing >= 0) dev[devMissing] = "";
        if (prdMissing >= 0) prd[prdMissing] = "";
        if (prdMissing == -2) Arrays.fill(prd, "");
        var props = new CpiProperties(new CpiProperties.Connection(dev[0], dev[1], dev[2], dev[3]),
                new CpiProperties.Connection(prd[0], prd[1], prd[2], prd[3]));
        var settings = new TransportProperties(mapping, new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of());
        Sleeper sleeper = waits::add;
        var tokens = new OAuthTokenProvider(props, settings, clock, sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(props, tokens, new CsrfTokenStore(), settings, sleeper), json);
        var sensitive = new SensitiveKeyMatcher(settings);
        var service = new TransportService(api, new IflwReplacer(sensitive), new ExternalParameterReplacer(api, sensitive),
                new DeployService(api, settings, clock, sleeper), new MappingFileLoader(settings), clock);
        transportService = service;
        history = new TransportHistoryStore(settings, json);
        guard = new EnvironmentGuard(props);
        mvc = mvc(service);
    }
    private MockMvc mvc(TransportService service) {
        return MockMvcBuilders.standaloneSetup(new TransportController(service, guard, history))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }
    private void stub(String path, String body) {
        server.stubFor(get(urlEqualTo(path)).willReturn(okJson(body)));
    }
    private org.springframework.test.web.servlet.ResultActions request(String body) throws Exception {
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/transport")
                .contentType("application/json").content(body));
    }
    private void error(String body, int status, String code) throws Exception {
        int before = history.findAll().size();
        request(body).andExpect(status().is(status)).andExpect(jsonPath("$.error").value(code))
                .andExpect(jsonPath("$.message").isString());
        assertThat(history.findAll()).hasSize(before);
    }

    @ParameterizedTest(name = "{displayName} [{index}]")
    @ValueSource(strings = {"not-json", "", "[]", "null", "1", "{}", "{\"packageId\":\"\"}",
            "{\"packageId\":\"a b\"}", "{\"packageId\":\"a'b\"}", "{\"packageId\":\"<\"}",
            "{\"packageId\":3}", "long", "many", "{\"packageId\":\"Pkg\",\"artifactIds\":[null]}",
            "{\"packageId\":\"Pkg\",\"artifactIds\":[\"a b\"]}",
            "{\"packageId\":\"Pkg\",\"artifactIds\":[\"a'b\"]}",
            "{\"packageId\":\"Pkg\",\"artifactIds\":[\"<\"]}", "longArtifact",
            "{\"packageId\":\"Pkg\",\"artifactIds\":[3]}", "{\"packageId\":\"Pkg\",\"artifactIds\":{}}",
            "{\"packageId\":\"Pkg\",\"dryRun\":\"true\"}", "{\"packageId\":\"Pkg\",\"deploy\":null}"})
    @DisplayName("REQ-005 AC-2: invalid inputs precede missing environment and make zero CPI calls")
    void req005_ac2_invalid(String body) throws Exception {
        if (body.equals("long")) body = json.writeValueAsString(Map.of("packageId", "a".repeat(101)));
        if (body.equals("longArtifact")) body = json.writeValueAsString(Map.of("packageId", "Pkg", "artifactIds", List.of("a".repeat(101))));
        if (body.equals("many")) body = json.writeValueAsString(Map.of("packageId", "Pkg", "artifactIds", Collections.nCopies(101, "A")));
        for (int missing : new int[]{-1, 0}) {
            configure(missing, -1, "");
            error(body, 400, "INVALID_REQUEST");
        }
        assertThat(server.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-005 AC-2: non JSON content type returns the invalid request contract")
    void req005_ac2_contentType() throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/transport")
                .contentType("text/plain").content("not-json"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
        assertThat(server.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-005 AC-1: omitted flags default false and empty or absent selection selects all")
    void req005_ac1_defaults() throws Exception {
        stub(ARTIFACTS, "{\"d\":{\"results\":[{\"Id\":\"A\",\"Name\":\"A\",\"Version\":\"1\"}]}}");
        for (String body : List.of("{\"packageId\":\"Pkg\"}", "{\"packageId\":\"Pkg\",\"artifactIds\":[]}")) {
            request(body).andExpect(status().isOk()).andExpect(jsonPath("$.dryRun").value(false))
                    .andExpect(jsonPath("$.deploy").value(false)).andExpect(jsonPath("$.results[0].artifactId").value("A"));
        }
    }

    @Test
    @DisplayName("REQ-005 AC-2: 100 artifact IDs and 100 character package ID pass validation")
    void req005_ac2_boundary() throws Exception {
        String id = "a".repeat(100);
        stub("/api/v1/IntegrationPackages('" + id + "')", "{\"d\":{\"Id\":\"" + id + "\",\"Name\":\"Package\",\"Version\":\"1\"}}");
        stub("/api/v1/IntegrationPackages('" + id + "')/IntegrationDesigntimeArtifacts", "{\"d\":{\"results\":[]}}");
        request(json.writeValueAsString(Map.of("packageId", id, "artifactIds", IntStream.range(0,100).mapToObj(i -> "A"+i).toList())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.summary.total").value(100));
    }

    @ParameterizedTest(name = "{displayName} [{index}]")
    @ValueSource(ints = {0, 1, 2, 3, 4, 5, 6, 7})
    @DisplayName("REQ-002 AC-2: each required key precedes mapping errors and prevents CPI calls")
    void req002_ac2_missing(int index) throws Exception {
        configure(index < 4 ? index : -1, index >= 4 ? index - 4 : -1, temporary.resolve("missing.yaml").toString());
        String key = "cpi.environments." + (index < 4 ? "dev." : "prd.")
                + List.of("api-url", "token-url", "client-id", "client-secret").get(index % 4);
        request("{\"packageId\":\"Pkg\"}").andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.message").value(key));
        assertThat(server.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-002 AC-2: dry run requires only DEV while actual transport requires PRD")
    void req002_ac2_dryRun() throws Exception {
        configure(-1, -2, "");
        error("{\"packageId\":\"Pkg\"}", 503, "ENVIRONMENT_NOT_CONFIGURED");
        assertThat(server.getAllServeEvents()).isEmpty();
        request("{\"packageId\":\"Pkg\",\"dryRun\":true}").andExpect(status().isOk());
    }

    @Test
    @DisplayName("REQ-006 AC-3: mapping error precedes package 404 and mapping is reloaded per request")
    void req006_ac3_mapping() throws Exception {
        Path mapping = temporary.resolve("mapping.yaml");
        configure(-1, -1, mapping.toString());
        error("{\"packageId\":\"Pkg\"}", 422, "MAPPING_INVALID");
        assertThat(server.getAllServeEvents()).isEmpty();
        Files.writeString(mapping, "mappings: []");
        request("{\"packageId\":\"Pkg\"}").andExpect(status().isOk());
        server.resetRequests();
        Files.writeString(mapping, "mappings:\n  - artifactId: A\n");
        request("{\"packageId\":\"Pkg\"}").andExpect(status().is(422))
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("0")));
        assertThat(server.getAllServeEvents()).isEmpty();
        server.stubFor(get(urlEqualTo(PACKAGE)).willReturn(notFound()));
        error("{\"packageId\":\"Pkg\"}", 422, "MAPPING_INVALID");
        assertThat(server.getAllServeEvents()).isEmpty();
    }

    @ParameterizedTest(name = "{displayName} [{index}]")
    @ValueSource(strings = {"package404", "artifacts404", "package500", "artifacts500", "token404", "token500"})
    @DisplayName("REQ-005 AC-7, AC-3b: resource 404 versus exhausted CPI or token failure")
    void req005_ac7_failures(String failure) throws Exception {
        String path = failure.startsWith("package") ? PACKAGE : failure.startsWith("artifacts") ? ARTIFACTS : "/token";
        int code = failure.endsWith("404") ? 404 : 500;
        if (path.equals("/token")) server.stubFor(post(urlEqualTo(path)).willReturn(aResponse().withStatus(code)));
        else server.stubFor(get(urlEqualTo(path)).willReturn(aResponse().withStatus(code)));
        boolean missing = code == 404 && !path.equals("/token");
        error("{\"packageId\":\"Pkg\"}", missing ? 404 : 502, missing ? "PACKAGE_NOT_FOUND" : "CPI_UNAVAILABLE");
        if (path.equals("/token")) server.verify(code == 500 ? 3 : 1, postRequestedFor(urlEqualTo(path)));
        else server.verify(code == 500 ? 3 : 1, getRequestedFor(urlEqualTo(path)));
        assertThat(waits).hasSize(code == 500 ? 2 : 0);
    }

    @ParameterizedTest(name = "{displayName} [{index}]")
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-005 AC-1: existing service entry point retains list-only selection contract")
    void req005_ac1_existingServiceEntry(boolean empty) {
        server.stubFor(get(urlEqualTo(PACKAGE)).willReturn(notFound()));
        var result = transportService.execute(new TransportRequest("Pkg", empty ? List.of() : null, true, false));
        assertThat(result.summary().total()).isZero();
        server.verify(0, getRequestedFor(urlEqualTo(PACKAGE)));
        server.verify(1, getRequestedFor(urlEqualTo(ARTIFACTS)));
    }

    @Test
    @DisplayName("REQ-005 AC-3: HTTP 200 serializes all response fields including partial failure")
    void req005_ac3_responseSchema() throws Exception {
        var service = org.mockito.Mockito.mock(TransportService.class);
        var replacement = new Replacement(TargetType.HEADER, "key", ReplacementStatus.PLANNED, "dev", "prd", 1);
        var success = new ArtifactResult("A", null, TransportAction.NONE, List.of(replacement),
                List.of(new UnmappedKey(TargetType.HEADER, "other")), DeployStatus.NOT_REQUESTED, null);
        var failed = new ArtifactResult("B", null, TransportAction.NONE, List.of(), List.of(),
                DeployStatus.NOT_REQUESTED, new ArtifactError("ARTIFACT_NOT_FOUND", "Missing"));
        org.mockito.Mockito.when(service.preflightAndExecute(org.mockito.ArgumentMatchers.any(TransportRequest.class)))
                .thenReturn(new TransportResponse("transport-id", "Pkg", false, false, clock.instant(), clock.instant(),
                        new TransportSummary(2, 1, 1), List.of(success, failed)));
        mvc = mvc(service);
        String response = request("{\"packageId\":\"Pkg\"}").andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var root = json.readTree(response);
        assertThat(root.propertyNames()).containsExactlyInAnyOrder("transportId", "packageId", "dryRun", "deploy", "startedAt", "finishedAt", "summary", "results");
        assertThat(root.get("summary").propertyNames()).containsExactlyInAnyOrder("total", "succeeded", "failed");
        assertThat(root.at("/summary/total").asInt()).isEqualTo(2);
        assertThat(root.at("/summary/succeeded").asInt()).isEqualTo(1);
        assertThat(root.at("/summary/failed").asInt()).isEqualTo(1);
        var result = root.at("/results/0");
        assertThat(result.propertyNames()).containsExactlyInAnyOrder("artifactId", "status", "action", "replacements", "unmappedKeys", "deployStatus", "error");
        assertThat(result.get("status").asString()).isEqualTo("SUCCESS");
        assertThat(result.get("error").isNull()).isTrue();
        assertThat(root.at("/results/1/status").asString()).isEqualTo("FAILED");
        assertThat(root.at("/results/1/error").propertyNames()).containsExactlyInAnyOrder("code", "message");
        assertThat(result.at("/replacements/0").propertyNames()).containsExactlyInAnyOrder("targetType", "key", "before", "after", "status", "occurrences");
        assertThat(result.at("/unmappedKeys/0").propertyNames()).containsExactlyInAnyOrder("targetType", "key");
    }
    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-011 AC-1, AC-2, REQ-010 AC-5: each successful response is appended and queryable")
    void req011_ac1_history(boolean dryRun) throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/transport/history"))
                .andExpect(status().isOk()).andExpect(content().json("[]"));
        for (int i = 1; i <= 2; i++) {
            String response = request(json.writeValueAsString(Map.of("packageId", "Pkg", "dryRun", dryRun)))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            var lines = Files.readAllLines(temporary.resolve("history.jsonl"));
            assertThat(lines).hasSize(i);
            assertThat(json.readTree(lines.get(i - 1))).isEqualTo(json.readTree(response));
            assertThat(history.findAll().get(i - 1).dryRun()).isEqualTo(dryRun);
        }
        String result = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/transport/history"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(result)).isEqualTo(json.valueToTree(history.findAll()));
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 503, 422, 404, 502})
    @DisplayName("REQ-011 AC-1: rejected requests append zero lines")
    void req011_ac1_errors(int statusCode) throws Exception {
        switch (statusCode) {
            case 400 -> error("{}", 400, "INVALID_REQUEST");
            case 503 -> {
                configure(0, -1, "");
                error("{\"packageId\":\"Pkg\"}", 503, "ENVIRONMENT_NOT_CONFIGURED");
            }
            case 422 -> {
                configure(-1, -1, temporary.resolve("missing.yaml").toString());
                error("{\"packageId\":\"Pkg\"}", 422, "MAPPING_INVALID");
            }
            default -> {
                server.stubFor(get(urlEqualTo(PACKAGE)).willReturn(aResponse().withStatus(statusCode == 404 ? 404 : 500)));
                error("{\"packageId\":\"Pkg\"}", statusCode, statusCode == 404 ? "PACKAGE_NOT_FOUND" : "CPI_UNAVAILABLE");
            }
        }
        assertThat(Files.exists(temporary.resolve("history.jsonl"))).isFalse();
    }

}
