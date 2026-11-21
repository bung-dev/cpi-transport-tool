package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.stub.LocalCpiStubs;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
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
 * 20261121-package-objects S3: 작업 API(POST /transport/jobs, GET /transport/jobs/{id})의 종류.
 * REQ-1003 작업 항목(items)·skipped의 type, REQ-1005 진행 n/N(모든 종류 합계)·단계 경계·취소.
 * 앱을 직접 띄우고 로컬 WireMock 스텁(LocalCpiStubs)에 이 테스트용 패키지 PkgObjTest를 더한다. 더미 자격증명만 쓴다.
 */
class PackageObjectJobApiTests {
    @TempDir static Path directory;
    static LocalCpiStubs stubs;
    static ConfigurableApplicationContext app;
    static Path history;
    static final JsonMapper JSON = JsonMapper.builder().build();
    static final String ROOT = "/api/v1";
    static final String PKG = "PkgObjTest";

    @TestConfiguration(proxyBeanMethods = false)
    static class TestBeans {
        @Bean @Primary Sleeper testSleeper() { return duration -> Thread.sleep(duration.toMillis()); }
    }

    @BeforeAll static void start() throws Exception {
        stubs = new LocalCpiStubs(directory.resolve("dev-zips"));
        stubs.start(0, 0);
        var work = directory.resolve("app");
        history = work.resolve("history.jsonl");
        var args = new ArrayList<>(List.of("--server.port=0", "--spring.main.banner-mode=off",
                "--cpi.transport.read-only=false",
                "--cpi.transport.deploy.poll-interval=100ms",
                "--cpi.transport.jobs.file=" + slash(work.resolve("jobs.json")),
                "--cpi.transport.history.file=" + slash(history),
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
    @BeforeEach void reset() throws Exception {
        stubs.dev().resetScenarios();
        stubs.prd().resetScenarios();
        stubs.dev().resetRequests();
        stubs.prd().resetRequests();
        stubPackage();
        assertThat(call("PUT", "/settings", "{\"previewConcurrency\":4,\"transportConcurrency\":4}").status()).isEqualTo(200);
    }

    static String slash(Path path) { return path.toString().replace('\\', '/'); }
    static String collection(String segment) { return ROOT + "/" + segment + "DesigntimeArtifacts"; }
    static String entity(String segment, String id) { return collection(segment) + "(Id='" + id + "',Version='active')"; }
    static String deployPath(String segment, String id) { return ROOT + "/Deploy" + segment + "DesigntimeArtifact?Id='" + id + "'&Version='active'"; }
    static String statusPath(String task) { return ROOT + "/BuildAndDeployStatus(TaskId='" + task + "')"; }
    static String statusBody(String task, String value) { return "{\"d\":{\"TaskId\":\"" + task + "\",\"Status\":\"" + value + "\"}}"; }

    /** 원본: F1(iFlow), SC1(스크립트 컬렉션), VM1(밸류 매핑). 대상: 패키지 있음, 아티팩트 없음(생성). */
    static void stubPackage() {
        var dev = stubs.dev();
        var prd = stubs.prd();
        String meta = "{\"d\":{\"Id\":\"" + PKG + "\",\"Name\":\"Object Test\",\"Version\":\"1.0.0\"}}";
        String pkg = ROOT + "/IntegrationPackages('" + PKG + "')";
        dev.stubFor(get(urlEqualTo(pkg)).atPriority(1).willReturn(okJson(meta)));
        prd.stubFor(get(urlEqualTo(pkg)).atPriority(1).willReturn(okJson(meta)));
        for (var entry : List.of(List.of("Integration", "F1"), List.of("ScriptCollection", "SC1"), List.of("ValueMapping", "VM1"),
                List.of("MessageMapping", ""))) {
            String segment = entry.get(0), id = entry.get(1);
            String results = id.isEmpty() ? "" : "{\"Id\":\"" + id + "\",\"Name\":\"Name " + id + "\",\"Version\":\"1.0.0\",\"PackageId\":\"" + PKG + "\"}";
            dev.stubFor(get(urlEqualTo(pkg + "/" + segment + "DesigntimeArtifacts")).atPriority(1)
                    .willReturn(okJson("{\"d\":{\"results\":[" + results + "]}}")));
            if (id.isEmpty()) continue;
            dev.stubFor(get(urlEqualTo(entity(segment, id) + "/$value")).atPriority(1).willReturn(ok().withBody("src-" + id)));
            prd.stubFor(get(urlEqualTo(entity(segment, id))).atPriority(1).willReturn(notFound()));
            prd.stubFor(post(urlEqualTo(collection(segment))).atPriority(1)
                    .withRequestBody(matchingJsonPath("$.Id", equalTo(id))).willReturn(created()));
        }
        dev.stubFor(get(urlEqualTo(entity("Integration", "F1") + "/Configurations")).atPriority(1)
                .willReturn(okJson("{\"d\":{\"results\":[]}}")));
        for (String id : List.of("SC1", "VM1")) {
            String segment = id.startsWith("SC") ? "ScriptCollection" : "ValueMapping";
            prd.stubFor(post(urlEqualTo(deployPath(segment, id))).atPriority(1)
                    .willReturn(aResponse().withStatus(202).withHeader("Content-Type", "text/plain").withBody("task-" + id)));
            prd.stubFor(get(urlEqualTo(statusPath("task-" + id))).atPriority(1).willReturn(okJson(statusBody("task-" + id, "SUCCESS"))));
        }
    }

    record Reply(int status, JsonNode body) {}

    static Reply call(String method, String path, String body) throws Exception {
        int port = Integer.parseInt(app.getEnvironment().getProperty("local.server.port"));
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(60));
        if (body != null) builder.header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        var response = HttpClient.newHttpClient().send(builder.build(), HttpResponse.BodyHandlers.ofString());
        JsonNode parsed = response.body() == null || response.body().isBlank() ? null : JSON.readTree(response.body());
        return new Reply(response.statusCode(), parsed);
    }

    static JsonNode job(String id) throws Exception {
        var reply = call("GET", "/transport/jobs/" + id, null);
        assertThat(reply.status()).isEqualTo(200);
        return reply.body();
    }

    static List<JsonNode> awaitEnd(String id) throws Exception {
        var seen = new ArrayList<JsonNode>();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
        while (true) {
            var current = job(id);
            seen.add(current);
            if (!"RUNNING".equals(current.get("status").asString())) return seen;
            if (System.nanoTime() > deadline) fail("job " + id + " did not finish: " + current);
            Thread.sleep(20);
        }
    }

    static JsonNode item(JsonNode job, String id) {
        for (var item : job.get("items")) if (id.equals(item.get("artifactId").asString())) return item;
        throw new AssertionError("no item " + id + " in " + job);
    }

    static JsonNode historyLine(String transportId) throws Exception {
        for (var line : Files.readAllLines(history, StandardCharsets.UTF_8)) {
            if (line.isBlank()) continue;
            var node = JSON.readTree(line);
            if (node.get("transportId").asString().equals(transportId)) return node;
        }
        return null;
    }

    static String body(boolean deploy) {
        return "{\"packageId\":\"" + PKG + "\",\"dryRun\":false,\"deploy\":" + deploy + ",\"artifactIds\":[\"F1\"],"
                + "\"scriptCollectionIds\":[\"SC1\"],\"messageMappingIds\":[],\"valueMappingIds\":[\"VM1\"]}";
    }

    @Test
    @DisplayName("REQ-1003·REQ-1005: 작업 total과 진행 N은 모든 종류를 합친 수이고, items는 처리 단계 순서로 type을 가진다")
    void itemsCarryTypeInStageOrder() throws Exception {
        var started = call("POST", "/transport/jobs", body(false));
        assertThat(started.status()).as(String.valueOf(started.body())).isEqualTo(202);
        assertThat(started.body().get("total").asInt()).isEqualTo(3);
        var seen = awaitEnd(started.body().get("jobId").asString());
        for (var snapshot : seen) {
            assertThat(snapshot.get("total").asInt()).isEqualTo(3);
            var ids = new ArrayList<String>();
            for (var item : snapshot.get("items")) ids.add(item.get("artifactId").asString() + ":" + item.get("type").asString());
            assertThat(ids).containsExactly("SC1:SCRIPT_COLLECTION", "VM1:VALUE_MAPPING", "F1:INTEGRATION_FLOW");
        }
        var end = seen.getLast();
        assertThat(end.get("status").asString()).isEqualTo("COMPLETED");
        assertThat(end.get("done").asInt()).isEqualTo(3);
        var types = new ArrayList<String>();
        for (var r : end.at("/result/results")) types.add(r.get("artifactId").asString() + ":" + r.get("type").asString());
        assertThat(types).containsExactly("SC1:SCRIPT_COLLECTION", "VM1:VALUE_MAPPING", "F1:INTEGRATION_FLOW");
    }

    @Test
    @DisplayName("REQ-1005 실패: 앞 단계 배포 판정을 기다리는 중 취소하면 다음 단계 전체는 건너뜀(skipped에 type), 배포를 요청한 것은 판정까지 기다린다")
    void cancelDuringStageOneDeployment() throws Exception {
        var prd = stubs.prd();
        var deploying = prd.stubFor(get(urlEqualTo(statusPath("task-SC1"))).atPriority(1)
                .willReturn(okJson(statusBody("task-SC1", "DEPLOYING"))));
        var started = call("POST", "/transport/jobs", body(true));
        assertThat(started.status()).as(String.valueOf(started.body())).isEqualTo(202);
        String id = started.body().get("jobId").asString();

        // SC1이 배포 판정을 기다리는 동안: 다음 단계(VM1, F1)는 동시 처리 4여도 아직 시작하지 않았고, 진행은 0/3
        JsonNode waiting = null;
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        while (System.nanoTime() < deadline) {
            var current = job(id);
            if ("DEPLOY".equals(item(current, "SC1").get("stage").asString())
                    && !prd.findAll(getRequestedFor(urlEqualTo(statusPath("task-SC1")))).isEmpty()) {
                waiting = current;
                break;
            }
            Thread.sleep(20);
        }
        assertThat(waiting).as("SC1 never reached DEPLOY").isNotNull();
        Thread.sleep(300);
        var stillWaiting = job(id);
        assertThat(stillWaiting.get("done").asInt()).isZero();
        assertThat(stillWaiting.get("total").asInt()).isEqualTo(3);
        assertThat(item(stillWaiting, "VM1").get("stage").asString()).isEqualTo("WAITING");
        assertThat(item(stillWaiting, "F1").get("stage").asString()).isEqualTo("WAITING");

        assertThat(call("POST", "/transport/jobs/" + id + "/cancel", null).status()).isEqualTo(202);
        Thread.sleep(300);
        assertThat(job(id).get("status").asString()).as("deployment requested before cancel is still awaited").isEqualTo("RUNNING");
        prd.removeStub(deploying);
        prd.stubFor(get(urlEqualTo(statusPath("task-SC1"))).atPriority(1).willReturn(okJson(statusBody("task-SC1", "SUCCESS"))));

        var end = awaitEnd(id).getLast();
        assertThat(end.get("status").asString()).isEqualTo("CANCELLED");
        assertThat(item(end, "SC1").get("stage").asString()).isEqualTo("DONE");
        assertThat(item(end, "SC1").get("status").asString()).isEqualTo("SUCCESS");
        assertThat(item(end, "VM1").get("stage").asString()).isEqualTo("SKIPPED");
        assertThat(item(end, "F1").get("stage").asString()).isEqualTo("SKIPPED");
        var result = end.get("result");
        assertThat(result.at("/results/0/artifactId").asString()).isEqualTo("SC1");
        assertThat(result.at("/results/0/deployStatus").asString()).isEqualTo("STARTED");
        var skipped = new ArrayList<String>();
        for (var s : result.get("skipped")) skipped.add(s.get("packageId").asString() + ":" + s.get("artifactId").asString() + ":" + s.get("type").asString());
        assertThat(skipped).containsExactly(PKG + ":VM1:VALUE_MAPPING", PKG + ":F1:INTEGRATION_FLOW");
        var line = historyLine(result.get("transportId").asString());
        assertThat(line).isNotNull();
        assertThat(line.at("/skipped/0/type").asString()).isEqualTo("VALUE_MAPPING");
        assertThat(line.at("/skipped/1/type").asString()).isEqualTo("INTEGRATION_FLOW");
        // 건너뛴 다음 단계는 원본·대상 어디에도 요청하지 않았다.
        for (String skippedId : List.of("VM1", "F1")) {
            assertThat(stubs.dev().findAll(anyRequestedFor(urlMatching(".*Id='" + skippedId + "'.*")))).isEmpty();
            assertThat(prd.findAll(anyRequestedFor(urlMatching(".*" + skippedId + ".*")))).isEmpty();
        }
    }
}
