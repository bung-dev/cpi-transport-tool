package com.company.sap.cpitransport.controller;

import java.nio.file.Path;
import java.time.*;
import java.util.List;
import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.model.ErrorResponse;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PackageControllerTests {
    private static final String PACKAGES = "/api/v1/IntegrationPackages";
    private WireMockServer server;
    private MockMvc mvc;
    private final java.util.ArrayList<Duration> waits = new java.util.ArrayList<>();
    @TempDir Path temporary;

    @BeforeEach
    void setUp() {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        server.start();
        configure(-1);
        server.stubFor(post(urlEqualTo("/token")).willReturn(okJson(
                "{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
    }

    private void configure(int missingIndex) {
        String base = "http://localhost:" + server.port();
        String[] values = {base, base + "/token", "dummy-dev-client", "dummy-dev-secret"};
        if (missingIndex >= 0) values[missingIndex] = "";
        if (missingIndex == 4) throw new AssertionError("Invalid index");
        var properties = new CpiProperties(new CpiProperties.Connection(values[0], values[1], values[2], values[3]),
                new CpiProperties.Connection("", "", "", ""));
        var transport = new TransportProperties("", new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(5), Duration.ofSeconds(300)), List.of());
        Sleeper sleeper = waits::add;
        var tokens = new OAuthTokenProvider(properties, transport,
                Clock.fixed(Instant.parse("2026-09-29T00:00:00Z"), ZoneOffset.UTC), sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(properties, tokens, new CsrfTokenStore(), transport, sleeper),
                JsonMapper.builder().build());
        mvc = MockMvcBuilders.standaloneSetup(new PackageController(new PackageQueryService(
                new EnvironmentGuard(properties), api))).setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @AfterEach
    void tearDown() { if (server != null) server.stop(); }

    private String packagePath(String id) { return PACKAGES + "('" + id + "')"; }
    private String artifactsPath(String id) { return packagePath(id) + "/IntegrationDesigntimeArtifacts"; }
    private void stubPackage(String id) {
        server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(packagePath(id)))
                .willReturn(okJson("{\"d\":{\"Id\":\"" + id + "\",\"Name\":\"Orders\",\"Version\":\"1\"}}")));
    }
    private void stubList(String path) {
        server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(path)).willReturn(okJson(
                "{\"d\":{\"results\":[{\"Id\":\"Item\",\"Name\":\"Orders\",\"Version\":\"1\",\"Extra\":true}]}}")));
    }
    private void error(String path, int status, String code) throws Exception {
        mvc.perform(get(path)).andExpect(status().is(status)).andExpect(jsonPath("$.error").value(code))
                .andExpect(jsonPath("$.message").isString()).andExpect(jsonPath("$.*").value(org.hamcrest.Matchers.hasSize(2)))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("dummy-"))));
    }

    @Test
    @DisplayName("REQ-004 AC-1: DEV packages map exactly three fields with PRD unset")
    void req004_ac1_packages() throws Exception {
        stubList(PACKAGES);
        mvc.perform(get("/packages")).andExpect(status().isOk()).andExpect(content().json(
                "[{\"id\":\"Item\",\"name\":\"Orders\",\"version\":\"1\"}]"))
                .andExpect(jsonPath("$[0].*").value(org.hamcrest.Matchers.hasSize(3)));
        server.verify(1, getRequestedFor(urlEqualTo(PACKAGES)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"Pkg", "a", "A_0.-", "boundary"})
    @DisplayName("REQ-004 AC-2, AC-4: artifacts and valid ID boundaries")
    void req004_ac2_artifacts(String input) throws Exception {
        String id = input.equals("boundary") ? "a".repeat(100) : input;
        stubPackage(id);
        stubList(artifactsPath(id));
        mvc.perform(get("/packages/{id}/artifacts", id)).andExpect(status().isOk())
                .andExpect(content().json("[{\"id\":\"Item\",\"name\":\"Orders\",\"version\":\"1\"}]"))
                .andExpect(jsonPath("$[0].*").value(org.hamcrest.Matchers.hasSize(3)));
        server.verify(1, getRequestedFor(urlEqualTo(artifactsPath(id))));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-004 AC-3: package and artifact resource 404 are package not found")
    void req004_ac3_missingPackage(boolean artifactFailure) throws Exception {
        if (artifactFailure) stubPackage("Pkg");
        String path = artifactFailure ? artifactsPath("Pkg") : packagePath("Pkg");
        server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(path)).willReturn(aResponse().withStatus(404)));
        error("/packages/Pkg/artifacts", 404, "PACKAGE_NOT_FOUND");
        server.verify(1, getRequestedFor(urlEqualTo(path)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"a b", "long", "x'y", "<script>", "??", "a+b"})
    @DisplayName("REQ-004 AC-4, AC-6: invalid IDs make zero CPI calls and precede missing environment")
    void req004_ac4_invalid(String input) throws Exception {
        String id = input.equals("long") ? "a".repeat(101) : input;
        for (int configuration : new int[]{-1, 0}) {
            configure(configuration);
            mvc.perform(get("/packages/{id}/artifacts", id)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
        }
        assertThat(server.getAllServeEvents()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 2, 3})
    @DisplayName("REQ-002 AC-2: each missing DEV key returns only its name and makes zero CPI calls")
    void req002_ac2_missingEnvironment(int index) throws Exception {
        configure(index);
        String key = List.of("api-url", "token-url", "client-id", "client-secret").get(index);
        for (String path : List.of("/packages", "/packages/Pkg/artifacts")) {
            error(path, 503, "ENVIRONMENT_NOT_CONFIGURED");
            mvc.perform(get(path)).andExpect(jsonPath("$.message").value("cpi.environments.dev." + key));
        }
        assertThat(server.getAllServeEvents()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(ints = {404, 500})
    @DisplayName("REQ-004 AC-5: token failure is 502 on both APIs and retries only 500")
    void req004_ac5_tokenFailure(int status) throws Exception {
        server.stubFor(post(urlEqualTo("/token")).willReturn(aResponse().withStatus(status).withBody("dummy-dev-secret")));
        error("/packages", 502, "CPI_UNAVAILABLE");
        error("/packages/Pkg/artifacts", 502, "CPI_UNAVAILABLE");
        server.verify(status == 500 ? 6 : 2, postRequestedFor(urlEqualTo("/token")));
        server.verify(0, getRequestedFor(urlMatching(".*")));
        assertThat(waits).hasSize(status == 500 ? 4 : 0);
    }

    @ParameterizedTest
    @ValueSource(strings = {"list404", "list500", "package500", "artifacts500"})
    @DisplayName("REQ-004 AC-5: list 404 and exhausted resource failures are sanitized 502")
    void req004_ac5_getFailures(String failure) throws Exception {
        boolean list = failure.startsWith("list");
        String path = list ? PACKAGES : failure.startsWith("package") ? packagePath("Pkg") : artifactsPath("Pkg");
        if (failure.startsWith("artifacts")) stubPackage("Pkg");
        int status = failure.endsWith("404") ? 404 : 500;
        server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(path))
                .willReturn(aResponse().withStatus(status).withBody("dummy-dev-token-0001 dummy-dev-secret")));
        error(list ? "/packages" : "/packages/Pkg/artifacts", 502, "CPI_UNAVAILABLE");
        server.verify(status == 500 ? 3 : 1, getRequestedFor(urlEqualTo(path)));
        assertThat(waits).hasSize(status == 500 ? 2 : 0);
    }

    @Test
    @DisplayName("REQ-004 AC-6: common handler supplies mapping-invalid error contract for subsequent APIs")
    void req004_ac6_commonErrorContract() {
        var response = new ApiExceptionHandler().api(new ErrorResponse.ApiException(ErrorResponse.Code.MAPPING_INVALID));
        assertThat(response.getStatusCode().value()).isEqualTo(422);
        assertThat(response.getBody()).isEqualTo(new ErrorResponse("MAPPING_INVALID", "Invalid mapping"));
    }
}
