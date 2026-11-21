package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.job.TransportRun;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.stub.RuntimeListStub;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.stubbing.ServeEvent;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;

/**
 * 20261121-perf-retry S3.
 * REQ-903 한 iFlow 안 동시 읽기: 내려받기와 구성 값 읽기를 동시에 시작하고, 진행 단계는 DOWNLOAD 하나로 보인다.
 * REQ-904 배포 일괄 상태 조회: 배포 요청 뒤 자리를 비우고, 작업마다 하나의 조회가 간격마다 런타임 목록을 한 번 읽어 판정한다.
 * REQ-909 배포: 단건 상태 조회(IntegrationRuntimeArtifacts('<id>'))는 0번.
 * 실제 시계·실제 대기(짧은 간격)를 쓴다. WireMock dev(원본)·prd(대상)와 더미 자격증명만 쓴다.
 */
@ExtendWith(OutputCaptureExtension.class)
class BatchDeployWireMockTests {
    private static final String PACKAGE = "/api/v1/IntegrationPackages('PKG')";
    private static final String COLLECTION = "/api/v1/IntegrationDesigntimeArtifacts";
    private static final List<String> IDS = List.of("A", "B", "C", "D");
    private WireMockServer dev, prd;
    private final JsonMapper json = JsonMapper.builder().build();
    private final Clock clock = Clock.systemUTC();
    @TempDir Path temporary;

    @BeforeEach
    void setUp() throws Exception {
        dev = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        prd = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        dev.start();
        prd.start();
        dev.stubFor(post(urlEqualTo("/token")).willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(post(urlEqualTo("/token")).willReturn(okJson("{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(get(urlEqualTo("/api/v1/")).willReturn(ok().withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
        for (var server : List.of(dev, prd)) {
            server.stubFor(get(urlEqualTo(PACKAGE)).willReturn(okJson("{\"d\":{\"Id\":\"PKG\",\"Name\":\"Package\",\"Version\":\"1.0\"}}")));
        }
        var listed = new StringJoiner(",");
        for (String id : IDS) listed.add("{\"Id\":\"" + id + "\",\"Name\":\"Name " + id + "\",\"Version\":\"1.0\"}");
        dev.stubFor(get(urlEqualTo(PACKAGE + "/IntegrationDesigntimeArtifacts")).willReturn(okJson("{\"d\":{\"results\":[" + listed + "]}}")));
        for (String id : IDS) {
            dev.stubFor(get(urlEqualTo(path(id) + "/$value")).willReturn(ok().withBody(zip())));
            dev.stubFor(get(urlEqualTo(path(id) + "/Configurations"))
                    .willReturn(okJson("{\"d\":{\"results\":[{\"ParameterKey\":\"Endpoint\",\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"}]}}")));
            prd.stubFor(get(urlEqualTo(path(id))).willReturn(okJson("{\"d\":{\"Id\":\"" + id + "\"}}")));
            prd.stubFor(put(urlEqualTo(path(id))).willReturn(noContent()));
            prd.stubFor(post(urlEqualTo(deploy(id))).willReturn(noContent()));
            // 단건 상태 조회를 부르면 안 된다(REQ-909). 불렸는지는 아래에서 센다.
            prd.stubFor(get(urlEqualTo(runtime(id))).willReturn(okJson("{\"d\":{\"Status\":\"STARTED\"}}")));
        }
    }

    @AfterEach void tearDown() { if (dev != null) dev.stop(); if (prd != null) prd.stop(); }

    // ---- REQ-904 / REQ-909 ----

    @Test
    @DisplayName("REQ-904·REQ-909: with concurrency 1 the next iFlow starts before the first is judged, one list read judges many and no single status read is made")
    void req904_slotFreedAndOneListPerRound() {
        RuntimeListStub.stub(prd, "STARTED", IDS.toArray(String[]::new));
        long begin = System.nanoTime();
        var response = run(service(Duration.ofSeconds(1), Duration.ofSeconds(10), 1), true, IDS);
        long elapsedMillis = (System.nanoTime() - begin) / 1_000_000;

        assertThat(response.results()).extracting(ArtifactResult::artifactId, ArtifactResult::deployStatus, ArtifactResult::status)
                .containsExactly(IDS.stream().map(id -> tuple(id, DeployStatus.STARTED, ArtifactStatus.SUCCESS)).toArray(org.assertj.core.groups.Tuple[]::new));
        for (String id : IDS) {
            prd.verify(1, postRequestedFor(urlEqualTo(deploy(id))));
            prd.verify(0, getRequestedFor(urlEqualTo(runtime(id))));
        }
        int lists = prd.findAll(getRequestedFor(urlPathEqualTo(RuntimeListStub.PATH))).size();
        assertThat(lists).as("list reads are per round, not per iFlow").isBetween(1, 3);
        // 자리 비움: A의 판정(첫 목록 조회)보다 B의 내려받기가 먼저다.
        var firstList = earliest(prd, getRequestedFor(urlPathEqualTo(RuntimeListStub.PATH)));
        var downloadB = earliest(dev, getRequestedFor(urlEqualTo(path("B") + "/$value")));
        assertThat(downloadB).isBefore(firstList);
        // 순차로 iFlow마다 1초 이상 기다리던 때(4초 이상)보다 짧다.
        assertThat(elapsedMillis).isLessThan(3500);
    }

    @Test
    @DisplayName("REQ-909: four iFlows, concurrency 1, runtime STARTED from the second read: list reads equal the wait rounds (2) and no single status read")
    void req909_listReadsEqualRounds() {
        var starting = RuntimeListStub.of("A", "STARTING", "B", "STARTING", "C", "STARTING", "D", "STARTING");
        var started = RuntimeListStub.of("A", "STARTED", "B", "STARTED", "C", "STARTED", "D", "STARTED");
        prd.stubFor(RuntimeListStub.list().inScenario("rounds").whenScenarioStateIs("Started").willSetStateTo("second")
                .willReturn(okJson(RuntimeListStub.body(starting))));
        prd.stubFor(RuntimeListStub.list().inScenario("rounds").whenScenarioStateIs("second")
                .willReturn(okJson(RuntimeListStub.body(started))));
        var response = run(service(Duration.ofSeconds(1), Duration.ofSeconds(10), 1), true, IDS);
        assertThat(response.results()).extracting(ArtifactResult::deployStatus).containsOnly(DeployStatus.STARTED);
        prd.verify(2, getRequestedFor(urlPathEqualTo(RuntimeListStub.PATH)));
        for (String id : IDS) prd.verify(0, getRequestedFor(urlEqualTo(runtime(id))));
    }

    @Test
    @DisplayName("REQ-904: progress done counts only iFlows whose deployment is judged; waiting iFlows stay in DEPLOY and are not counted")
    void req904_doneCountsJudgedOnly() throws Exception {
        RuntimeListStub.stub(prd, Map.of());
        var service = service(Duration.ofMillis(200), Duration.ofSeconds(20), 1);
        var prepared = service.prepare(new TransportRequest(List.of(new PackageSelection("PKG", List.of("A", "B"))), List.of(), false, true,
                new TenantRef("DEV", "DEV"), new TenantRef("PRD", "PRD")));
        var run = prepared.newRun(null, null);
        var finished = CompletableFuture.supplyAsync(() -> prepared.execute(run));
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (prd.findAll(postRequestedFor(urlEqualTo(deploy("B")))).isEmpty()
                || prd.findAll(getRequestedFor(urlPathEqualTo(RuntimeListStub.PATH))).size() < 2) {
            if (System.nanoTime() > deadline) fail("B was not deployed or the list was not read");
            Thread.sleep(10);
        }
        var waiting = run.snapshot();
        assertThat(waiting.total()).isEqualTo(2);
        assertThat(waiting.done()).isZero();
        assertThat(waiting.items()).extracting(TransportRun.Item::stage).containsOnly(TransportService.Stage.DEPLOY);
        RuntimeListStub.stub(prd, "STARTED", "A", "B");
        finished.get(30, TimeUnit.SECONDS);
        assertThat(run.snapshot().done()).isEqualTo(2);
    }

    @Test
    @DisplayName("REQ-904: the timeout is measured per iFlow from its deploy request; an iFlow missing from the list ends DEPLOY_TIMEOUT while others start")
    void req904_timeoutPerIflow() {
        RuntimeListStub.stub(prd, RuntimeListStub.of("B", "STARTED"));
        var response = run(service(Duration.ofMillis(300), Duration.ofMillis(1200), 2), true, List.of("A", "B"));
        var a = response.results().get(0);
        var b = response.results().get(1);
        assertThat(a.deployStatus()).isEqualTo(DeployStatus.TIMEOUT);
        assertThat(a.error().code()).isEqualTo("DEPLOY_TIMEOUT");
        assertThat(a.grade()).isEqualTo(ArtifactGrade.RETRYABLE);
        assertThat(b.deployStatus()).isEqualTo(DeployStatus.STARTED);
        prd.verify(0, getRequestedFor(urlEqualTo(runtime("A"))));
    }

    @Test
    @DisplayName("REQ-904: a runtime ERROR in the list fails that iFlow with the masked ErrorInformation detail fetched once")
    void req904_errorFetchesDetailOnce() {
        RuntimeListStub.stub(prd, RuntimeListStub.of("A", "ERROR", "B", "STARTED"));
        prd.stubFor(get(urlEqualTo(runtime("A") + "/ErrorInformation/$value"))
                .willReturn(aResponse().withStatus(200).withHeader("Content-Type", "text/plain").withBody("test-dummy-runtime-error")));
        var response = run(service(Duration.ofMillis(300), Duration.ofSeconds(5), 2), true, List.of("A", "B"));
        var a = response.results().get(0);
        assertThat(a.deployStatus()).isEqualTo(DeployStatus.ERROR);
        assertThat(a.error().code()).isEqualTo("DEPLOY_FAILED");
        assertThat(a.error().detail()).isEqualTo("test-dummy-runtime-error");
        assertThat(a.grade()).isEqualTo(ArtifactGrade.FIX_REQUIRED);
        assertThat(response.results().get(1).deployStatus()).isEqualTo(DeployStatus.STARTED);
        prd.verify(1, getRequestedFor(urlEqualTo(runtime("A") + "/ErrorInformation/$value")));
        prd.verify(0, getRequestedFor(urlEqualTo(runtime("B") + "/ErrorInformation/$value")));
    }

    @Test
    @DisplayName("REQ-904 failure: three consecutive list failures end every waiting iFlow DEPLOY_FAILED (ERROR, retryable) and stop polling")
    void req904_threeListFailures(CapturedOutput output) {
        prd.stubFor(RuntimeListStub.list().willReturn(serverError()));
        var response = run(service(Duration.ofMillis(500), Duration.ofSeconds(10), 2), true, List.of("A", "B"));
        for (var result : response.results()) {
            assertThat(result.deployStatus()).isEqualTo(DeployStatus.ERROR);
            assertThat(result.error().code()).isEqualTo("DEPLOY_FAILED");
            assertThat(result.grade()).isEqualTo(ArtifactGrade.RETRYABLE);
            assertThat(result.action()).isEqualTo(TransportAction.UPDATED);
        }
        prd.verify(3, getRequestedFor(urlPathEqualTo(RuntimeListStub.PATH)));
        prd.verify(0, getRequestedFor(urlPathMatching(".*ErrorInformation.*")));
        assertThat(output.getAll()).contains("artifactId=A step=DEPLOY phase=END result=FAILED deployFailure=CALL_FAILED");
    }

    @Test
    @DisplayName("REQ-904: one or two list failures are retried at the next interval and the iFlows still start")
    void req904_transientListFailures() {
        prd.stubFor(RuntimeListStub.list().inScenario("list").whenScenarioStateIs("Started").willSetStateTo("one").willReturn(serverError()));
        prd.stubFor(RuntimeListStub.list().inScenario("list").whenScenarioStateIs("one").willSetStateTo("two").willReturn(serverError()));
        prd.stubFor(RuntimeListStub.list().inScenario("list").whenScenarioStateIs("two")
                .willReturn(okJson(RuntimeListStub.body(RuntimeListStub.of("A", "STARTED", "B", "STARTED")))));
        var response = run(service(Duration.ofMillis(300), Duration.ofSeconds(10), 2), true, List.of("A", "B"));
        assertThat(response.results()).extracting(ArtifactResult::deployStatus).containsOnly(DeployStatus.STARTED);
        prd.verify(3, getRequestedFor(urlPathEqualTo(RuntimeListStub.PATH)));
    }

    @Test
    @DisplayName("REQ-904 failure: cancelling while iFlows wait for deployment lets every requested deployment be judged and skips only iFlows not started")
    void req904_cancelDuringDeployWait() throws Exception {
        RuntimeListStub.stub(prd, "STARTED", IDS.toArray(String[]::new));
        for (String id : List.of("B", "C", "D")) {
            dev.stubFor(get(urlEqualTo(path(id) + "/$value")).willReturn(ok().withBody(zip()).withFixedDelay(400)));
        }
        var service = service(Duration.ofMillis(700), Duration.ofSeconds(10), 1);
        var prepared = service.prepare(new TransportRequest(List.of(new PackageSelection("PKG", IDS)), List.of(), false, true,
                new TenantRef("DEV", "DEV"), new TenantRef("PRD", "PRD")));
        var run = prepared.newRun(null, null);
        var finished = CompletableFuture.supplyAsync(() -> prepared.execute(run));
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (prd.findAll(postRequestedFor(urlEqualTo(deploy("A")))).isEmpty()) {
            if (System.nanoTime() > deadline) fail("A was not deployed");
            Thread.sleep(10);
        }
        run.cancel();
        finished.get(30, TimeUnit.SECONDS);
        var snapshot = run.snapshot();
        assertThat(snapshot.status()).isEqualTo(JobStatus.CANCELLED);
        assertThat(snapshot.items()).extracting(TransportRun.Item::stage).doesNotContain(TransportService.Stage.DEPLOY);
        assertThat(snapshot.items()).extracting(TransportRun.Item::stage).contains(TransportService.Stage.SKIPPED);
        for (var result : snapshot.result().results()) {
            if (!prd.findAll(postRequestedFor(urlEqualTo(deploy(result.artifactId())))).isEmpty()) {
                assertThat(result.deployStatus()).as(result.artifactId()).isEqualTo(DeployStatus.STARTED);
            }
        }
        assertThat(snapshot.result().results()).extracting(ArtifactResult::artifactId).contains("A");
    }

    // ---- REQ-903 ----

    @Test
    @DisplayName("REQ-903: download and configuration read start together for an iFlow and the execution log keeps both step lines")
    void req903_concurrentReads(CapturedOutput output) throws Exception {
        dev.stubFor(get(urlEqualTo(path("A") + "/$value")).willReturn(ok().withBody(zip()).withFixedDelay(600)));
        dev.stubFor(get(urlEqualTo(path("A") + "/Configurations")).willReturn(okJson(
                "{\"d\":{\"results\":[{\"ParameterKey\":\"Endpoint\",\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"}]}}").withFixedDelay(600)));
        long begin = System.nanoTime();
        var response = run(service(Duration.ofSeconds(1), Duration.ofSeconds(5), 1), false, List.of("A"), true);
        long elapsedMillis = (System.nanoTime() - begin) / 1_000_000;
        assertThat(response.results().getFirst().status()).isEqualTo(ArtifactStatus.SUCCESS);
        var download = earliest(dev, getRequestedFor(urlEqualTo(path("A") + "/$value")));
        var configuration = earliest(dev, getRequestedFor(urlEqualTo(path("A") + "/Configurations")));
        assertThat(Math.abs(Duration.between(download, configuration).toMillis())).isLessThan(300);
        assertThat(elapsedMillis).isLessThan(1100);
        assertThat(output.getAll()).contains("artifactId=A step=DOWNLOAD phase=START", "artifactId=A step=PARAMETER_COPY phase=START");
    }

    @Test
    @DisplayName("REQ-903: progress shows DOWNLOAD for the combined read and never CONFIGURATION_READ")
    void req903_progressStage() throws Exception {
        dev.stubFor(get(urlEqualTo(path("A") + "/$value")).willReturn(ok().withBody(zip()).withFixedDelay(500)));
        dev.stubFor(get(urlEqualTo(path("A") + "/Configurations")).willReturn(okJson(
                "{\"d\":{\"results\":[]}}").withFixedDelay(500)));
        var service = service(Duration.ofSeconds(1), Duration.ofSeconds(5), 1);
        var prepared = service.prepare(new TransportRequest(List.of(new PackageSelection("PKG", List.of("A"))), List.of(), true, false,
                new TenantRef("DEV", "DEV"), new TenantRef("PRD", "PRD")));
        var run = prepared.newRun(null, null);
        var finished = CompletableFuture.supplyAsync(() -> prepared.execute(run));
        var seen = new LinkedHashSet<TransportService.Stage>();
        while (!finished.isDone()) {
            seen.add(run.snapshot().items().getFirst().stage());
            Thread.sleep(10);
        }
        finished.get();
        assertThat(seen).contains(TransportService.Stage.DOWNLOAD).doesNotContain(TransportService.Stage.CONFIGURATION_READ);
    }

    @Test
    @DisplayName("REQ-903 failure: the first failing read decides the code, both failing reports DOWNLOAD_FAILED, and the result waits for the other read")
    void req903_failurePrecedence() throws Exception {
        var service = service(Duration.ofSeconds(1), Duration.ofSeconds(5), 1);
        // 내려받기만 실패
        dev.stubFor(get(urlEqualTo(path("A") + "/$value")).willReturn(notFound()));
        assertThat(run(service, false, List.of("A"), true).results().getFirst().error().code()).isEqualTo("DOWNLOAD_FAILED");
        // 구성 값 읽기만 실패(빨리), 내려받기는 늦게 성공 → 구성 값 코드, 내려받기가 끝날 때까지 기다림
        dev.stubFor(get(urlEqualTo(path("A") + "/$value")).willReturn(ok().withBody(zip()).withFixedDelay(600)));
        dev.stubFor(get(urlEqualTo(path("A") + "/Configurations")).willReturn(notFound()));
        long begin = System.nanoTime();
        var configFailed = run(service, false, List.of("A"), true).results().getFirst();
        assertThat(configFailed.error().code()).isEqualTo("CONFIGURATION_READ_FAILED");
        assertThat((System.nanoTime() - begin) / 1_000_000).isGreaterThanOrEqualTo(550);
        // 둘 다 실패: 구성 값이 먼저 실패해도 내려받기 코드
        dev.stubFor(get(urlEqualTo(path("A") + "/$value")).willReturn(notFound().withFixedDelay(400)));
        assertThat(run(service, false, List.of("A"), true).results().getFirst().error().code()).isEqualTo("DOWNLOAD_FAILED");
    }

    // ---- helpers ----

    private TransportService service(Duration interval, Duration timeout, int concurrency) {
        var settings = new TransportProperties(new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(1, Duration.ZERO), new TransportProperties.Deploy(interval, timeout), List.of("password"));
        var connections = new CpiProperties(connection(dev, "dev"), connection(prd, "prd"));
        Sleeper sleeper = duration -> Thread.sleep(duration.toMillis());
        var tokens = new OAuthTokenProvider(connections, settings, clock, sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(connections, tokens, new CsrfTokenStore(), settings, sleeper), json);
        return new TransportService(api, new ConfigurationCopier(api, new SensitiveKeyMatcher(settings)),
                new DeployService(api, settings, clock, sleeper), clock, () -> new ConcurrencySettings(concurrency, concurrency));
    }
    private TransportResponse run(TransportService service, boolean deploy, List<String> ids) {
        return run(service, deploy, ids, false);
    }
    private TransportResponse run(TransportService service, boolean deploy, List<String> ids, boolean dryRun) {
        var artifacts = IDS.stream().map(id -> new CpiArtifact(id, "Name " + id, "1.0")).toList();
        return service.execute(new TransportRequest("PKG", ids, dryRun, deploy), artifacts);
    }
    private static Instant earliest(WireMockServer server, com.github.tomakehurst.wiremock.matching.RequestPatternBuilder pattern) {
        return server.findAll(pattern).stream().map(r -> r.getLoggedDate().toInstant()).min(Comparator.naturalOrder())
                .orElseThrow(() -> new AssertionError("no request " + pattern.build()));
    }
    private CpiProperties.Connection connection(WireMockServer server, String env) {
        String base = "http://localhost:" + server.port();
        return new CpiProperties.Connection(base, base + "/token", "dummy-" + env + "-client", "dummy-" + env + "-secret");
    }
    private static String path(String id) { return COLLECTION + "(Id='" + id + "',Version='active')"; }
    private static String deploy(String id) { return "/api/v1/DeployIntegrationDesigntimeArtifact?Id='" + id + "'&Version='active'"; }
    private static String runtime(String id) { return "/api/v1/IntegrationRuntimeArtifacts('" + id + "')"; }
    private byte[] zip() throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry("src/main/resources/scenarioflows/integrationflow/flow.iflw"));
            zip.write("<b:definitions xmlns:b=\"http://www.omg.org/spec/BPMN/20100524/MODEL\"/>".getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        return bytes.toByteArray();
    }
}
