package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.stub.LocalCpiStubs;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.*;

/**
 * 20261121-perf-retry S4: REQ-901 미리보기 묶음 보관, REQ-902 실제 이관 재사용, REQ-909 재사용 호출 수.
 * 앱을 직접 띄우고 로컬 WireMock 스텁(LocalCpiStubs)과 더미 자격증명만 쓴다. 시계는 테스트가 움직인다.
 */
class PreviewReuseApiTests {
    @TempDir static Path directory;
    static LocalCpiStubs stubs;
    static ConfigurableApplicationContext app;
    static final JsonMapper JSON = JsonMapper.builder().build();
    static final MutableClock CLOCK = new MutableClock();
    static final String PKG = "PkgTransportDemo";
    static final List<String> IDS = List.of("IF_Order_Sync", "IF_Customer_Push");
    static final String ROOT = "/api/v1/";

    static final class MutableClock extends Clock {
        volatile Instant now = Instant.parse("2026-11-21T00:00:00Z");
        void advance(Duration duration) { now = now.plus(duration); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestBeans {
        @Bean @Primary Sleeper testSleeper() { return duration -> {}; }
        @Bean @Primary Clock testClock() { return CLOCK; }
    }

    @BeforeAll static void start() throws Exception {
        stubs = new LocalCpiStubs(directory.resolve("dev-zips"));
        stubs.start(0, 0);
        var work = directory.resolve("app");
        var args = new ArrayList<>(List.of("--server.port=0", "--spring.main.banner-mode=off",
                "--cpi.transport.read-only=false",
                "--cpi.transport.jobs.file=" + slash(work.resolve("jobs.json")),
                "--cpi.transport.history.file=" + slash(work.resolve("history.jsonl")),
                "--cpi.settings.store-file=" + slash(work.resolve("settings.json")),
                "--cpi.tenants.store-file=" + slash(work.resolve("tenants.enc")),
                "--cpi.templates.store-file=" + slash(work.resolve("templates.json")),
                "--cpi.audit.file=" + slash(work.resolve("audit.jsonl"))));
        for (String env : List.of("dev", "prd")) {
            String base = "http://localhost:" + (env.equals("dev") ? stubs.dev().port() : stubs.prd().port());
            String prefix = "--cpi.environments." + env + ".";
            args.add(prefix + "api-url=" + base);
            args.add(prefix + "token-url=" + base + "/oauth/token");
            args.add(prefix + "client-id=dummy-" + env + "-client");
            args.add(prefix + "client-secret=dummy-" + env + "-secret");
        }
        app = new SpringApplicationBuilder(CpiTransportToolApplication.class, TestBeans.class).run(args.toArray(String[]::new));
    }
    @AfterAll static void stop() {
        if (app != null) app.close();
        if (stubs != null) stubs.stop();
    }
    @BeforeEach void reset() {
        stubs.dev().resetScenarios();
        stubs.prd().resetScenarios();
        stubs.dev().resetRequests();
        stubs.prd().resetRequests();
    }

    static String slash(Path path) { return path.toString().replace('\\', '/'); }
    static int port() { return ((org.springframework.boot.web.server.context.WebServerApplicationContext) app).getWebServer().getPort(); }
    record Reply(int status, JsonNode body) {}
    static Reply call(String method, String path, String body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port() + path)).timeout(Duration.ofSeconds(60));
        if (body != null) builder.header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        try (var client = HttpClient.newHttpClient()) {
            var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            var text = response.body();
            return new Reply(response.statusCode(), text == null || text.isBlank() ? null : JSON.readTree(text));
        }
    }
    static JsonNode runJob(String body) throws Exception {
        var started = call("POST", "/transport/jobs", body);
        assertThat(started.status()).as(String.valueOf(started.body())).isEqualTo(202);
        String id = started.body().get("jobId").asString();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
        while (true) {
            var job = call("GET", "/transport/jobs/" + id, null).body();
            if (!job.get("status").asString().equals("RUNNING")) return job.get("result");
            if (System.nanoTime() > deadline) fail("job did not finish: " + job);
            Thread.sleep(25);
        }
    }
    static String request(String pkg, List<String> ids, boolean dryRun, String previewId) {
        var body = new LinkedHashMap<String, Object>();
        body.put("packageId", pkg);
        body.put("artifactIds", ids);
        body.put("dryRun", dryRun);
        if (previewId != null) body.put("previewId", previewId);
        return JSON.writeValueAsString(body);
    }
    static String preview(String pkg, List<String> ids) throws Exception {
        var result = runJob(request(pkg, ids, true, null));
        assertThat(result.get("dryRun").asBoolean()).isTrue();
        return result.get("transportId").asString();
    }
    static String artifact(String id) { return ROOT + "IntegrationDesigntimeArtifacts(Id='" + id + "',Version='active')"; }
    static int sourceReads(String id) {
        return stubs.dev().findAll(getRequestedFor(urlPathEqualTo(artifact(id) + "/$value"))).size()
                + stubs.dev().findAll(getRequestedFor(urlPathEqualTo(artifact(id) + "/Configurations"))).size();
    }
    static Map<String, JsonNode> byArtifact(JsonNode result) {
        var map = new LinkedHashMap<String, JsonNode>();
        for (var r : result.get("results")) map.put(r.get("artifactId").asString(), r);
        return map;
    }

    @Test
    @DisplayName("REQ-902·REQ-909: a real transport with previewId uploads the preview bundle without reading the source again and marks reusedPreview")
    void req902_reuse() throws Exception {
        String previewId = preview(PKG, IDS);
        stubs.dev().resetRequests();
        var result = runJob(request(PKG, IDS, false, previewId));
        var results = byArtifact(result);
        for (String id : IDS) {
            assertThat(results.get(id).get("status").asString()).as(id).isEqualTo("SUCCESS");
            assertThat(results.get(id).get("reusedPreview").asBoolean()).as(id).isTrue();
            assertThat(sourceReads(id)).as("source reads for " + id).isZero();
        }
        // 업로드한 내용은 미리보기 때 원본에서 받은 zip 그대로다.
        var created = stubs.prd().findAll(postRequestedFor(urlPathEqualTo(ROOT + "IntegrationDesigntimeArtifacts")));
        var updated = stubs.prd().findAll(putRequestedFor(urlPathEqualTo(artifact("IF_Order_Sync"))));
        assertThat(updated).hasSize(1);
        byte[] uploaded = Base64.getDecoder().decode(JSON.readTree(updated.getFirst().getBodyAsString()).path("ArtifactContent").asString());
        assertThat(uploaded).isEqualTo(Files.readAllBytes(directory.resolve("dev-zips/IF_Order_Sync.zip")));
        assertThat(created).hasSize(1);
        byte[] createdZip = Base64.getDecoder().decode(JSON.readTree(created.getFirst().getBodyAsString()).path("ArtifactContent").asString());
        assertThat(createdZip).isEqualTo(Files.readAllBytes(directory.resolve("dev-zips/IF_Customer_Push.zip")));
    }

    @Test
    @DisplayName("REQ-902: the synchronous POST /transport also reuses the preview bundle")
    void req902_reuseSync() throws Exception {
        String previewId = preview(PKG, IDS);
        stubs.dev().resetRequests();
        var reply = call("POST", "/transport", request(PKG, IDS, false, previewId));
        assertThat(reply.status()).isEqualTo(200);
        for (var r : reply.body().get("results")) assertThat(r.get("reusedPreview").asBoolean()).isTrue();
        for (String id : IDS) assertThat(sourceReads(id)).isZero();
    }

    @Test
    @DisplayName("REQ-902 failure: without previewId or with an unknown one the source is read as before and reusedPreview is false")
    void req902_noPreview() throws Exception {
        for (String previewId : Arrays.asList(null, "00000000-0000-0000-0000-000000000000")) {
            stubs.dev().resetRequests();
            var results = byArtifact(runJob(request(PKG, IDS, false, previewId)));
            for (String id : IDS) {
                assertThat(results.get(id).get("reusedPreview").asBoolean()).as(previewId + " " + id).isFalse();
                assertThat(sourceReads(id)).as(previewId + " " + id).isEqualTo(2);
            }
        }
    }

    @Test
    @DisplayName("REQ-902 failure: an iFlow whose source version changed after the preview is downloaded again while the others reuse")
    void req902_versionChanged() throws Exception {
        String previewId = preview(PKG, IDS);
        var changed = stubs.dev().stubFor(get(urlPathEqualTo(ROOT + "IntegrationPackages('" + PKG + "')/IntegrationDesigntimeArtifacts")).atPriority(0)
                .willReturn(okJson("{\"d\":{\"results\":[{\"Id\":\"IF_Order_Sync\",\"Name\":\"Order Sync\",\"Version\":\"1.0.4\"},"
                        + "{\"Id\":\"IF_Customer_Push\",\"Name\":\"Customer Push\",\"Version\":\"2.1.0\"}]}}")));
        try {
            stubs.dev().resetRequests();
            var results = byArtifact(runJob(request(PKG, IDS, false, previewId)));
            assertThat(results.get("IF_Order_Sync").get("reusedPreview").asBoolean()).isFalse();
            assertThat(sourceReads("IF_Order_Sync")).isEqualTo(2);
            assertThat(results.get("IF_Customer_Push").get("reusedPreview").asBoolean()).isTrue();
            assertThat(sourceReads("IF_Customer_Push")).isZero();
        } finally {
            stubs.dev().removeStub(changed);
        }
    }

    @Test
    @DisplayName("REQ-901·REQ-902 failure: after 30 minutes the bundle is gone and the source is read again")
    void req902_expired() throws Exception {
        String previewId = preview(PKG, IDS);
        CLOCK.advance(Duration.ofMinutes(31));
        stubs.dev().resetRequests();
        var results = byArtifact(runJob(request(PKG, IDS, false, previewId)));
        for (String id : IDS) {
            assertThat(results.get(id).get("reusedPreview").asBoolean()).isFalse();
            assertThat(sourceReads(id)).isEqualTo(2);
        }
    }

    @Test
    @DisplayName("REQ-901 failure: an iFlow that failed in the preview is not kept and is read from the source in the real transport")
    void req901_failedNotKept() throws Exception {
        // IF_Fault_Download500: 원본 내려받기가 늘 500이라 미리보기에서 실패한다.
        var faulty = List.of("IF_Fault_A", "IF_Fault_Download500");
        String previewId = preview("PkgFaultDemo", faulty);
        stubs.dev().resetRequests();
        var results = byArtifact(runJob(request("PkgFaultDemo", faulty, false, previewId)));
        assertThat(results.get("IF_Fault_A").get("reusedPreview").asBoolean()).isTrue();
        assertThat(sourceReads("IF_Fault_A")).isZero();
        assertThat(results.get("IF_Fault_Download500").get("reusedPreview").asBoolean()).isFalse();
        assertThat(stubs.dev().findAll(getRequestedFor(urlPathEqualTo(artifact("IF_Fault_Download500") + "/$value")))).isNotEmpty();
    }

    @Test
    @DisplayName("REQ-902 failure: a previewId that is not a string is rejected with 400 INVALID_REQUEST and no job")
    void req902_invalidPreviewId() throws Exception {
        for (String value : List.of("123", "true", "{\"id\":\"x\"}", "[\"x\"]")) {
            String body = "{\"packageId\":\"" + PKG + "\",\"dryRun\":false,\"previewId\":" + value + "}";
            for (String path : List.of("/transport/jobs", "/transport")) {
                var reply = call("POST", path, body);
                assertThat(reply.status()).as(path + " " + value).isEqualTo(400);
                assertThat(reply.body().get("error").asString()).isEqualTo("INVALID_REQUEST");
            }
        }
        assertThat(call("GET", "/transport/jobs/active", null).status()).isEqualTo(204);
    }

    @Test
    @DisplayName("REQ-901: preview bundles are kept in memory only; no file under the app work folder contains the iFlow zip")
    void req901_notOnDisk() throws Exception {
        String previewId = preview(PKG, IDS);
        runJob(request(PKG, IDS, false, previewId));
        Thread.sleep(1500); // 묶음 저장(REQ-905)까지 파일에 닿게
        var zips = new ArrayList<byte[]>();
        for (String id : IDS) zips.add(Files.readAllBytes(directory.resolve("dev-zips/" + id + ".zip")));
        try (Stream<Path> files = Files.walk(directory.resolve("app"))) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                byte[] content = Files.readAllBytes(file);
                String text = new String(content, StandardCharsets.ISO_8859_1);
                for (byte[] zip : zips) {
                    assertThat(text).as(file.toString()).doesNotContain(new String(zip, StandardCharsets.ISO_8859_1));
                    assertThat(text).as(file.toString()).doesNotContain(Base64.getEncoder().encodeToString(zip));
                }
            }
        }
    }
}
