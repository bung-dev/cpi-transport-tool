package com.company.sap.cpitransport.controller;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.service.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.assertThat;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@ExtendWith(OutputCaptureExtension.class)
class InvalidIdWireMockTests {
    private static final String NAME = "한글 공백 \"따옴표\" & 설명";
    private final JsonMapper json = new JsonMapper();
    @TempDir Path directory;
    private WireMockServer source, target;
    private MockMvc mvc;

    @BeforeEach void setUp() {
        source = new WireMockServer(wireMockConfig().dynamicPort());
        target = new WireMockServer(wireMockConfig().dynamicPort());
        source.start(); target.start();
        source.stubFor(post(urlEqualTo("/token")).willReturn(okJson(
                "{\"access_token\":\"test-dummy-shape-token\",\"expires_in\":3600}")));
        var properties = new CpiProperties(connection(source), connection(target));
        var settings = new TransportProperties("", new TransportProperties.History(directory.resolve("history.jsonl")),
                new TransportProperties.Retry(1, Duration.ZERO),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of());
        var clock = Clock.systemUTC();
        Sleeper sleeper = duration -> { throw new AssertionError("Unexpected retry"); };
        var tokens = new OAuthTokenProvider(properties, settings, clock, sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(properties, tokens, new CsrfTokenStore(), settings, sleeper), json);
        var sensitive = new SensitiveKeyMatcher(settings);
        var service = new TransportService(api, new IflwReplacer(sensitive), new ExternalParameterReplacer(api, sensitive),
                new DeployService(api, settings, clock, sleeper), new MappingFileLoader(settings), clock);
        var guard = new EnvironmentGuard(properties);
        mvc = MockMvcBuilders.standaloneSetup(new PackageController(new PackageQueryService(guard, api)),
                new TransportController(service, guard, new TransportHistoryStore(settings, json), new ReadOnlyProperties(false)))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    private CpiProperties.Connection connection(WireMockServer server) {
        return new CpiProperties.Connection(server.baseUrl(), server.baseUrl() + "/token",
                "test-dummy-shape-client", "test-dummy-shape-secret");
    }

    @AfterEach void stop() {
        if (source != null) source.stop();
        if (target != null) target.stop();
    }

    @ParameterizedTest(name = "REQ-304 AC-3·AC-5: invalid identifier {0}")
    @ValueSource(strings = {"bad id", "한글", "bad'id", "bad&id", "bad\"id"})
    @DisplayName("REQ-304 AC-3·AC-5: reject invalid package and artifact IDs before any CPI request")
    void req304_ac3_invalidIds(String id) throws Exception {
        mvc.perform(MockMvcRequestBuilders.get("/packages/{id}/artifacts", id)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
        for (boolean dryRun : List.of(true, false)) {
            for (var body : List.of(Map.of("packageId", id, "dryRun", dryRun),
                    Map.of("packageId", "Pkg", "artifactIds", List.of(id), "dryRun", dryRun))) {
                mvc.perform(MockMvcRequestBuilders.post("/transport").contentType("application/json").content(json.writeValueAsString(body)))
                        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
            }
        }
        assertThat(source.getAllServeEvents()).isEmpty();
        assertThat(target.getAllServeEvents()).isEmpty();
    }

    @Test @DisplayName("REQ-304 AC-3·AC-5: invalid IDs stay visible in package and artifact lists")
    void req304_ac3_invalidListIds() throws Exception {
        var item = Map.of("Id", "bad id", "Name", NAME, "Version", "1");
        source.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages")).willReturn(okJson(
                json.writeValueAsString(Map.of("d", Map.of("results", List.of(item)))))));
        source.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages('Pkg')")).willReturn(okJson(
                json.writeValueAsString(Map.of("d", Map.of("Id", "Pkg", "Name", NAME, "Version", "1"))))));
        source.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages('Pkg')/IntegrationDesigntimeArtifacts"))
                .willReturn(okJson(json.writeValueAsString(Map.of("d", Map.of("results", List.of(item)))))));
        mvc.perform(MockMvcRequestBuilders.get("/packages")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("bad id")).andExpect(jsonPath("$[0].name").value(NAME));
        mvc.perform(MockMvcRequestBuilders.get("/packages/Pkg/artifacts")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("bad id")).andExpect(jsonPath("$[0].name").value(NAME));
        assertThat(target.getAllServeEvents()).isEmpty();
    }

    @Test @DisplayName("REQ-304 AC-3·AC-5: Korean names quotes spaces and ampersands survive list selection and dry-run")
    void req304_ac3_namesAndDryRun() throws Exception {
        var pkg = Map.of("Id", "Pkg", "Name", NAME, "Version", "1", "Description", NAME);
        var artifact = Map.of("Id", "Flow", "Name", NAME, "Version", "1");
        source.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages")).willReturn(okJson(
                json.writeValueAsString(Map.of("d", Map.of("results", List.of(pkg)))))));
        source.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages('Pkg')")).willReturn(okJson(json.writeValueAsString(Map.of("d", pkg)))));
        source.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages('Pkg')/IntegrationDesigntimeArtifacts"))
                .willReturn(okJson(json.writeValueAsString(Map.of("d", Map.of("results", List.of(artifact)))))));
        String path = "/api/v1/IntegrationDesigntimeArtifacts(Id='Flow',Version='active')";
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry("src/main/resources/scenarioflows/integrationflow/Flow.iflw"));
            zip.write("<flow/>".getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        source.stubFor(get(urlEqualTo(path + "/$value")).willReturn(ok().withBody(bytes.toByteArray())));
        source.stubFor(get(urlEqualTo(path + "/Configurations")).willReturn(okJson("{\"d\":{\"results\":[]}}")));
        mvc.perform(MockMvcRequestBuilders.get("/packages")).andExpect(status().isOk()).andExpect(jsonPath("$[0].name").value(NAME));
        mvc.perform(MockMvcRequestBuilders.get("/packages/Pkg/artifacts")).andExpect(status().isOk()).andExpect(jsonPath("$[0].name").value(NAME));
        mvc.perform(MockMvcRequestBuilders.post("/transport").contentType("application/json").content(json.writeValueAsString(
                        Map.of("packageId", "Pkg", "artifactIds", List.of("Flow"), "dryRun", true))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.summary.succeeded").value(1))
                .andExpect(jsonPath("$.results[0].artifactId").value("Flow"));
        assertThat(target.getAllServeEvents()).isEmpty();
    }

    @ParameterizedTest(name = "REQ-304 AC-4·AC-5 / REQ-305 AC-3: HTTP API hides HTML status {0}")
    @ValueSource(ints = {200, 400, 503})
    @DisplayName("REQ-304 AC-4·AC-5 / REQ-305 AC-3: API and logs omit non-JSON response content")
    void req304_ac4_apiHtml(int status, CapturedOutput output) throws Exception {
        String body = "<html>test-dummy-api-login test-dummy-shape-token test-dummy-shape-secret</html>";
        source.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages")).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "text/html").withBody(body)));
        var response = mvc.perform(MockMvcRequestBuilders.get("/packages")).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").value("CPI_UNAVAILABLE")).andReturn().getResponse().getContentAsString();
        assertThat(response + output.getAll()).doesNotContain("test-dummy-api-login", "test-dummy-shape-token", "test-dummy-shape-secret");
        assertThat(target.getAllServeEvents()).isEmpty();
    }
}
