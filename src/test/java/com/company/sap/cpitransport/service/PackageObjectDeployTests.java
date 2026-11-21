package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.controller.ApiExceptionHandler;
import com.company.sap.cpitransport.controller.TransportController;
import com.company.sap.cpitransport.model.ConcurrencySettings;
import com.company.sap.cpitransport.stub.RuntimeListStub;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.matching.RequestPatternBuilder;
import com.github.tomakehurst.wiremock.stubbing.Scenario;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 20261121-package-objects S3: REQ-1005 처리 단계 순서와 새 종류 배포.
 * - 처리 단계 ①스크립트 컬렉션·메시지 매핑 → ②밸류 매핑 → ③iFlow. 다음 단계는 앞 단계가 모두 끝난 뒤(배포 켬이면 배포 판정까지) 시작한다.
 * - 새 종류 배포: POST /Deploy{T}DesigntimeArtifact?Id='{id}'&Version='active' → 응답 본문(텍스트)이 작업 ID →
 *   GET /BuildAndDeployStatus(TaskId='{task}')를 간격마다 읽는다. 응답 {"d":{"TaskId":..,"Status":..}}.
 *   SUCCESS → STARTED / FAIL·FAIL_ON_LICENSE_ERROR → DEPLOY_FAILED(FIX_REQUIRED) / DEPLOYING → 계속.
 * POST /transport(동기)로 확인한다. 실제 시계·짧은 간격(100ms)·실제 대기. WireMock dev·prd와 더미 자격증명만 쓴다.
 */
class PackageObjectDeployTests {
    private static final String ROOT = "/api/v1";
    private static final String SC = "ScriptCollection", MM = "MessageMapping", VM = "ValueMapping", IF = "Integration";
    private final JsonMapper json = JsonMapper.builder().build();
    private final Clock clock = Clock.systemUTC();
    private WireMockServer dev, prd;
    @TempDir Path temporary;

    @BeforeEach
    void setUp() {
        dev = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        prd = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        dev.start();
        prd.start();
        dev.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo("/token"))
                .willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo("/token"))
                .willReturn(okJson("{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(get(urlEqualTo(ROOT + "/")).withHeader("X-CSRF-Token", equalTo("Fetch"))
                .willReturn(ok().withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
        String meta = "{\"d\":{\"Id\":\"PKG\",\"Name\":\"Package PKG\",\"Version\":\"1.0.0\"}}";
        dev.stubFor(get(urlEqualTo(pkg())).willReturn(okJson(meta)));
        prd.stubFor(get(urlEqualTo(pkg())).willReturn(okJson(meta)));
        source(IF, "F1");
        source(SC, "SC1");
        source(MM, "MM1");
        source(VM, "VM1");
        dev.stubFor(get(urlEqualTo(entity(IF, "F1") + "/Configurations")).willReturn(okJson("{\"d\":{\"results\":[]}}")));
        // 대상: 아티팩트 없음 → 생성
        prd.stubFor(get(urlMatching(ROOT + "/(Integration|ScriptCollection|MessageMapping|ValueMapping)DesigntimeArtifacts\\(.*"))
                .atPriority(10).willReturn(notFound()));
        for (String segment : List.of(IF, SC, MM, VM)) {
            prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(collection(segment)))
                    .atPriority(10).willReturn(created()));
        }
        // 배포: 새 종류는 작업 ID, iFlow는 지금처럼 런타임 목록
        for (var entry : Map.of(SC, "SC1", MM, "MM1", VM, "VM1").entrySet()) {
            prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(deploy(entry.getKey(), entry.getValue())))
                    .atPriority(10).willReturn(aResponse().withStatus(202).withHeader("Content-Type", "text/plain")
                            .withBody("task-" + entry.getValue())));
            prd.stubFor(get(urlEqualTo(taskStatus("task-" + entry.getValue()))).atPriority(10)
                    .willReturn(okJson(statusBody("task-" + entry.getValue(), "SUCCESS"))));
        }
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(deploy(IF, "F1"))).willReturn(noContent()));
        RuntimeListStub.stub(prd, "STARTED", "F1");
    }

    @AfterEach void tearDown() { if (dev != null) dev.stop(); if (prd != null) prd.stop(); }

    // ---- 도우미 ----
    private static String pkg() { return ROOT + "/IntegrationPackages('PKG')"; }
    private static String collection(String segment) { return ROOT + "/" + segment + "DesigntimeArtifacts"; }
    private static String entity(String segment, String id) { return collection(segment) + "(Id='" + id + "',Version='active')"; }
    private static String deploy(String segment, String id) { return ROOT + "/Deploy" + segment + "DesigntimeArtifact?Id='" + id + "'&Version='active'"; }
    private static String taskStatus(String task) { return ROOT + "/BuildAndDeployStatus(TaskId='" + task + "')"; }
    private static String statusBody(String task, String value) {
        return "{\"d\":{\"TaskId\":\"" + task + "\",\"Status\":\"" + value + "\"}}";
    }

    private void source(String segment, String id) {
        dev.stubFor(get(urlEqualTo(pkg() + "/" + segment + "DesigntimeArtifacts")).willReturn(okJson(
                "{\"d\":{\"results\":[{\"Id\":\"" + id + "\",\"Name\":\"Name " + id + "\",\"Version\":\"1.0.0\",\"PackageId\":\"PKG\"}]}}")));
        dev.stubFor(get(urlEqualTo(entity(segment, id) + "/$value")).willReturn(ok().withBody("src-" + id)));
    }

    private MockMvc mvc(Duration interval, Duration timeout, int concurrency) {
        String devBase = "http://localhost:" + dev.port();
        String prdBase = "http://localhost:" + prd.port();
        var props = new CpiProperties(
                new CpiProperties.Connection(devBase, devBase + "/token", "dummy-dev-client", "dummy-dev-secret"),
                new CpiProperties.Connection(prdBase, prdBase + "/token", "dummy-prd-client", "dummy-prd-secret"));
        var settings = new TransportProperties(new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(1, Duration.ZERO), new TransportProperties.Deploy(interval, timeout), List.of());
        Sleeper sleeper = duration -> Thread.sleep(duration.toMillis());
        var tokens = new OAuthTokenProvider(props, settings, clock, sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(props, tokens, new CsrfTokenStore(), settings, sleeper), json);
        var service = new TransportService(api, new ConfigurationCopier(api, new SensitiveKeyMatcher(settings)),
                new DeployService(api, settings, clock, sleeper), clock, () -> new ConcurrencySettings(concurrency, concurrency));
        return MockMvcBuilders.standaloneSetup(new TransportController(service, new EnvironmentGuard(props),
                        new TransportHistoryStore(settings, json), new ReadOnlyProperties(false)))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    private MockMvc mvc() { return mvc(Duration.ofMillis(100), Duration.ofSeconds(5), 4); }

    private JsonNode transport(MockMvc mvc, String body) throws Exception {
        return json.readTree(mvc.perform(post("/transport").contentType("application/json").content(body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private static JsonNode result(JsonNode response, String id) {
        for (var item : response.get("results")) if (id.equals(item.get("artifactId").asString())) return item;
        throw new AssertionError("no result " + id + " in " + response);
    }

    private static Instant earliest(WireMockServer server, RequestPatternBuilder pattern) {
        return server.findAll(pattern).stream().map(r -> r.getLoggedDate().toInstant()).min(Comparator.naturalOrder())
                .orElseThrow(() -> new AssertionError("no request " + pattern.build()));
    }

    private static Instant latest(WireMockServer server, RequestPatternBuilder pattern) {
        return server.findAll(pattern).stream().map(r -> r.getLoggedDate().toInstant()).max(Comparator.naturalOrder())
                .orElseThrow(() -> new AssertionError("no request " + pattern.build()));
    }

    private static final String ALL_DEPLOY = "{\"packageId\":\"PKG\",\"deploy\":true,\"artifactIds\":[\"F1\"],"
            + "\"scriptCollectionIds\":[\"SC1\"],\"messageMappingIds\":[\"MM1\"],\"valueMappingIds\":[\"VM1\"]}";

    // ---- 새 종류 배포 판정 ----

    @Test
    @DisplayName("REQ-1005: 배포 켬이면 새 종류는 Deploy{T}DesigntimeArtifact를 부르고 응답 본문의 작업 ID로 BuildAndDeployStatus를 읽어 SUCCESS면 STARTED, iFlow는 지금처럼 런타임 목록")
    void deploysNewTypesByTaskStatus() throws Exception {
        var response = transport(mvc(), ALL_DEPLOY);
        for (var expected : List.of(List.of(SC, "SC1"), List.of(MM, "MM1"), List.of(VM, "VM1"))) {
            String segment = expected.get(0), id = expected.get(1);
            var result = result(response, id);
            assertThat(result.get("status").asString()).isEqualTo("SUCCESS");
            assertThat(result.get("deployStatus").asString()).isEqualTo("STARTED");
            assertThat(result.get("grade").asString()).isEqualTo("SUCCESS");
            prd.verify(1, postRequestedFor(urlEqualTo(deploy(segment, id))).withHeader("X-CSRF-Token", equalTo("dummy-prd-csrf-0001")));
            prd.verify(moreThanOrExactly(1), getRequestedFor(urlEqualTo(taskStatus("task-" + id))));
            prd.verify(0, getRequestedFor(urlEqualTo(ROOT + "/IntegrationRuntimeArtifacts('" + id + "')")));
        }
        assertThat(result(response, "F1").get("deployStatus").asString()).isEqualTo("STARTED");
        prd.verify(1, postRequestedFor(urlEqualTo(deploy(IF, "F1"))));
        prd.verify(0, getRequestedFor(urlMatching(ROOT + "/BuildAndDeployStatus.*F1.*")));
    }

    @ParameterizedTest(name = "{displayName} [{index}] {0}")
    @ValueSource(strings = {"FAIL", "FAIL_ON_LICENSE_ERROR"})
    @DisplayName("REQ-1005 실패: BuildAndDeployStatus가 FAIL·FAIL_ON_LICENSE_ERROR면 DEPLOY_FAILED(고쳐야 함)")
    void failedTaskIsFixRequired(String value) throws Exception {
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).willReturn(okJson(statusBody("task-SC1", value))));
        var result = result(transport(mvc(), "{\"packageId\":\"PKG\",\"deploy\":true,\"artifactIds\":[],\"scriptCollectionIds\":[\"SC1\"]}"), "SC1");
        assertThat(result.get("status").asString()).isEqualTo("FAILED");
        assertThat(result.at("/error/code").asString()).isEqualTo("DEPLOY_FAILED");
        assertThat(result.get("deployStatus").asString()).isEqualTo("ERROR");
        assertThat(result.get("grade").asString()).isEqualTo("FIX_REQUIRED");
        assertThat(result.get("action").asString()).isEqualTo("CREATED");
    }

    @Test
    @DisplayName("REQ-1005: DEPLOYING이면 설정 간격마다 다시 읽고 SUCCESS가 되면 성공")
    void keepsPollingWhileDeploying() throws Exception {
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).inScenario("deploying").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(okJson(statusBody("task-SC1", "DEPLOYING"))).willSetStateTo("second"));
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).inScenario("deploying").whenScenarioStateIs("second")
                .willReturn(okJson(statusBody("task-SC1", "DEPLOYING"))).willSetStateTo("done"));
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).inScenario("deploying").whenScenarioStateIs("done")
                .willReturn(okJson(statusBody("task-SC1", "SUCCESS"))));
        var result = result(transport(mvc(Duration.ofMillis(200), Duration.ofSeconds(5), 4),
                "{\"packageId\":\"PKG\",\"deploy\":true,\"artifactIds\":[],\"scriptCollectionIds\":[\"SC1\"]}"), "SC1");
        assertThat(result.get("deployStatus").asString()).isEqualTo("STARTED");
        var reads = prd.findAll(getRequestedFor(urlEqualTo(taskStatus("task-SC1")))).stream()
                .map(r -> r.getLoggedDate().toInstant()).sorted().toList();
        assertThat(reads).hasSize(3);
        var deployed = earliest(prd, postRequestedFor(urlEqualTo(deploy(SC, "SC1"))));
        // 첫 조회는 배포 요청 뒤 한 간격, 그다음도 간격마다(간격 200ms)
        assertThat(Duration.between(deployed, reads.get(0)).toMillis()).isGreaterThanOrEqualTo(150);
        assertThat(Duration.between(reads.get(0), reads.get(1)).toMillis()).isGreaterThanOrEqualTo(150);
        assertThat(Duration.between(reads.get(1), reads.get(2)).toMillis()).isGreaterThanOrEqualTo(150);
    }

    @Test
    @DisplayName("REQ-1005 실패: 배포 요청 시각부터 제한 시간을 넘으면 DEPLOY_TIMEOUT(다시 시도 가능)")
    void timesOut() throws Exception {
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).willReturn(okJson(statusBody("task-SC1", "DEPLOYING"))));
        long begin = System.nanoTime();
        var result = result(transport(mvc(Duration.ofMillis(100), Duration.ofMillis(800), 4),
                "{\"packageId\":\"PKG\",\"deploy\":true,\"artifactIds\":[],\"scriptCollectionIds\":[\"SC1\"]}"), "SC1");
        long elapsed = (System.nanoTime() - begin) / 1_000_000;
        assertThat(result.at("/error/code").asString()).isEqualTo("DEPLOY_TIMEOUT");
        assertThat(result.get("deployStatus").asString()).isEqualTo("TIMEOUT");
        assertThat(result.get("grade").asString()).isEqualTo("RETRYABLE");
        assertThat(elapsed).isBetween(700L, 4000L);
    }

    @ParameterizedTest(name = "{displayName} [{index}] {0}")
    @CsvSource({"500, RETRYABLE", "400, FIX_REQUIRED", "429, RETRYABLE"})
    @DisplayName("REQ-1005 실패: 새 종류 배포 요청이 실패하면 DEPLOY_FAILED이고 등급은 HTTP 상태로 정한다")
    void deployRequestFails(int code, String grade) throws Exception {
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(deploy(MM, "MM1")))
                .willReturn(aResponse().withStatus(code)));
        var result = result(transport(mvc(), "{\"packageId\":\"PKG\",\"deploy\":true,\"artifactIds\":[],\"messageMappingIds\":[\"MM1\"]}"), "MM1");
        assertThat(result.at("/error/code").asString()).isEqualTo("DEPLOY_FAILED");
        assertThat(result.get("grade").asString()).isEqualTo(grade);
        prd.verify(0, getRequestedFor(urlMatching(ROOT + "/BuildAndDeployStatus.*")));
    }

    @Test
    @DisplayName("REQ-1005 실패: 배포 응답 본문에 작업 ID가 없으면 DEPLOY_FAILED(다시 시도 가능)이고 상태를 읽지 않는다")
    void missingTaskId() throws Exception {
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(deploy(VM, "VM1")))
                .willReturn(aResponse().withStatus(202)));
        var result = result(transport(mvc(), "{\"packageId\":\"PKG\",\"deploy\":true,\"artifactIds\":[],\"valueMappingIds\":[\"VM1\"]}"), "VM1");
        assertThat(result.at("/error/code").asString()).isEqualTo("DEPLOY_FAILED");
        assertThat(result.get("grade").asString()).isEqualTo("RETRYABLE");
        prd.verify(0, getRequestedFor(urlMatching(ROOT + "/BuildAndDeployStatus.*")));
    }

    @Test
    @DisplayName("REQ-1005 실패: 상태 조회 1~2번 실패는 다음 간격에 다시 읽어 성공할 수 있다")
    void transientStatusFailures() throws Exception {
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).inScenario("flaky").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(aResponse().withStatus(500)).willSetStateTo("second"));
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).inScenario("flaky").whenScenarioStateIs("second")
                .willReturn(aResponse().withStatus(503)).willSetStateTo("ok"));
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).inScenario("flaky").whenScenarioStateIs("ok")
                .willReturn(okJson(statusBody("task-SC1", "SUCCESS"))));
        var result = result(transport(mvc(), "{\"packageId\":\"PKG\",\"deploy\":true,\"artifactIds\":[],\"scriptCollectionIds\":[\"SC1\"]}"), "SC1");
        assertThat(result.get("deployStatus").asString()).isEqualTo("STARTED");
        prd.verify(3, getRequestedFor(urlEqualTo(taskStatus("task-SC1"))));
    }

    @Test
    @DisplayName("REQ-1005 실패: 상태 조회가 연속 3번 실패하면 DEPLOY_FAILED(다시 시도 가능)")
    void threeStatusFailures() throws Exception {
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).willReturn(aResponse().withStatus(500)));
        var result = result(transport(mvc(), "{\"packageId\":\"PKG\",\"deploy\":true,\"artifactIds\":[],\"scriptCollectionIds\":[\"SC1\"]}"), "SC1");
        assertThat(result.at("/error/code").asString()).isEqualTo("DEPLOY_FAILED");
        assertThat(result.get("grade").asString()).isEqualTo("RETRYABLE");
        prd.verify(3, getRequestedFor(urlEqualTo(taskStatus("task-SC1"))));
    }

    @Test
    @DisplayName("REQ-1005: 미리보기는 배포 켬이어도 새 종류 배포를 부르지 않고 SKIPPED_DRY_RUN")
    void previewDoesNotDeploy() throws Exception {
        var response = transport(mvc(), "{\"packageId\":\"PKG\",\"deploy\":true,\"dryRun\":true,\"artifactIds\":[],"
                + "\"scriptCollectionIds\":[\"SC1\"],\"valueMappingIds\":[\"VM1\"]}");
        for (String id : List.of("SC1", "VM1")) {
            assertThat(result(response, id).get("deployStatus").asString()).isEqualTo("SKIPPED_DRY_RUN");
        }
        prd.verify(0, postRequestedFor(urlMatching(ROOT + "/Deploy.*")));
        prd.verify(0, getRequestedFor(urlMatching(ROOT + "/BuildAndDeployStatus.*")));
    }

    // ---- 처리 단계 순서 ----

    @Test
    @DisplayName("REQ-1005: 배포 켬이면 다음 단계는 앞 단계 아티팩트의 배포 판정이 모두 끝난 뒤 시작한다(동시 처리 4여도)")
    void stagesWaitForDeploymentJudgement() throws Exception {
        // ① 스크립트 컬렉션은 두 번 DEPLOYING 뒤 SUCCESS
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).inScenario("slow").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(okJson(statusBody("task-SC1", "DEPLOYING"))).willSetStateTo("second"));
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).inScenario("slow").whenScenarioStateIs("second")
                .willReturn(okJson(statusBody("task-SC1", "DEPLOYING"))).willSetStateTo("done"));
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).inScenario("slow").whenScenarioStateIs("done")
                .willReturn(okJson(statusBody("task-SC1", "SUCCESS"))));
        var response = transport(mvc(), ALL_DEPLOY);
        assertThat(response.at("/summary/succeeded").asInt()).isEqualTo(4);

        var stageOneJudged = latest(prd, getRequestedFor(urlMatching(ROOT + "/BuildAndDeployStatus\\(TaskId='task-(SC1|MM1)'\\)")));
        var stageTwoStarted = earliest(dev, getRequestedFor(urlEqualTo(entity(VM, "VM1") + "/$value")));
        assertThat(stageTwoStarted).isAfterOrEqualTo(stageOneJudged);
        assertThat(earliest(prd, getRequestedFor(urlEqualTo(entity(VM, "VM1"))))).isAfterOrEqualTo(stageOneJudged);

        var stageTwoJudged = latest(prd, getRequestedFor(urlEqualTo(taskStatus("task-VM1"))));
        var stageThreeStarted = earliest(dev, getRequestedFor(urlMatching(ROOT + "/IntegrationDesigntimeArtifacts\\(Id='F1'.*")));
        assertThat(stageThreeStarted).isAfterOrEqualTo(stageTwoJudged);
        // 단계 ①의 두 아티팩트는 동시 처리 설정대로 함께 시작한다(하나가 다른 것의 판정을 기다리지 않음).
        var mmDownload = earliest(dev, getRequestedFor(urlEqualTo(entity(MM, "MM1") + "/$value")));
        assertThat(mmDownload).isBefore(latest(prd, getRequestedFor(urlEqualTo(taskStatus("task-SC1")))));
    }

    @Test
    @DisplayName("REQ-1005: 배포 끔이면 다음 단계는 앞 단계 아티팩트의 쓰기가 모두 끝난 뒤 시작한다")
    void stagesWaitForWrites() throws Exception {
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(collection(SC)))
                .willReturn(created().withFixedDelay(400)));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(collection(VM)))
                .willReturn(created().withFixedDelay(400)));
        var response = transport(mvc(), ALL_DEPLOY.replace("\"deploy\":true", "\"deploy\":false"));
        assertThat(response.at("/summary/succeeded").asInt()).isEqualTo(4);
        var scWrite = earliest(prd, postRequestedFor(urlEqualTo(collection(SC))));
        var vmDownload = earliest(dev, getRequestedFor(urlEqualTo(entity(VM, "VM1") + "/$value")));
        assertThat(Duration.between(scWrite, vmDownload).toMillis()).isGreaterThanOrEqualTo(350);
        var vmWrite = earliest(prd, postRequestedFor(urlEqualTo(collection(VM))));
        var flowDownload = earliest(dev, getRequestedFor(urlEqualTo(entity(IF, "F1") + "/$value")));
        assertThat(Duration.between(vmWrite, flowDownload).toMillis()).isGreaterThanOrEqualTo(350);
    }

    @Test
    @DisplayName("REQ-1005: 앞 단계에 실패가 있어도 다음 단계는 진행한다")
    void laterStagesRunAfterFailure() throws Exception {
        prd.stubFor(get(urlEqualTo(taskStatus("task-SC1"))).willReturn(okJson(statusBody("task-SC1", "FAIL"))));
        prd.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(collection(MM))).willReturn(aResponse().withStatus(400)));
        var response = transport(mvc(), ALL_DEPLOY);
        assertThat(result(response, "SC1").at("/error/code").asString()).isEqualTo("DEPLOY_FAILED");
        assertThat(result(response, "MM1").at("/error/code").asString()).isEqualTo("UPLOAD_FAILED");
        assertThat(result(response, "VM1").get("status").asString()).isEqualTo("SUCCESS");
        assertThat(result(response, "F1").get("status").asString()).isEqualTo("SUCCESS");
        assertThat(response.at("/summary/total").asInt()).isEqualTo(4);
        assertThat(response.at("/summary/failed").asInt()).isEqualTo(2);
    }
}
