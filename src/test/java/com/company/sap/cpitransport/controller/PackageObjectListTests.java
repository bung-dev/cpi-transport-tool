package com.company.sap.cpitransport.controller;

import java.nio.file.Path;
import java.time.*;
import java.util.List;
import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.service.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** REQ-1001 종류별 목록: GET /packages/{packageId}/artifacts?tenantId=&type=. */
class PackageObjectListTests {
    private static final String PACKAGES = "/api/v1/IntegrationPackages";
    private WireMockServer server;
    private MockMvc mvc;
    private final java.util.ArrayList<Duration> waits = new java.util.ArrayList<>();
    @TempDir Path temporary;

    @BeforeEach
    void setUp() {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        server.start();
        String base = "http://localhost:" + server.port();
        var properties = new CpiProperties(new CpiProperties.Connection(base, base + "/token", "dummy-dev-client",
                "dummy-dev-secret"), new CpiProperties.Connection("", "", "", ""));
        var transport = new TransportProperties(new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(5), Duration.ofSeconds(300)), List.of());
        Sleeper sleeper = waits::add;
        var tokens = new OAuthTokenProvider(properties, transport,
                Clock.fixed(Instant.parse("2026-11-21T00:00:00Z"), ZoneOffset.UTC), sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(properties, tokens, new CsrfTokenStore(), transport, sleeper),
                JsonMapper.builder().build());
        mvc = MockMvcBuilders.standaloneSetup(new PackageController(new PackageQueryService(
                new EnvironmentGuard(properties), api))).setControllerAdvice(new ApiExceptionHandler()).build();
        server.stubFor(post(urlEqualTo("/token")).willReturn(okJson(
                "{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(PACKAGES + "('Pkg')"))
                .willReturn(okJson("{\"d\":{\"Id\":\"Pkg\",\"Name\":\"Orders\",\"Version\":\"1\"}}")));
    }

    @AfterEach
    void tearDown() { server.stop(); }

    private static String listPath(String segment) {
        return PACKAGES + "('Pkg')/" + segment + "DesigntimeArtifacts";
    }

    private void stubList(String segment, String id) {
        server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(listPath(segment)))
                .willReturn(okJson("{\"d\":{\"results\":[{\"Id\":\"" + id + "\",\"Name\":\"Name " + id
                        + "\",\"Version\":\"1.0.2\",\"PackageId\":\"Pkg\"}]}}")));
    }

    @ParameterizedTest
    @CsvSource({"SCRIPT_COLLECTION,ScriptCollection", "MESSAGE_MAPPING,MessageMapping", "VALUE_MAPPING,ValueMapping"})
    @DisplayName("REQ-1001: 새 종류 목록은 {T}DesigntimeArtifacts 페이지 조회를 iFlow 목록과 같은 모양으로 돌려준다")
    void listsNewType(String type, String segment) throws Exception {
        stubList(segment, "Obj_" + segment);
        mvc.perform(get("/packages/Pkg/artifacts").param("tenantId", "DEV").param("type", type))
                .andExpect(status().isOk())
                .andExpect(content().json("[{\"id\":\"Obj_" + segment + "\",\"name\":\"Name Obj_" + segment
                        + "\",\"version\":\"1.0.2\"}]", true));
        server.verify(1, getRequestedFor(urlEqualTo(listPath(segment))));
        server.verify(0, getRequestedFor(urlEqualTo(listPath("Integration"))));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "INTEGRATION_FLOW"})
    @DisplayName("REQ-1001: type이 없거나 INTEGRATION_FLOW면 지금 iFlow 목록 그대로다")
    void iflowListUnchanged(String type) throws Exception {
        stubList("Integration", "Flow");
        var request = get("/packages/Pkg/artifacts");
        if (!type.isEmpty()) request = request.param("type", type);
        mvc.perform(request).andExpect(status().isOk())
                .andExpect(content().json("[{\"id\":\"Flow\",\"name\":\"Name Flow\",\"version\":\"1.0.2\"}]", true));
        server.verify(1, getRequestedFor(urlEqualTo(listPath("Integration"))));
        server.verify(0, getRequestedFor(urlMatching(".*/(ScriptCollection|MessageMapping|ValueMapping)DesigntimeArtifacts.*")));
    }

    @ParameterizedTest
    @CsvSource({"SCRIPT_COLLECTION,ScriptCollection", "MESSAGE_MAPPING,MessageMapping", "VALUE_MAPPING,ValueMapping"})
    @DisplayName("REQ-1001 실패: 새 종류 목록 404는 200 빈 목록이다")
    void newType404IsEmpty(String type, String segment) throws Exception {
        server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(listPath(segment)))
                .willReturn(aResponse().withStatus(404)));
        mvc.perform(get("/packages/Pkg/artifacts").param("type", type))
                .andExpect(status().isOk()).andExpect(content().json("[]", true));
        server.verify(1, getRequestedFor(urlEqualTo(listPath(segment))));
    }

    @Test
    @DisplayName("REQ-1001 실패: 새 종류 목록 5xx는 iFlow 목록 실패와 같은 502 CPI_UNAVAILABLE이고 다른 종류 목록은 그대로다")
    void newType500IsIflowLikeFailure() throws Exception {
        server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(listPath("MessageMapping")))
                .willReturn(aResponse().withStatus(500).withBody("dummy-dev-token-0001 dummy-dev-secret")));
        stubList("ScriptCollection", "Scripts");
        mvc.perform(get("/packages/Pkg/artifacts").param("type", "MESSAGE_MAPPING"))
                .andExpect(status().is(502)).andExpect(jsonPath("$.error").value("CPI_UNAVAILABLE"))
                .andExpect(jsonPath("$.*").value(org.hamcrest.Matchers.hasSize(2)))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("dummy-"))));
        server.verify(3, getRequestedFor(urlEqualTo(listPath("MessageMapping"))));
        mvc.perform(get("/packages/Pkg/artifacts").param("type", "SCRIPT_COLLECTION"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value("Scripts"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"script_collection", "IFLOW", "VALUE_MAPPINGS", " ", "DATA_TYPE"})
    @DisplayName("REQ-1001 실패: type이 네 값이 아니면 400 INVALID_REQUEST이고 CPI를 부르지 않는다")
    void invalidType(String type) throws Exception {
        mvc.perform(get("/packages/Pkg/artifacts").param("type", type))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
        assertThat(server.getAllServeEvents()).isEmpty();
    }
}
