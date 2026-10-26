package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.controller.ApiExceptionHandler;
import com.company.sap.cpitransport.controller.TransportController;
import com.company.sap.cpitransport.model.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.ResponseDefinitionBuilder;
import com.github.tomakehurst.wiremock.stubbing.ServeEvent;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.zip.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// REQ-315: 대상에 이미 있는 아티팩트의 갱신 PUT이 400을 본문 없이(또는 공백뿐으로) 돌려받으면 결과 메시지에 편집 락 가능성 안내를 붙인다.
// 락을 감지·해제하지 않고 요청을 더 보내지 않는다(01_spec.md B2). WireMock은 dev(원본)·prd(대상) 두 대다.
class LockHintWireMockTests {
    private static final String HINT = "대상 테넌트에서 이 아티팩트가 편집 중(잠김)일 수 있습니다. CPI 화면에서 편집을 저장하거나 취소한 뒤 다시 시도하세요.";
    private static final String UPLOAD_400 = "UPLOAD: HTTP 400; CPI call failed";
    private static final String PACKAGE = "/api/v1/IntegrationPackages('PKG')";
    private static final String COLLECTION = "/api/v1/IntegrationDesigntimeArtifacts";
    private WireMockServer dev, prd;
    private TransportProperties settings;
    private CpiProperties connections;
    private final MutableClock clock = new MutableClock();
    private final JsonMapper json = JsonMapper.builder().build();
    @TempDir Path temporary;

    @BeforeEach
    void setUp() throws Exception {
        dev = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        prd = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        dev.start();
        prd.start();
        settings = new TransportProperties("", new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of("password", "token"));
        connections = new CpiProperties(connection(dev, "dev"), connection(prd, "prd"));
        dev.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo("/token"))
                .willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo("/token"))
                .willReturn(okJson("{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo("/api/v1/"))
                .willReturn(ok().withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
        for (var server : List.of(dev, prd)) {
            server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(PACKAGE))
                    .willReturn(okJson("{\"d\":{\"Id\":\"PKG\",\"Name\":\"Package\",\"Version\":\"1.0\"}}")));
        }
        dev.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(PACKAGE + "/IntegrationDesigntimeArtifacts"))
                .willReturn(okJson("{\"d\":{\"results\":[{\"Id\":\"A\",\"Name\":\"Name A\",\"Version\":\"1.0\"}]}}")));
        dev.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(path("A") + "/$value")).willReturn(ok().withBody(zip())));
        // 대상에 같은 ID가 있다 → UPLOAD는 갱신(PUT). 생성 경우는 테스트에서 404로 바꾼다.
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(path("A"))).willReturn(okJson("{\"d\":{\"Id\":\"A\"}}")));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(path("A"))).willReturn(noContent()));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(COLLECTION)).willReturn(created()));
        for (var server : List.of(dev, prd)) server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(path("A") + "/Configurations"))
                .willReturn(okJson("{\"d\":{\"results\":[{\"ParameterKey\":\"Endpoint\",\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"}]}}")));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(parameter("A"))).willReturn(noContent()));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(deploy("A"))).willReturn(noContent()));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(runtime("A"))).willReturn(okJson("{\"d\":{\"Status\":\"STARTED\"}}")));
    }

    @AfterEach void tearDown() { if (dev != null) dev.stop(); if (prd != null) prd.stop(); }

    @ParameterizedTest(name = "{displayName} [{index}] body={0}")
    @ValueSource(strings = {"", " ", " \r\n\t "})
    @DisplayName("REQ-315 AC-1·AC-5: update PUT 400 with empty or blank body stays FAILED UPLOAD_FAILED and carries the full lock hint")
    void req315_ac1_emptyBodyHint(String body) {
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(path("A"))).willReturn(status400(body)));
        var result = run(true).results().getFirst();
        assertThat(result.status()).isEqualTo(ArtifactStatus.FAILED);
        assertThat(result.error().code()).isEqualTo("UPLOAD_FAILED");
        assertThat(result.error().message()).isEqualTo(UPLOAD_400 + ". " + HINT);
        assertThat(result.error().message()).contains(HINT).startsWith(UPLOAD_400);
        assertThat(result.error().detail()).isNull();
        assertThat(result.action()).isEqualTo(TransportAction.NONE);
        assertThat(result.deployStatus()).isEqualTo(DeployStatus.NOT_REQUESTED);
        assertThat(result.replacements()).extracting(Replacement::status).containsOnly(ReplacementStatus.PLANNED);
        prd.verify(1, putRequestedFor(urlEqualTo(path("A"))));
        prd.verify(0, postRequestedFor(urlEqualTo(COLLECTION)));
        prd.verify(0, getRequestedFor(urlEqualTo(path("A") + "/Configurations")));
        prd.verify(0, postRequestedFor(urlEqualTo(deploy("A"))));
    }

    @ParameterizedTest(name = "{displayName} [{index}] {0}")
    @ValueSource(strings = {"PUT_400_TEXT_BODY", "PUT_400_JSON_BODY", "POST_CREATE_400_EMPTY", "CONFIGURATION_PUT_400_EMPTY",
            "DEPLOY_400_EMPTY", "PUT_409_EMPTY", "PUT_404_EMPTY", "TARGET_GET_400_EMPTY", "CSRF_FETCH_400_EMPTY"})
    @DisplayName("REQ-315 AC-2·AC-5: no lock hint for 400 with body, create POST, Configurations PUT, DEPLOY, non-400 status or non-PUT response")
    void req315_ac2_noHint(String scenario) {
        String code = "UPLOAD_FAILED";
        String message = UPLOAD_400;
        TransportAction action = TransportAction.NONE;
        switch (scenario) {
            case "PUT_400_TEXT_BODY" -> prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(path("A")))
                    .willReturn(aResponse().withStatus(400).withBody("Bad request")));
            case "PUT_400_JSON_BODY" -> prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(path("A")))
                    .willReturn(aResponse().withStatus(400).withHeader("Content-Type", "application/json")
                            .withBody("{\"error\":{\"code\":\"Bad Request\",\"message\":{\"lang\":\"en\",\"value\":\"Artifact is locked\"}}}")));
            case "POST_CREATE_400_EMPTY" -> {
                prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(path("A"))).willReturn(notFound()));
                prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(COLLECTION)).willReturn(status400("")));
            }
            case "CONFIGURATION_PUT_400_EMPTY" -> {
                prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(parameter("A"))).willReturn(status400("")));
                code = "CONFIGURATION_UPDATE_FAILED";
                message = "CONFIGURATION_UPDATE: Endpoint: HTTP 400";
                action = TransportAction.UPDATED;
            }
            case "DEPLOY_400_EMPTY" -> {
                prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(deploy("A"))).willReturn(status400("")));
                code = "DEPLOY_FAILED";
                message = "DEPLOY: CPI deployment ERROR";
                action = TransportAction.UPDATED;
            }
            case "PUT_409_EMPTY" -> {
                prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(path("A"))).willReturn(aResponse().withStatus(409)));
                message = "UPLOAD: HTTP 409; CPI call failed";
            }
            case "PUT_404_EMPTY" -> {
                prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(path("A"))).willReturn(aResponse().withStatus(404)));
                message = "UPLOAD: HTTP 404; CPI call failed";
            }
            case "TARGET_GET_400_EMPTY" -> {
                prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo(path("A"))).willReturn(status400("")));
                code = "TARGET_CHECK_FAILED";
                message = "TARGET: HTTP 400; CPI call failed";
            }
            // 갱신 PUT 직전의 CSRF 토큰 조회(GET /api/v1/)가 400 빈 본문이면 PUT 응답이 아니므로 안내하지 않는다.
            case "CSRF_FETCH_400_EMPTY" -> prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo("/api/v1/")).willReturn(status400("")));
            default -> fail("unknown scenario " + scenario);
        }
        var result = run(true).results().getFirst();
        assertThat(result.status()).isEqualTo(ArtifactStatus.FAILED);
        assertThat(result.error().code()).isEqualTo(code);
        assertThat(result.error().message()).isEqualTo(message);
        assertThat(result.error().message()).doesNotContain("잠김", "편집 중", "CPI 화면");
        assertThat(result.action()).isEqualTo(action);
        if (scenario.equals("CSRF_FETCH_400_EMPTY") || scenario.equals("TARGET_GET_400_EMPTY")) {
            prd.verify(0, putRequestedFor(urlEqualTo(path("A"))));
        }
        if (scenario.equals("POST_CREATE_400_EMPTY")) {
            prd.verify(1, postRequestedFor(urlEqualTo(COLLECTION)));
            prd.verify(0, putRequestedFor(urlEqualTo(path("A"))));
        }
    }

    @Test
    @DisplayName("REQ-315 AC-4·AC-5: lock hint case sends the same requests as a plain 400 and no unlock or other-version request")
    void req315_ac4_sameRequests() {
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(path("A"))).willReturn(aResponse().withStatus(400).withBody("Bad request")));
        var plain = run(true).results().getFirst();
        var plainPrd = requests(prd);
        var plainDev = requests(dev);
        assertThat(plain.error().message()).isEqualTo(UPLOAD_400);

        prd.resetRequests();
        dev.resetRequests();
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(path("A"))).willReturn(status400("")));
        var hinted = run(true).results().getFirst();
        var hintedPrd = requests(prd);
        var hintedDev = requests(dev);
        assertThat(hinted.error().message()).isEqualTo(UPLOAD_400 + ". " + HINT);

        assertThat(hintedPrd).isEqualTo(plainPrd);
        assertThat(hintedDev).isEqualTo(plainDev);
        assertThat(hintedPrd).containsExactly("POST /token", "GET " + PACKAGE, "GET " + path("A"), "GET /api/v1/", "PUT " + path("A"));
        assertThat(hintedDev).containsExactly("POST /token", "GET " + path("A") + "/$value");
        // 락 해제·다른 버전 업로드·추가 조회 요청이 없다: 쓰기는 갱신 PUT 1건, 버전은 'active'뿐, 메서드 덮어쓰기 헤더 없음.
        assertThat(hintedPrd).filteredOn(r -> !r.startsWith("GET ") && !r.equals("POST /token")).containsExactly("PUT " + path("A"));
        assertThat(hintedPrd).allMatch(r -> !r.contains("Version=") || r.contains("Version='active'"))
                .noneMatch(r -> r.toLowerCase(Locale.ROOT).contains("lock"))
                .noneMatch(r -> r.startsWith("DELETE ") || r.startsWith("PATCH ") || r.startsWith("MERGE "));
        prd.verify(0, anyRequestedFor(anyUrl()).withHeader("X-HTTP-Method", matching(".*")));
        prd.verify(1, putRequestedFor(urlEqualTo(path("A"))));
        assertThat(prd.getAllServeEvents()).hasSize(5);
        assertThat(dev.getAllServeEvents()).hasSize(2);
    }

    @Test
    @DisplayName("REQ-315 AC-3·AC-5: POST /transport response, history JSONL and GET /transport/history keep the lock hint")
    void req315_ac3_history() throws Exception {
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.put(urlEqualTo(path("A"))).willReturn(status400("")));
        var history = new TransportHistoryStore(settings, json);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new TransportController(service(), new EnvironmentGuard(connections), history,
                        new ReadOnlyProperties(false)))
                .setControllerAdvice(new ApiExceptionHandler()).build();
        String expected = UPLOAD_400 + ". " + HINT;

        String response = mvc.perform(post("/transport").contentType("application/json")
                        .content("{\"packageId\":\"PKG\",\"artifactIds\":[\"A\"],\"dryRun\":false,\"deploy\":true}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        var root = json.readTree(response);
        assertThat(root.at("/results/0/status").asString()).isEqualTo("FAILED");
        assertThat(root.at("/results/0/error/code").asString()).isEqualTo("UPLOAD_FAILED");
        assertThat(root.at("/results/0/error/message").asString()).isEqualTo(expected);

        var lines = Files.readAllLines(temporary.resolve("history.jsonl"), StandardCharsets.UTF_8);
        assertThat(lines).hasSize(1);
        assertThat(json.readTree(lines.getFirst()).at("/results/0/error/message").asString()).isEqualTo(expected);
        assertThat(json.readTree(lines.getFirst())).isEqualTo(root);
        var reloaded = new TransportHistoryStore(settings, json).findAll();
        assertThat(reloaded).hasSize(1);
        assertThat(reloaded.getFirst().results().getFirst().error().message()).isEqualTo(expected);

        String listed = mvc.perform(get("/transport/history")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        var entries = json.readTree(listed);
        assertThat(entries.size()).isEqualTo(1);
        assertThat(entries.at("/0/transportId").asString()).isEqualTo(root.get("transportId").asString());
        assertThat(entries.at("/0/results/0/status").asString()).isEqualTo("FAILED");
        assertThat(entries.at("/0/results/0/error/message").asString()).isEqualTo(expected);
    }

    private static ResponseDefinitionBuilder status400(String body) {
        var response = aResponse().withStatus(400);
        return body.isEmpty() ? response : response.withBody(body);
    }
    private List<String> requests(WireMockServer server) {
        var events = new ArrayList<>(server.getAllServeEvents());
        Collections.reverse(events); // getAllServeEvents는 최근 요청이 먼저다 → 보낸 순서로
        return events.stream().map(ServeEvent::getRequest).map(r -> r.getMethod().getName() + " " + r.getUrl()).toList();
    }
    private TransportService service() {
        // 실행마다 새 토큰·CSRF 캐시로 만든다(AC-4의 두 실행이 같은 조건에서 요청을 보내도록).
        var tokens = new OAuthTokenProvider(connections, settings, clock, clock::advance);
        var api = new CpiApiClient(new CpiHttpExecutor(connections, tokens, new CsrfTokenStore(), settings, clock::advance), json);
        var sensitive = new SensitiveKeyMatcher(settings);
        return new TransportService(api, new IflwReplacer(sensitive), new ExternalParameterReplacer(api, sensitive),
                new DeployService(api, settings, clock, clock::advance), new MappingFileLoader(settings), clock);
    }
    private TransportResponse run(boolean deploy) {
        return service().execute(new TransportRequest("PKG", List.of("A"), false, deploy),
                List.of(new CpiArtifact("A", "Name A", "1.0")), rules());
    }
    private List<MappingEntry> rules() {
        return List.of(new MappingEntry("A", TargetType.HEADER, "Endpoint", "dev", "prd"),
                new MappingEntry("A", TargetType.EXTERNAL_PARAM, "Endpoint", "dev", "prd"));
    }
    private CpiProperties.Connection connection(WireMockServer server, String env) {
        String base = "http://localhost:" + server.port();
        return new CpiProperties.Connection(base, base + "/token", "dummy-" + env + "-client", "dummy-" + env + "-secret");
    }
    private static String path(String id) { return COLLECTION + "(Id='" + id + "',Version='active')"; }
    private static String parameter(String id) { return path(id) + "/$links/Configurations('Endpoint')"; }
    private static String deploy(String id) { return "/api/v1/DeployIntegrationDesigntimeArtifact?Id='" + id + "'&Version='active'"; }
    private static String runtime(String id) { return "/api/v1/IntegrationRuntimeArtifacts('" + id + "')"; }
    private byte[] zip() throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry("src/main/resources/scenarioflows/integrationflow/flow.iflw"));
            zip.write(("<b:definitions xmlns:b=\"http://www.omg.org/spec/BPMN/20100524/MODEL\" xmlns:ifl=\"http:///com.sap.ifl.model/Ifl.xsd\">"
                    + "<b:callActivity><ifl:property><key>activityType</key><value>Enricher</value></ifl:property>"
                    + "<ifl:property><key>headerTable</key><value><![CDATA[<row><cell id='Name'>Endpoint</cell><cell id='Value'>dev</cell></row>]]></value></ifl:property>"
                    + "</b:callActivity></b:definitions>").getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        return bytes.toByteArray();
    }
    private static class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-01-01T00:00:00Z");
        void advance(Duration duration) { now = now.plus(duration); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
