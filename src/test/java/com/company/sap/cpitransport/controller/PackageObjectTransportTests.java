package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.service.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.stubbing.Scenario;
import com.github.tomakehurst.wiremock.stubbing.ServeEvent;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 20261121-package-objects S2: REQ-1003 이관 요청과 결과의 종류, REQ-1004 새 종류 이관 동작.
 * POST /transport(동기)로 확인한다. 결과 JSON의 `type`은 INTEGRATION_FLOW / SCRIPT_COLLECTION / MESSAGE_MAPPING / VALUE_MAPPING.
 * 새 종류 경로: 목록 IntegrationPackages('{pkg}')/{T}DesigntimeArtifacts, 한 건 {T}DesigntimeArtifacts(Id='{id}',Version='active'),
 * 내려받기 한 건/$value, 생성 POST {T}DesigntimeArtifacts, 갱신 PUT 한 건, 삭제 DELETE 한 건.
 * WireMock dev(원본)·prd(대상) 두 대와 더미 자격증명만 쓴다.
 */
@ExtendWith(OutputCaptureExtension.class)
class PackageObjectTransportTests {
    private static final String ROOT = "/api/v1";
    private static final String SC = "ScriptCollection", MM = "MessageMapping", VM = "ValueMapping", IF = "Integration";
    private static final String LOST = "대상에서 밸류 매핑이 지워졌고 되살리지 못했습니다. CPI에서 직접 확인하세요";
    private final JsonMapper json = JsonMapper.builder().build();
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-21T00:00:00Z"), ZoneOffset.UTC);
    private WireMockServer dev, prd;
    private MockMvc mvc;
    private TransportProperties settings;
    @TempDir Path temporary;

    @BeforeEach
    void setUp() {
        dev = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        prd = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        dev.start();
        prd.start();
        String devBase = "http://localhost:" + dev.port();
        String prdBase = "http://localhost:" + prd.port();
        var props = new CpiProperties(
                new CpiProperties.Connection(devBase, devBase + "/token", "dummy-dev-client", "dummy-dev-secret"),
                new CpiProperties.Connection(prdBase, prdBase + "/token", "dummy-prd-client", "dummy-prd-secret"));
        settings = new TransportProperties(new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of());
        Sleeper sleeper = duration -> {};
        var tokens = new OAuthTokenProvider(props, settings, clock, sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(props, tokens, new CsrfTokenStore(), settings, sleeper), json);
        var service = new TransportService(api, new ConfigurationCopier(api, new SensitiveKeyMatcher(settings)),
                new DeployService(api, settings, clock, sleeper), clock);
        var guard = new EnvironmentGuard(props);
        mvc = MockMvcBuilders.standaloneSetup(new TransportController(service, guard,
                        new TransportHistoryStore(settings, json), new ReadOnlyProperties(false)))
                .setControllerAdvice(new ApiExceptionHandler()).build();

        dev.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo("/token"))
                .willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo("/token"))
                .willReturn(okJson("{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(get(urlEqualTo(ROOT + "/")).withHeader("X-CSRF-Token", equalTo("Fetch"))
                .willReturn(ok().withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
        sourcePackage("PKG", Map.of(IF, List.of("F1"), SC, List.of("SC1", "SC2"), MM, List.of("MM1"), VM, List.of("VM1", "VM2")));
        // 대상: 패키지는 있고 아티팩트는 기본으로 없다(생성).
        prd.stubFor(get(urlMatching(ROOT + "/(Integration|ScriptCollection|MessageMapping|ValueMapping)DesigntimeArtifacts\\(.*"))
                .atPriority(10).willReturn(notFound()));
        for (String segment : List.of(IF, SC, MM, VM)) {
            prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(collection(segment)))
                    .atPriority(10).willReturn(created()));
        }
        prd.stubFor(put(urlMatching(ROOT + "/.*DesigntimeArtifacts\\(.*")).atPriority(10).willReturn(noContent()));
        prd.stubFor(delete(urlMatching(ROOT + "/.*DesigntimeArtifacts\\(.*")).atPriority(10).willReturn(noContent()));
    }

    @AfterEach void tearDown() { if (dev != null) dev.stop(); if (prd != null) prd.stop(); }

    // ---- 도우미 ----
    private static String pkg(String id) { return ROOT + "/IntegrationPackages('" + id + "')"; }
    private static String list(String packageId, String segment) { return pkg(packageId) + "/" + segment + "DesigntimeArtifacts"; }
    private static String collection(String segment) { return ROOT + "/" + segment + "DesigntimeArtifacts"; }
    private static String entity(String segment, String id) { return collection(segment) + "(Id='" + id + "',Version='active')"; }
    private static String b64(String text) { return Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)); }

    private void sourcePackage(String packageId, Map<String, List<String>> objects) {
        String meta = "{\"d\":{\"Id\":\"" + packageId + "\",\"Name\":\"Package " + packageId + "\",\"Version\":\"1.0.0\"}}";
        dev.stubFor(get(urlEqualTo(pkg(packageId))).willReturn(okJson(meta)));
        prd.stubFor(get(urlEqualTo(pkg(packageId))).willReturn(okJson(meta)));
        for (var entry : objects.entrySet()) {
            var results = new StringJoiner(",");
            for (String id : entry.getValue()) {
                results.add("{\"Id\":\"" + id + "\",\"Name\":\"Name " + id + "\",\"Version\":\"1.0.0\",\"PackageId\":\"" + packageId + "\"}");
                dev.stubFor(get(urlEqualTo(entity(entry.getKey(), id) + "/$value")).willReturn(ok().withBody("src-" + id)));
                if (entry.getKey().equals(IF)) {
                    dev.stubFor(get(urlEqualTo(entity(IF, id) + "/Configurations")).willReturn(okJson("{\"d\":{\"results\":[]}}")));
                }
            }
            dev.stubFor(get(urlEqualTo(list(packageId, entry.getKey())))
                    .willReturn(okJson("{\"d\":{\"results\":[" + results + "]}}")));
        }
    }

    private void targetExists(String segment, String id) {
        prd.stubFor(get(urlEqualTo(entity(segment, id))).willReturn(okJson("{\"d\":{\"Id\":\"" + id + "\",\"Version\":\"1.0.0\"}}")));
        prd.stubFor(get(urlEqualTo(entity(segment, id) + "/$value")).willReturn(ok().withBody("tgt-" + id)));
    }

    private JsonNode transport(String body) throws Exception {
        return json.readTree(mvc.perform(post("/transport").contentType("application/json").content(body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private static JsonNode result(JsonNode response, String id) {
        for (var item : response.get("results")) if (id.equals(item.get("artifactId").asString())) return item;
        throw new AssertionError("no result " + id);
    }

    /** prd가 받은 요청을 받은 순서대로 "METHOD url"로. */
    private List<String> prdRequests() {
        // getAllServeEvents는 최근 것이 먼저다.
        var events = new ArrayList<>(prd.getAllServeEvents());
        Collections.reverse(events);
        return events.stream().map(ServeEvent::getRequest).map(r -> r.getMethod() + " " + r.getUrl()).toList();
    }

    // ---- REQ-1004 생성·갱신·삭제 후 다시 만듦 ----

    @Test
    @DisplayName("REQ-1004: 대상에 없는 새 종류는 원본 zip을 내려받아 POST {Name, Id, PackageId, ArtifactContent}로 만들고 CREATED, 구성 값은 읽지 않는다")
    void createsMissingObjects() throws Exception {
        var response = transport("{\"packageId\":\"PKG\",\"artifactIds\":[],\"scriptCollectionIds\":[\"SC1\"],"
                + "\"messageMappingIds\":[\"MM1\"],\"valueMappingIds\":[\"VM1\"]}");
        assertThat(response.get("results")).hasSize(3);
        for (var expected : List.of(List.of("SC1", SC, "SCRIPT_COLLECTION"), List.of("MM1", MM, "MESSAGE_MAPPING"),
                List.of("VM1", VM, "VALUE_MAPPING"))) {
            String id = expected.get(0), segment = expected.get(1);
            var result = result(response, id);
            assertThat(result.get("type").asString()).isEqualTo(expected.get(2));
            assertThat(result.get("action").asString()).isEqualTo("CREATED");
            assertThat(result.get("status").asString()).isEqualTo("SUCCESS");
            assertThat(result.get("grade").asString()).isEqualTo("SUCCESS");
            assertThat(result.get("configurations")).isEmpty();
            dev.verify(1, getRequestedFor(urlEqualTo(entity(segment, id) + "/$value")));
            prd.verify(1, postRequestedFor(urlEqualTo(collection(segment)))
                    .withHeader("X-CSRF-Token", equalTo("dummy-prd-csrf-0001"))
                    .withRequestBody(equalToJson("{\"Name\":\"Name " + id + "\",\"Id\":\"" + id
                            + "\",\"PackageId\":\"PKG\",\"ArtifactContent\":\"" + b64("src-" + id) + "\"}")));
        }
        assertThat(response.at("/summary/total").asInt()).isEqualTo(3);
        dev.verify(0, getRequestedFor(urlMatching(".*/Configurations.*")));
        dev.verify(0, getRequestedFor(urlEqualTo(entity(IF, "F1") + "/$value")));
        prd.verify(0, putRequestedFor(urlMatching(".*")));
        prd.verify(0, deleteRequestedFor(urlMatching(".*")));
    }

    @Test
    @DisplayName("REQ-1004: 대상에 있는 스크립트 컬렉션·메시지 매핑은 PUT 한 건에 {ArtifactContent}만 보내 UPDATED")
    void updatesExistingScriptsAndMappings() throws Exception {
        targetExists(SC, "SC1");
        targetExists(MM, "MM1");
        var response = transport("{\"packageId\":\"PKG\",\"artifactIds\":[],\"scriptCollectionIds\":[\"SC1\"],"
                + "\"messageMappingIds\":[\"MM1\"],\"valueMappingIds\":[]}");
        assertThat(response.get("results")).hasSize(2);
        for (var expected : List.of(List.of("SC1", SC), List.of("MM1", MM))) {
            String id = expected.get(0), segment = expected.get(1);
            assertThat(result(response, id).get("action").asString()).isEqualTo("UPDATED");
            prd.verify(1, putRequestedFor(urlEqualTo(entity(segment, id)))
                    .withRequestBody(equalToJson("{\"ArtifactContent\":\"" + b64("src-" + id) + "\"}")));
            prd.verify(0, postRequestedFor(urlEqualTo(collection(segment))));
        }
        prd.verify(0, deleteRequestedFor(urlMatching(".*")));
        prd.verify(0, getRequestedFor(urlMatching(".*/\\$value")));
    }

    @Test
    @DisplayName("REQ-1004: 대상에 있는 밸류 매핑은 대상 zip을 받아 둔 뒤 DELETE → POST(원본 zip) 순서로 바꾸고 REPLACED")
    void replacesExistingValueMapping() throws Exception {
        targetExists(VM, "VM1");
        var response = transport("{\"packageId\":\"PKG\",\"artifactIds\":[],\"valueMappingIds\":[\"VM1\"]}");
        var result = result(response, "VM1");
        assertThat(result.get("action").asString()).isEqualTo("REPLACED");
        assertThat(result.get("status").asString()).isEqualTo("SUCCESS");
        assertThat(result.get("type").asString()).isEqualTo("VALUE_MAPPING");
        var writes = prdRequests().stream().filter(r -> r.contains("ValueMappingDesigntimeArtifacts")
                && !r.equals("GET " + entity(VM, "VM1"))).toList();
        assertThat(writes).containsExactly("GET " + entity(VM, "VM1") + "/$value", "DELETE " + entity(VM, "VM1"),
                "POST " + collection(VM));
        prd.verify(1, postRequestedFor(urlEqualTo(collection(VM))).withRequestBody(equalToJson(
                "{\"Name\":\"Name VM1\",\"Id\":\"VM1\",\"PackageId\":\"PKG\",\"ArtifactContent\":\"" + b64("src-VM1") + "\"}")));
        prd.verify(0, putRequestedFor(urlMatching(".*")));
    }

    @ParameterizedTest(name = "{displayName} [{index}] 첫 POST {0}")
    @CsvSource({"500, RETRYABLE", "400, FIX_REQUIRED"})
    @DisplayName("REQ-1004 실패: 밸류 매핑 DELETE 뒤 POST가 실패하고 되살리기 POST(받아 둔 zip)가 성공하면 UPLOAD_FAILED, 문구에 되살림, 등급은 첫 POST 상태로")
    void restoresValueMappingAfterFailedCreate(int status, String grade) throws Exception {
        targetExists(VM, "VM1");
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(collection(VM)))
                .withRequestBody(matchingJsonPath("$.ArtifactContent", equalTo(b64("src-VM1"))))
                .willReturn(aResponse().withStatus(status)));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(collection(VM)))
                .withRequestBody(matchingJsonPath("$.ArtifactContent", equalTo(b64("tgt-VM1"))))
                .willReturn(created()));
        var result = result(transport("{\"packageId\":\"PKG\",\"artifactIds\":[],\"valueMappingIds\":[\"VM1\"]}"), "VM1");
        assertThat(result.get("status").asString()).isEqualTo("FAILED");
        assertThat(result.at("/error/code").asString()).isEqualTo("UPLOAD_FAILED");
        assertThat(result.at("/error/message").asString()).contains("이전 버전으로 되살렸습니다");
        assertThat(result.get("grade").asString()).isEqualTo(grade);
        prd.verify(1, deleteRequestedFor(urlEqualTo(entity(VM, "VM1"))));
        prd.verify(1, postRequestedFor(urlEqualTo(collection(VM)))
                .withRequestBody(matchingJsonPath("$.Id", equalTo("VM1")))
                .withRequestBody(matchingJsonPath("$.PackageId", equalTo("PKG")))
                .withRequestBody(matchingJsonPath("$.ArtifactContent", equalTo(b64("tgt-VM1")))));
    }

    @Test
    @DisplayName("REQ-1004 실패: 되살리기 POST도 실패하면 VALUE_MAPPING_LOST(고쳐야 함), 정해진 문구, 실행 로그에 그 Id")
    void reportsLostValueMapping(CapturedOutput output) throws Exception {
        targetExists(VM, "VM1");
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(collection(VM)))
                .willReturn(aResponse().withStatus(500)));
        var result = result(transport("{\"packageId\":\"PKG\",\"artifactIds\":[],\"valueMappingIds\":[\"VM1\"]}"), "VM1");
        assertThat(result.at("/error/code").asString()).isEqualTo("VALUE_MAPPING_LOST");
        assertThat(result.at("/error/message").asString()).isEqualTo(LOST);
        assertThat(result.get("grade").asString()).isEqualTo("FIX_REQUIRED");
        prd.verify(1, deleteRequestedFor(urlEqualTo(entity(VM, "VM1"))));
        prd.verify(moreThanOrExactly(1), postRequestedFor(urlEqualTo(collection(VM)))
                .withRequestBody(matchingJsonPath("$.ArtifactContent", equalTo(b64("tgt-VM1")))));
        assertThat(output.getAll().lines().filter(line -> line.contains("VM1") && line.contains("VALUE_MAPPING_LOST")))
                .isNotEmpty();
    }

    @ParameterizedTest(name = "{displayName} [{index}] {0}")
    @CsvSource({"DOWNLOAD_500, RETRYABLE", "DOWNLOAD_403, FIX_REQUIRED", "DELETE_404, FIX_REQUIRED", "DELETE_500, RETRYABLE"})
    @DisplayName("REQ-1004 실패: 밸류 매핑의 대상 zip 내려받기 또는 DELETE가 실패하면 UPLOAD_FAILED이고 대상은 그대로(POST 없음)")
    void valueMappingBackupOrDeleteFails(String scenario, String grade) throws Exception {
        targetExists(VM, "VM1");
        int status = Integer.parseInt(scenario.substring(scenario.indexOf('_') + 1));
        if (scenario.startsWith("DOWNLOAD")) {
            prd.stubFor(get(urlEqualTo(entity(VM, "VM1") + "/$value")).willReturn(aResponse().withStatus(status)));
        } else {
            prd.stubFor(delete(urlEqualTo(entity(VM, "VM1"))).willReturn(aResponse().withStatus(status)));
        }
        var result = result(transport("{\"packageId\":\"PKG\",\"artifactIds\":[],\"valueMappingIds\":[\"VM1\"]}"), "VM1");
        assertThat(result.at("/error/code").asString()).isEqualTo("UPLOAD_FAILED");
        assertThat(result.get("grade").asString()).isEqualTo(grade);
        assertThat(result.at("/error/message").asString()).doesNotContain("되살렸습니다");
        prd.verify(0, postRequestedFor(urlEqualTo(collection(VM))));
        if (scenario.startsWith("DOWNLOAD")) prd.verify(0, deleteRequestedFor(urlMatching(".*")));
    }

    @ParameterizedTest(name = "{displayName} [{index}] PUT {0}")
    @CsvSource({"400, FIX_REQUIRED", "409, FIX_REQUIRED", "503, RETRYABLE", "429, RETRYABLE"})
    @DisplayName("REQ-1004 실패: 스크립트 컬렉션·메시지 매핑 PUT이 실패하면 UPLOAD_FAILED이고 지우거나 다시 만들지 않는다")
    void updateFailureDoesNotRecreate(int status, String grade) throws Exception {
        targetExists(SC, "SC1");
        targetExists(MM, "MM1");
        prd.stubFor(put(urlMatching(ROOT + "/.*DesigntimeArtifacts\\(.*")).willReturn(aResponse().withStatus(status)));
        var response = transport("{\"packageId\":\"PKG\",\"artifactIds\":[],\"scriptCollectionIds\":[\"SC1\"],\"messageMappingIds\":[\"MM1\"]}");
        for (String id : List.of("SC1", "MM1")) {
            var result = result(response, id);
            assertThat(result.at("/error/code").asString()).isEqualTo("UPLOAD_FAILED");
            assertThat(result.get("grade").asString()).isEqualTo(grade);
        }
        prd.verify(0, deleteRequestedFor(urlMatching(".*")));
        prd.verify(0, postRequestedFor(urlMatching(ROOT + "/.*DesigntimeArtifacts")));
    }

    @Test
    @DisplayName("REQ-1004: DELETE에도 CSRF 토큰을 붙이고, 403 CSRF Required면 토큰을 새로 받아 한 번 다시 보낸다")
    void deleteRefreshesCsrfOnce() throws Exception {
        targetExists(VM, "VM1");
        prd.stubFor(delete(urlEqualTo(entity(VM, "VM1"))).inScenario("csrf").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required")).willSetStateTo("refreshed"));
        prd.stubFor(delete(urlEqualTo(entity(VM, "VM1"))).inScenario("csrf").whenScenarioStateIs("refreshed")
                .willReturn(noContent()));
        var result = result(transport("{\"packageId\":\"PKG\",\"artifactIds\":[],\"valueMappingIds\":[\"VM1\"]}"), "VM1");
        assertThat(result.get("action").asString()).isEqualTo("REPLACED");
        prd.verify(2, deleteRequestedFor(urlEqualTo(entity(VM, "VM1"))).withHeader("X-CSRF-Token", equalTo("dummy-prd-csrf-0001")));
        prd.verify(2, getRequestedFor(urlEqualTo(ROOT + "/")).withHeader("X-CSRF-Token", equalTo("Fetch")));
    }

    @Test
    @DisplayName("REQ-1004: 미리보기는 원본 내려받기와 대상 확인까지만 하고 쓰지 않으며 예상 action(CREATED·UPDATED·REPLACED)을 보인다")
    void previewDoesNotWrite() throws Exception {
        targetExists(SC, "SC1");
        targetExists(VM, "VM1");
        var response = transport("{\"packageId\":\"PKG\",\"dryRun\":true,\"artifactIds\":[],\"scriptCollectionIds\":[\"SC1\"],"
                + "\"messageMappingIds\":[\"MM1\"],\"valueMappingIds\":[\"VM1\"]}");
        assertThat(result(response, "SC1").get("action").asString()).isEqualTo("UPDATED");
        assertThat(result(response, "MM1").get("action").asString()).isEqualTo("CREATED");
        assertThat(result(response, "VM1").get("action").asString()).isEqualTo("REPLACED");
        for (String id : List.of("SC1", "MM1", "VM1")) {
            assertThat(result(response, id).get("status").asString()).isEqualTo("SUCCESS");
            assertThat(result(response, id).get("configurations")).isEmpty();
        }
        dev.verify(1, getRequestedFor(urlEqualTo(entity(SC, "SC1") + "/$value")));
        dev.verify(1, getRequestedFor(urlEqualTo(entity(VM, "VM1") + "/$value")));
        prd.verify(0, postRequestedFor(urlMatching(ROOT + "/.*")));
        prd.verify(0, putRequestedFor(urlMatching(".*")));
        prd.verify(0, deleteRequestedFor(urlMatching(".*")));
        prd.verify(0, getRequestedFor(urlMatching(".*/\\$value")));
    }

    // ---- REQ-1003 요청과 결과 ----

    @ParameterizedTest(name = "{displayName} [{index}]")
    @ValueSource(strings = {
            "{\"packageId\":\"PKG\",\"scriptCollectionIds\":\"SC1\"}",
            "{\"packageId\":\"PKG\",\"scriptCollectionIds\":{}}",
            "{\"packageId\":\"PKG\",\"messageMappingIds\":[1]}",
            "{\"packageId\":\"PKG\",\"messageMappingIds\":[null]}",
            "{\"packageId\":\"PKG\",\"valueMappingIds\":[\"\"]}",
            "{\"packageId\":\"PKG\",\"valueMappingIds\":[\"VM1\",\"VM1\"]}",
            "{\"packageId\":\"PKG\",\"dryRun\":true,\"scriptCollectionIds\":[\"SC1\",\"SC1\"]}",
            "{\"packages\":[{\"packageId\":\"PKG\",\"messageMappingIds\":[\"MM1\",\"MM1\"]}]}"
    })
    @DisplayName("REQ-1003 실패: 새 종류 Id 목록이 배열이 아니거나 요소가 문자열이 아니거나 비었거나 같은 종류에서 중복이면 400이고 CPI를 부르지 않는다")
    void rejectsInvalidObjectIds(String body) throws Exception {
        mvc.perform(post("/transport").contentType("application/json").content(body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
        assertThat(dev.getAllServeEvents()).isEmpty();
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-1003 실패: 고른 새 종류 아티팩트가 원본 목록에 없으면 그 결과는 ARTIFACT_NOT_FOUND(고쳐야 함)")
    void missingSourceObject() throws Exception {
        var result = result(transport("{\"packageId\":\"PKG\",\"artifactIds\":[],\"scriptCollectionIds\":[\"GHOST\"]}"), "GHOST");
        assertThat(result.get("type").asString()).isEqualTo("SCRIPT_COLLECTION");
        assertThat(result.at("/error/code").asString()).isEqualTo("ARTIFACT_NOT_FOUND");
        assertThat(result.get("grade").asString()).isEqualTo("FIX_REQUIRED");
        dev.verify(0, getRequestedFor(urlMatching(".*GHOST.*")));
        prd.verify(0, postRequestedFor(urlMatching(ROOT + "/.*DesigntimeArtifacts")));
    }

    @ParameterizedTest(name = "{displayName} [{index}]")
    @ValueSource(strings = {"{\"packageId\":\"PKG\"}", "{\"packageId\":\"PKG\",\"artifactIds\":[]}"})
    @DisplayName("REQ-1003: 새 종류 Id 목록이 없으면 그 종류는 옮기지 않고(목록 조회도 없음) artifactIds 없음·[]은 지금처럼 iFlow 전부")
    void absentObjectListsKeepIflowBehaviour(String body) throws Exception {
        var response = transport(body);
        assertThat(response.get("results")).hasSize(1);
        assertThat(result(response, "F1").get("type").asString()).isEqualTo("INTEGRATION_FLOW");
        dev.verify(0, getRequestedFor(urlMatching(".*/(ScriptCollection|MessageMapping|ValueMapping)DesigntimeArtifacts.*")));
        prd.verify(0, getRequestedFor(urlMatching(".*/(ScriptCollection|MessageMapping|ValueMapping)DesigntimeArtifacts.*")));
    }

    @Test
    @DisplayName("REQ-1003: 새 종류 Id 목록이 하나라도 있으면 artifactIds []는 iFlow 0개, artifactIds가 없으면 iFlow 전부")
    void emptyIflowListWithObjectLists() throws Exception {
        var none = transport("{\"packageId\":\"PKG\",\"artifactIds\":[],\"messageMappingIds\":[\"MM1\"]}");
        assertThat(none.get("results")).extracting(r -> r.get("artifactId").asString()).containsExactly("MM1");
        dev.verify(0, getRequestedFor(urlEqualTo(entity(IF, "F1") + "/$value")));
        var all = transport("{\"packageId\":\"PKG\",\"messageMappingIds\":[\"MM1\"]}");
        assertThat(all.get("results")).extracting(r -> r.get("artifactId").asString()).containsExactlyInAnyOrder("MM1", "F1");
    }

    @Test
    @DisplayName("REQ-1003: 결과 순서는 처리 단계(①스크립트 컬렉션·메시지 매핑 ②밸류 매핑 ③iFlow), 단계 안에서는 패키지·요청 순서")
    void resultsInStageOrder() throws Exception {
        sourcePackage("PK2", Map.of(IF, List.of("F2"), SC, List.of("SC3"), MM, List.of(), VM, List.of("VM3")));
        var response = transport("{\"packages\":["
                + "{\"packageId\":\"PKG\",\"artifactIds\":[\"F1\"],\"scriptCollectionIds\":[\"SC2\",\"SC1\"],"
                + "\"messageMappingIds\":[\"MM1\"],\"valueMappingIds\":[\"VM2\",\"VM1\"]},"
                + "{\"packageId\":\"PK2\",\"artifactIds\":[\"F2\"],\"scriptCollectionIds\":[\"SC3\"],"
                + "\"messageMappingIds\":[],\"valueMappingIds\":[\"VM3\"]}]}");
        var order = new ArrayList<String>();
        for (var result : response.get("results")) {
            order.add(result.get("packageId").asString() + ":" + result.get("type").asString() + ":" + result.get("artifactId").asString());
        }
        assertThat(order).hasSize(9);
        var stageOne = order.subList(0, 4);
        assertThat(stageOne).containsExactlyInAnyOrder("PKG:SCRIPT_COLLECTION:SC2", "PKG:SCRIPT_COLLECTION:SC1",
                "PKG:MESSAGE_MAPPING:MM1", "PK2:SCRIPT_COLLECTION:SC3");
        assertThat(stageOne.indexOf("PKG:SCRIPT_COLLECTION:SC2")).isLessThan(stageOne.indexOf("PKG:SCRIPT_COLLECTION:SC1"));
        assertThat(stageOne.getLast()).isEqualTo("PK2:SCRIPT_COLLECTION:SC3");
        assertThat(order.subList(4, 7)).containsExactly("PKG:VALUE_MAPPING:VM2", "PKG:VALUE_MAPPING:VM1", "PK2:VALUE_MAPPING:VM3");
        assertThat(order.subList(7, 9)).containsExactly("PKG:INTEGRATION_FLOW:F1", "PK2:INTEGRATION_FLOW:F2");
        assertThat(response.at("/summary/total").asInt()).isEqualTo(9);
        assertThat(response.at("/summary/succeeded").asInt()).isEqualTo(9);
    }

    @Test
    @DisplayName("REQ-1003: 새 이력 줄의 결과에 type이 있다")
    void newHistoryLineHasType() throws Exception {
        transport("{\"packageId\":\"PKG\",\"scriptCollectionIds\":[\"SC1\"]}");
        var line = json.readTree(Files.readAllLines(temporary.resolve("history.jsonl"), StandardCharsets.UTF_8).getFirst());
        var types = new ArrayList<String>();
        for (var result : line.get("results")) types.add(result.get("artifactId").asString() + ":" + result.get("type").asString());
        assertThat(types).containsExactly("SC1:SCRIPT_COLLECTION", "F1:INTEGRATION_FLOW");
    }

    @Test
    @DisplayName("REQ-1003 실패: 이 변경 전 이력 줄(결과·skipped에 type 없음)은 모두 iFlow로 읽힌다")
    void oldHistoryLineIsIflow() throws Exception {
        String old = "{\"transportId\":\"t-old\",\"packages\":[{\"packageId\":\"PKG\",\"packageName\":null,\"targetPackage\":\"EXISTING\"}],"
                + "\"dryRun\":false,\"deploy\":false,\"startedAt\":\"2026-11-01T00:00:00Z\",\"finishedAt\":\"2026-11-01T00:00:05Z\","
                + "\"summary\":{\"total\":1,\"succeeded\":1,\"failed\":0,\"fixRequired\":0,\"retryable\":0,\"skipped\":1},\"results\":["
                + "{\"packageId\":\"PKG\",\"artifactId\":\"A\",\"status\":\"SUCCESS\",\"action\":\"UPDATED\",\"configurations\":[],"
                + "\"deployStatus\":\"NOT_REQUESTED\",\"error\":null,\"grade\":\"SUCCESS\"}],"
                + "\"jobStatus\":\"CANCELLED\",\"skipped\":[{\"packageId\":\"PKG\",\"artifactId\":\"B\"}]}";
        Files.writeString(temporary.resolve("history.jsonl"), old + "\n", StandardCharsets.UTF_8);
        var entries = new TransportHistoryStore(settings, json).findAll();
        assertThat(entries).hasSize(1);
        var written = json.readTree(json.writeValueAsString(entries.getFirst()));
        assertThat(written.at("/results/0/type").asString()).isEqualTo("INTEGRATION_FLOW");
        assertThat(written.at("/skipped/0/type").asString()).isEqualTo("INTEGRATION_FLOW");
        var api = json.readTree(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/transport/history"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
        assertThat(api.at("/0/results/0/type").asString()).isEqualTo("INTEGRATION_FLOW");
        assertThat(api.at("/0/skipped/0/type").asString()).isEqualTo("INTEGRATION_FLOW");
    }
}
