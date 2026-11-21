package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.job.TransportRun;
import com.company.sap.cpitransport.model.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.http.Fault;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.zip.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;

// 20261121-perf-retry S1, REQ-906 결과 등급: iFlow 결과마다 grade(SUCCESS / FIX_REQUIRED / RETRYABLE),
// summary에 fixRequired·retryable·skipped 수. 이 변경 전 이력 줄(grade·등급 수 없음)도 오류 없이 읽힌다.
// WireMock dev(원본)·prd(대상) 두 대와 더미 자격증명만 쓴다.
class ResultGradeWireMockTests {
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
        settings = new TransportProperties(new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of("password", "token"));
        connections = new CpiProperties(connection(dev, "dev"), connection(prd, "prd"));
        dev.stubFor(post(urlEqualTo("/token")).willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(post(urlEqualTo("/token")).willReturn(okJson("{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(get(urlEqualTo("/api/v1/")).willReturn(ok().withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
        for (var server : List.of(dev, prd)) {
            server.stubFor(get(urlEqualTo(PACKAGE)).willReturn(okJson("{\"d\":{\"Id\":\"PKG\",\"Name\":\"Package\",\"Version\":\"1.0\"}}")));
        }
        for (String id : List.of("A", "B", "C")) {
            dev.stubFor(get(urlEqualTo(path(id) + "/$value")).willReturn(ok().withBody(zip())));
            dev.stubFor(get(urlEqualTo(path(id) + "/Configurations"))
                    .willReturn(okJson("{\"d\":{\"results\":[{\"ParameterKey\":\"Endpoint\",\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"}]}}")));
            prd.stubFor(get(urlEqualTo(path(id))).willReturn(okJson("{\"d\":{\"Id\":\"" + id + "\"}}")));
            prd.stubFor(put(urlEqualTo(path(id))).willReturn(noContent()));
            prd.stubFor(post(urlEqualTo(deploy(id))).willReturn(noContent()));
            prd.stubFor(get(urlEqualTo(runtime(id))).willReturn(okJson("{\"d\":{\"Status\":\"STARTED\"}}")));
        }
        prd.stubFor(post(urlEqualTo(COLLECTION)).willReturn(created()));
    }

    @AfterEach void tearDown() { if (dev != null) dev.stop(); if (prd != null) prd.stop(); }

    @Test
    @DisplayName("REQ-906: a successful iFlow has grade SUCCESS")
    void req906_success() {
        var result = run(true, "A").results().getFirst();
        assertThat(result.status()).isEqualTo(ArtifactStatus.SUCCESS);
        assertThat(result.grade()).isEqualTo(ArtifactGrade.SUCCESS);
    }

    @ParameterizedTest(name = "{displayName} [{index}] {0}")
    @CsvSource({
            "UPLOAD_400_LOCK, UPLOAD_FAILED, FIX_REQUIRED",
            "UPLOAD_409, UPLOAD_FAILED, FIX_REQUIRED",
            "UPLOAD_500, UPLOAD_FAILED, RETRYABLE",
            "UPLOAD_408, UPLOAD_FAILED, RETRYABLE",
            "UPLOAD_429, UPLOAD_FAILED, RETRYABLE",
            "DOWNLOAD_404, DOWNLOAD_FAILED, FIX_REQUIRED",
            "DOWNLOAD_503, DOWNLOAD_FAILED, RETRYABLE",
            "DOWNLOAD_CONNECTION_RESET, DOWNLOAD_FAILED, RETRYABLE",
            "CONFIGURATION_403, CONFIGURATION_READ_FAILED, FIX_REQUIRED",
            "CONFIGURATION_502, CONFIGURATION_READ_FAILED, RETRYABLE",
            "TARGET_403, TARGET_CHECK_FAILED, FIX_REQUIRED",
            "TARGET_500, TARGET_CHECK_FAILED, RETRYABLE",
            "DEPLOY_RUNTIME_ERROR, DEPLOY_FAILED, FIX_REQUIRED",
            "DEPLOY_TIMEOUT, DEPLOY_TIMEOUT, RETRYABLE",
            "DEPLOY_STATUS_CALL_500, DEPLOY_FAILED, RETRYABLE",
            "ARTIFACT_ABSENT, ARTIFACT_NOT_FOUND, FIX_REQUIRED"
    })
    @DisplayName("REQ-906: a failed iFlow is graded FIX_REQUIRED for content errors and RETRYABLE for transient ones")
    void req906_failureGrades(String scenario, String code, ArtifactGrade grade) {
        String id = "A";
        switch (scenario) {
            case "UPLOAD_400_LOCK" -> prd.stubFor(put(urlEqualTo(path(id))).willReturn(aResponse().withStatus(400)));
            case "UPLOAD_409" -> prd.stubFor(put(urlEqualTo(path(id))).willReturn(aResponse().withStatus(409)));
            case "UPLOAD_500" -> prd.stubFor(put(urlEqualTo(path(id))).willReturn(aResponse().withStatus(500)));
            case "UPLOAD_408" -> prd.stubFor(put(urlEqualTo(path(id))).willReturn(aResponse().withStatus(408)));
            case "UPLOAD_429" -> prd.stubFor(put(urlEqualTo(path(id))).willReturn(aResponse().withStatus(429)));
            case "DOWNLOAD_404" -> dev.stubFor(get(urlEqualTo(path(id) + "/$value")).willReturn(notFound()));
            case "DOWNLOAD_503" -> dev.stubFor(get(urlEqualTo(path(id) + "/$value")).willReturn(aResponse().withStatus(503)));
            case "DOWNLOAD_CONNECTION_RESET" -> dev.stubFor(get(urlEqualTo(path(id) + "/$value"))
                    .willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)));
            case "CONFIGURATION_403" -> dev.stubFor(get(urlEqualTo(path(id) + "/Configurations")).willReturn(aResponse().withStatus(403)));
            case "CONFIGURATION_502" -> dev.stubFor(get(urlEqualTo(path(id) + "/Configurations")).willReturn(aResponse().withStatus(502)));
            case "TARGET_403" -> prd.stubFor(get(urlEqualTo(path(id))).willReturn(aResponse().withStatus(403)));
            case "TARGET_500" -> prd.stubFor(get(urlEqualTo(path(id))).willReturn(aResponse().withStatus(500)));
            case "DEPLOY_RUNTIME_ERROR" -> prd.stubFor(get(urlEqualTo(runtime(id))).willReturn(okJson("{\"d\":{\"Status\":\"ERROR\"}}")));
            case "DEPLOY_TIMEOUT" -> prd.stubFor(get(urlEqualTo(runtime(id))).willReturn(okJson("{\"d\":{\"Status\":\"STARTING\"}}")));
            case "DEPLOY_STATUS_CALL_500" -> prd.stubFor(get(urlEqualTo(runtime(id))).willReturn(aResponse().withStatus(500)));
            case "ARTIFACT_ABSENT" -> id = "MISSING";
            default -> fail("unknown scenario " + scenario);
        }
        var result = run(true, id).results().getFirst();
        assertThat(result.status()).isEqualTo(ArtifactStatus.FAILED);
        assertThat(result.error().code()).isEqualTo(code);
        assertThat(result.grade()).as(scenario).isEqualTo(grade);
    }

    @Test
    @DisplayName("REQ-906: the summary counts fixRequired and retryable failures next to total, succeeded and failed")
    void req906_summaryCounts() {
        dev.stubFor(get(urlEqualTo(path("B") + "/$value")).willReturn(notFound()));
        dev.stubFor(get(urlEqualTo(path("C") + "/$value")).willReturn(aResponse().withStatus(503)));
        var response = run(false, "A", "B", "C");
        var summary = response.summary();
        assertThat(List.of(summary.total(), summary.succeeded(), summary.failed())).containsExactly(3, 1, 2);
        assertThat(summary.fixRequired()).isEqualTo(1);
        assertThat(summary.retryable()).isEqualTo(1);
        assertThat(summary.skipped()).isEqualTo(0);
        assertThat(response.results()).extracting(ArtifactResult::artifactId, ArtifactResult::grade).containsExactly(
                tuple("A", ArtifactGrade.SUCCESS), tuple("B", ArtifactGrade.FIX_REQUIRED), tuple("C", ArtifactGrade.RETRYABLE));
    }

    @Test
    @DisplayName("REQ-906: iFlows skipped by cancellation are counted in summary.skipped and are not listed in results")
    void req906_skippedCount() {
        var request = new TransportRequest("PKG", List.of("A", "B"), false, false);
        var run = new TransportRun(clock, request, List.of(new TransportPackage("PKG", null, TargetPackageStatus.EXISTING)),
                List.of(new TransportRun.Item("PKG", "A", TransportService.Stage.WAITING, null),
                        new TransportRun.Item("PKG", "B", TransportService.Stage.WAITING, null)), null, null);
        assertThat(run.startItem(0)).isTrue();
        run.cancel();
        assertThat(run.startItem(1)).isFalse();
        run.completed(0, new ArtifactResult("PKG", "A", null, TransportAction.UPDATED, List.of(), DeployStatus.NOT_REQUESTED, null));
        var summary = run.snapshot().result().summary();
        assertThat(List.of(summary.total(), summary.succeeded(), summary.failed())).containsExactly(1, 1, 0);
        assertThat(summary.skipped()).isEqualTo(1);
        assertThat(summary.fixRequired()).isEqualTo(0);
        assertThat(summary.retryable()).isEqualTo(0);
        assertThat(run.snapshot().result().results()).extracting(ArtifactResult::artifactId).containsExactly("A");
    }

    @Test
    @DisplayName("REQ-906 failure: a history line written before grades opens without error and has no grade or grade counts")
    void req906_oldHistoryLine() throws Exception {
        String old = "{\"transportId\":\"t-old\",\"packages\":[{\"packageId\":\"PKG\",\"packageName\":null,\"targetPackage\":\"EXISTING\"}],"
                + "\"dryRun\":false,\"deploy\":false,\"startedAt\":\"2026-11-01T00:00:00Z\",\"finishedAt\":\"2026-11-01T00:00:05Z\","
                + "\"summary\":{\"total\":2,\"succeeded\":1,\"failed\":1},\"results\":["
                + "{\"packageId\":\"PKG\",\"artifactId\":\"A\",\"status\":\"SUCCESS\",\"action\":\"UPDATED\",\"configurations\":[],\"deployStatus\":\"NOT_REQUESTED\",\"error\":null},"
                + "{\"packageId\":\"PKG\",\"artifactId\":\"B\",\"status\":\"FAILED\",\"action\":\"NONE\",\"configurations\":[],\"deployStatus\":\"NOT_REQUESTED\","
                + "\"error\":{\"code\":\"UPLOAD_FAILED\",\"message\":\"UPLOAD: HTTP 500; CPI call failed\"}}]}";
        Files.writeString(temporary.resolve("history.jsonl"), old + "\n", StandardCharsets.UTF_8);
        var entries = new TransportHistoryStore(settings, json).findAll();
        assertThat(entries).hasSize(1);
        var entry = entries.getFirst();
        assertThat(entry.results().get(1).status()).isEqualTo(ArtifactStatus.FAILED);
        assertThat(entry.results().get(1).grade()).isNull();
        assertThat(entry.summary().failed()).isEqualTo(1);
        assertThat(entry.summary().fixRequired()).isNull();
        assertThat(entry.summary().retryable()).isNull();
        assertThat(entry.summary().skipped()).isNull();
        var written = json.readTree(json.writeValueAsString(entry));
        assertThat(written.at("/summary").has("fixRequired")).isFalse();
        assertThat(written.at("/results/1").has("grade")).isFalse();
    }

    @Test
    @DisplayName("REQ-906: a new history line carries grade on each result and the grade counts in summary")
    void req906_newHistoryLine() throws Exception {
        dev.stubFor(get(urlEqualTo(path("B") + "/$value")).willReturn(notFound()));
        var response = run(false, "A", "B");
        var history = new TransportHistoryStore(settings, json);
        history.append(response);
        var line = json.readTree(Files.readAllLines(temporary.resolve("history.jsonl"), StandardCharsets.UTF_8).getFirst());
        assertThat(line.at("/results/0/grade").asString()).isEqualTo("SUCCESS");
        assertThat(line.at("/results/1/grade").asString()).isEqualTo("FIX_REQUIRED");
        assertThat(line.at("/summary/fixRequired").asInt()).isEqualTo(1);
        assertThat(line.at("/summary/retryable").asInt()).isEqualTo(0);
        assertThat(line.at("/summary/skipped").asInt()).isEqualTo(0);
        var reloaded = new TransportHistoryStore(settings, json).findAll().getFirst();
        assertThat(reloaded.results().get(1).grade()).isEqualTo(ArtifactGrade.FIX_REQUIRED);
        assertThat(reloaded.summary().fixRequired()).isEqualTo(1);
    }

    private TransportService service() {
        var tokens = new OAuthTokenProvider(connections, settings, clock, clock::advance);
        var api = new CpiApiClient(new CpiHttpExecutor(connections, tokens, new CsrfTokenStore(), settings, clock::advance), json);
        var sensitive = new SensitiveKeyMatcher(settings);
        return new TransportService(api, new ConfigurationCopier(api, sensitive),
                new DeployService(api, settings, clock, clock::advance), clock);
    }
    private TransportResponse run(boolean deploy, String... ids) {
        var artifacts = new ArrayList<CpiArtifact>();
        for (String id : List.of("A", "B", "C")) artifacts.add(new CpiArtifact(id, "Name " + id, "1.0"));
        return service().execute(new TransportRequest("PKG", List.of(ids), false, deploy), artifacts);
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
    private static class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-01-01T00:00:00Z");
        void advance(Duration duration) { now = now.plus(duration); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
