package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.stub.LocalCpiStubs;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
import static org.assertj.core.api.Assertions.*;

/**
 * 20261120-async-transport S1: REQ-801 작업 시작, REQ-802 진행 조회, REQ-803 실제 이관 하나만,
 * REQ-804 취소, REQ-806 이력 jobStatus. 로컬 WireMock 스텁(가짜 DEV/PRD)과 더미 자격증명만 쓴다.
 * 진행 중 상태를 관찰하려고 PRD 스텁에 응답 지연을 건다. 실제 이관 동시 처리 개수는 1.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = {CpiTransportToolApplication.class, TransportJobApiTests.TestBeans.class})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TransportJobApiTests {
    @TempDir static Path temporary;
    static LocalCpiStubs stubs;
    @LocalServerPort int port;
    static final JsonMapper JSON = JsonMapper.builder().build();
    static final List<String> SIMPLE = List.of("IF_Fault_A", "IF_Fault_B", "IF_Fault_BadXml", "IF_Fault_NotZip");

    @TestConfiguration(proxyBeanMethods = false)
    static class TestBeans {
        @Bean @Primary Clock testClock() { return Clock.fixed(Instant.parse("2026-11-20T00:00:00Z"), ZoneOffset.UTC); }
        @Bean @Primary Sleeper testSleeper() { return duration -> {}; }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) throws Exception {
        registry.add("cpi.transport.read-only", () -> "false");
        registry.add("cpi.transport.transport-concurrency", () -> "1");
        registry.add("cpi.transport.preview-concurrency", () -> "1");
        stubs = new LocalCpiStubs(temporary.resolve("dev-zips"));
        stubs.start(0, 0);
        for (String env : List.of("dev", "prd")) {
            String base = "http://localhost:" + (env.equals("dev") ? stubs.dev().port() : stubs.prd().port());
            String prefix = "cpi.environments." + env + ".";
            registry.add(prefix + "api-url", () -> base);
            registry.add(prefix + "token-url", () -> base + "/oauth/token");
            registry.add(prefix + "client-id", () -> "dummy-" + env + "-client");
            registry.add(prefix + "client-secret", () -> "dummy-" + env + "-secret");
        }
        registry.add("cpi.transport.history.file", () -> history().toString());
        registry.add("cpi.transport.jobs.file", () -> temporary.resolve("jobs.json").toString());
        registry.add("cpi.settings.store-file", () -> temporary.resolve("settings.json").toString());
        registry.add("cpi.tenants.store-file", () -> temporary.resolve("tenants.enc").toString());
        registry.add("cpi.templates.store-file", () -> temporary.resolve("templates.json").toString());
        registry.add("cpi.audit.file", () -> temporary.resolve("audit.jsonl").toString());
    }
    static Path history() { return temporary.resolve("history.jsonl"); }

    @AfterAll static void stop() { if (stubs != null) stubs.stop(); }

    @BeforeEach void reset() {
        stubs.dev().setGlobalFixedDelay(0);
        stubs.prd().setGlobalFixedDelay(0);
        stubs.dev().resetScenarios();
        stubs.prd().resetScenarios();
        stubs.prd().resetRequests();
    }

    // ---- helpers ----

    record Reply(int status, JsonNode body) {}

    Reply call(String method, String path, String body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .timeout(Duration.ofSeconds(60));
        if (body != null) builder.header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        var response = HttpClient.newHttpClient().send(builder.build(), HttpResponse.BodyHandlers.ofString());
        JsonNode parsed = response.body() == null || response.body().isBlank() ? null : JSON.readTree(response.body());
        return new Reply(response.statusCode(), parsed);
    }

    static String realBody(List<String> ids) {
        return "{\"packageId\":\"PkgFaultDemo\",\"dryRun\":false,\"artifactIds\":" + JSON.writeValueAsString(ids) + "}";
    }
    static final String DEMO_REAL = "{\"packageId\":\"PkgTransportDemo\",\"dryRun\":false}";
    static final String DEMO_PREVIEW = "{\"packageId\":\"PkgTransportDemo\",\"dryRun\":true}";

    Reply start(String body) throws Exception { return call("POST", "/transport/jobs", body); }

    JsonNode job(String id) throws Exception {
        var reply = call("GET", "/transport/jobs/" + id, null);
        assertThat(reply.status()).isEqualTo(200);
        return reply.body();
    }

    /** 작업이 끝날 때까지(상태가 RUNNING이 아닐 때까지) 조회하고, 본 모든 조회 응답을 돌려준다. */
    List<JsonNode> awaitEnd(String id) throws Exception {
        var seen = new ArrayList<JsonNode>();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
        while (true) {
            var current = job(id);
            seen.add(current);
            if (!"RUNNING".equals(current.get("status").asString())) return seen;
            if (System.nanoTime() > deadline) fail("job " + id + " did not finish: " + current);
            Thread.sleep(25);
        }
    }

    static List<JsonNode> historyLines() throws Exception {
        if (!Files.exists(history())) return List.of();
        var lines = new ArrayList<JsonNode>();
        for (var line : Files.readAllLines(history())) if (!line.isBlank()) lines.add(JSON.readTree(line));
        return lines;
    }

    static JsonNode withoutRunFields(JsonNode response) {
        var copy = (ObjectNode) response.deepCopy();
        copy.remove(List.of("transportId", "startedAt", "finishedAt", "jobStatus"));
        return copy;
    }

    // ---- REQ-801 ----

    @Test
    @DisplayName("REQ-801: POST /transport/jobs answers 202 with jobId, RUNNING, dryRun and total before the transport has finished")
    void req801_startsImmediately() throws Exception {
        stubs.prd().setGlobalFixedDelay(400);
        var reply = start(realBody(SIMPLE));
        assertThat(reply.status()).isEqualTo(202);
        var body = reply.body();
        assertThat(body.get("jobId").asString()).isNotBlank();
        assertThat(body.get("status").asString()).isEqualTo("RUNNING");
        assertThat(body.get("dryRun").asBoolean()).isFalse();
        assertThat(body.get("total").asInt()).isEqualTo(4);
        var first = job(body.get("jobId").asString());
        assertThat(first.get("status").asString()).isEqualTo("RUNNING");
        assertThat(first.get("done").asInt()).isLessThan(4);
        assertThat(first.get("result").isNull()).isTrue();
        awaitEnd(body.get("jobId").asString());
    }

    @Test
    @DisplayName("REQ-801: a finished preview job's result equals the synchronous POST /transport response apart from transportId and times")
    void req801_sameResultAsSynchronous() throws Exception {
        var sync = call("POST", "/transport", DEMO_PREVIEW);
        assertThat(sync.status()).isEqualTo(200);
        var started = start(DEMO_PREVIEW);
        assertThat(started.status()).isEqualTo(202);
        var end = awaitEnd(started.body().get("jobId").asString()).getLast();
        assertThat(end.get("status").asString()).isEqualTo("COMPLETED");
        assertThat(withoutRunFields(end.get("result"))).isEqualTo(withoutRunFields(sync.body()));
    }

    @Test
    @DisplayName("REQ-801 failure: invalid body, same source and target, unknown package and unknown template answer exactly like POST /transport and create no job")
    void req801_sameErrors() throws Exception {
        var bodies = List.of("[]", "{\"packageId\":\"bad id!\"}",
                "{\"packageId\":\"PkgTransportDemo\",\"sourceTenantId\":\"DEV\",\"targetTenantId\":\"DEV\"}",
                "{\"packageId\":\"PkgDoesNotExist\",\"dryRun\":true}",
                "{\"packageId\":\"PkgTransportDemo\",\"dryRun\":true,\"templateId\":\"no-such-template\"}",
                "{\"packageId\":\"PkgTransportDemo\",\"dryRun\":true,\"sourceTenantId\":\"NOPE\"}");
        for (var body : bodies) {
            var sync = call("POST", "/transport", body);
            var job = start(body);
            assertThat(sync.status()).as(body).isBetween(400, 599);
            assertThat(job.status()).as(body).isEqualTo(sync.status());
            assertThat(job.body().get("error").asString()).as(body).isEqualTo(sync.body().get("error").asString());
        }
        assertThat(call("GET", "/transport/jobs/active", null).status()).isEqualTo(204);
    }

    // ---- REQ-802 ----

    @Test
    @DisplayName("REQ-802: GET /transport/jobs/{id} shows items in request order whose stages move from WAITING to DONE, done counts finished items, result appears only at the end and holds no configuration value in items")
    void req802_progress() throws Exception {
        stubs.prd().setGlobalFixedDelay(150);
        var started = start(realBody(SIMPLE));
        var id = started.body().get("jobId").asString();
        var seen = awaitEnd(id);
        var end = seen.getLast();

        assertThat(end.get("jobId").asString()).isEqualTo(id);
        assertThat(end.get("status").asString()).isEqualTo("COMPLETED");
        assertThat(end.get("dryRun").asBoolean()).isFalse();
        assertThat(end.get("deploy").asBoolean()).isFalse();
        assertThat(end.get("total").asInt()).isEqualTo(4);
        assertThat(end.get("done").asInt()).isEqualTo(4);
        assertThat(end.get("startedAt").isNull()).isFalse();
        assertThat(end.get("finishedAt").isNull()).isFalse();
        assertThat(end.get("sourceTenant").get("id").asString()).isEqualTo("DEV");
        assertThat(end.get("targetTenant").get("id").asString()).isEqualTo("PRD");
        assertThat(end.get("packages").get(0).get("packageId").asString()).isEqualTo("PkgFaultDemo");
        var items = end.get("items");
        assertThat(items.size()).isEqualTo(4);
        for (int i = 0; i < 4; i++) {
            assertThat(items.get(i).get("packageId").asString()).isEqualTo("PkgFaultDemo");
            assertThat(items.get(i).get("artifactId").asString()).isEqualTo(SIMPLE.get(i));
            assertThat(items.get(i).get("stage").asString()).isEqualTo("DONE");
            assertThat(items.get(i).get("status").asString()).isEqualTo("SUCCESS");
        }
        assertThat(end.get("result").get("summary").get("total").asInt()).isEqualTo(4);

        // 진행 중 조회: 결과 없음, done < total, 첫 iFlow가 처리 단계에 있고 나머지는 WAITING인 순간이 있다.
        var running = seen.stream().filter(n -> "RUNNING".equals(n.get("status").asString())).toList();
        assertThat(running).isNotEmpty();
        assertThat(running).allSatisfy(n -> {
            assertThat(n.get("result").isNull()).isTrue();
            assertThat(n.get("finishedAt").isNull()).isTrue();
            assertThat(n.get("done").asInt()).isLessThan(4);
        });
        var stages = new HashSet<String>();
        for (var n : running) for (var item : n.get("items")) stages.add(item.get("stage").asString());
        assertThat(stages).contains("WAITING");
        assertThat(stages).containsAnyOf("TARGET", "UPLOAD", "DOWNLOAD", "CONFIGURATION_READ");
        assertThat(running).allSatisfy(n -> {
            for (var item : n.get("items")) {
                if (!item.get("stage").asString().equals("DONE")) assertThat(item.get("status").isNull()).isTrue();
                assertThat(item.has("configurations")).isFalse();
                assertThat(item.has("value")).isFalse();
            }
        });
    }

    @Test
    @DisplayName("REQ-802 failure: unknown or malformed job id answers 404 JOB_NOT_FOUND")
    void req802_notFound() throws Exception {
        for (var id : List.of("00000000-0000-0000-0000-000000000000", "nope", "..%2Fx")) {
            var reply = call("GET", "/transport/jobs/" + id, null);
            assertThat(reply.status()).as(id).isEqualTo(404);
            assertThat(reply.body().get("error").asString()).as(id).isEqualTo("JOB_NOT_FOUND");
        }
    }

    // ---- REQ-803 ----

    @Test
    @DisplayName("REQ-803: while a real transport job runs a second real job is refused with 409 JOB_ALREADY_RUNNING and its id, previews still start, active shows the running job and turns 204 after it ends")
    void req803_oneRealJob() throws Exception {
        stubs.prd().setGlobalFixedDelay(400);
        var first = start(realBody(SIMPLE));
        assertThat(first.status()).isEqualTo(202);
        var id = first.body().get("jobId").asString();

        var second = start(DEMO_REAL);
        assertThat(second.status()).isEqualTo(409);
        assertThat(second.body().get("error").asString()).isEqualTo("JOB_ALREADY_RUNNING");
        assertThat(second.body().get("jobId").asString()).isEqualTo(id);

        var preview = start(DEMO_PREVIEW);
        assertThat(preview.status()).isEqualTo(202);
        var preview2 = start(DEMO_PREVIEW);
        assertThat(preview2.status()).isEqualTo(202);

        var active = call("GET", "/transport/jobs/active", null);
        assertThat(active.status()).isEqualTo(200);
        assertThat(active.body().get("jobId").asString()).isEqualTo(id);
        assertThat(active.body().get("total").asInt()).isEqualTo(4);
        assertThat(active.body().has("done")).isTrue();

        awaitEnd(preview.body().get("jobId").asString());
        awaitEnd(preview2.body().get("jobId").asString());
        awaitEnd(id);
        assertThat(call("GET", "/transport/jobs/active", null).status()).isEqualTo(204);
        // 거부된 두 번째 요청은 작업도 이력도 만들지 않았다: 실제 이관 이력은 첫 작업 하나뿐이다.
        assertThat(historyLines().stream().filter(l -> !l.get("dryRun").asBoolean())
                .filter(l -> l.get("packages").get(0).get("packageId").asString().equals("PkgTransportDemo"))
                .filter(l -> l.has("jobStatus")).toList()).isEmpty();
    }

    @Test
    @DisplayName("REQ-803 failure: two real transport jobs started at the same moment give exactly one 202 and one 409")
    void req803_concurrentStarts() throws Exception {
        stubs.prd().setGlobalFixedDelay(300);
        var ready = new CountDownLatch(2);
        var go = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var futures = new ArrayList<Future<Reply>>();
            for (int i = 0; i < 2; i++) futures.add(pool.submit(() -> {
                ready.countDown();
                go.await();
                return start(realBody(SIMPLE));
            }));
            ready.await();
            go.countDown();
            var statuses = new ArrayList<Integer>();
            String accepted = null;
            for (var f : futures) {
                var r = f.get(60, TimeUnit.SECONDS);
                statuses.add(r.status());
                if (r.status() == 202) accepted = r.body().get("jobId").asString();
            }
            assertThat(statuses).containsExactlyInAnyOrder(202, 409);
            awaitEnd(accepted);
        }
    }

    // ---- REQ-804 ----

    @Test
    @DisplayName("REQ-804: cancel skips iFlows not yet started, lets the running one finish, ends CANCELLED and records only finished iFlows in history with jobStatus CANCELLED")
    void req804_cancel() throws Exception {
        stubs.prd().setGlobalFixedDelay(300);
        var started = start(realBody(SIMPLE));
        var id = started.body().get("jobId").asString();
        var cancel = call("POST", "/transport/jobs/" + id + "/cancel", null);
        assertThat(cancel.status()).isEqualTo(202);

        var end = awaitEnd(id).getLast();
        assertThat(end.get("status").asString()).isEqualTo("CANCELLED");
        assertThat(end.get("finishedAt").isNull()).isFalse();
        var items = end.get("items");
        var finished = new ArrayList<String>();
        int skipped = 0;
        for (var item : items) {
            switch (item.get("stage").asString()) {
                case "DONE" -> finished.add(item.get("artifactId").asString());
                case "SKIPPED" -> { skipped++; assertThat(item.get("status").isNull()).isTrue(); }
                default -> fail("unexpected stage after cancel: " + item);
            }
        }
        assertThat(skipped).isGreaterThanOrEqualTo(1);
        assertThat(end.get("done").asInt()).isEqualTo(4);
        var result = end.get("result");
        assertThat(result.get("summary").get("total").asInt()).isEqualTo(finished.size());
        var resultIds = new ArrayList<String>();
        for (var r : result.get("results")) resultIds.add(r.get("artifactId").asString());
        assertThat(resultIds).containsExactlyElementsOf(finished);
        // 건너뛴 iFlow는 대상에 올라가지 않았다.
        for (var item : items) if (item.get("stage").asString().equals("SKIPPED")) {
            String artifact = item.get("artifactId").asString();
            assertThat(stubs.prd().findAll(com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor(
                    com.github.tomakehurst.wiremock.client.WireMock.urlMatching(".*" + artifact + ".*")))).isEmpty();
        }
        var line = historyLines().stream().filter(l -> l.get("transportId").asString()
                .equals(result.get("transportId").asString())).findFirst().orElseThrow();
        assertThat(line.get("jobStatus").asString()).isEqualTo("CANCELLED");
        assertThat(line.get("summary").get("total").asInt()).isEqualTo(finished.size());
        assertThat(result.get("jobStatus").asString()).isEqualTo("CANCELLED");

        var again = call("POST", "/transport/jobs/" + id + "/cancel", null);
        assertThat(again.status()).isEqualTo(409);
        assertThat(again.body().get("error").asString()).isEqualTo("JOB_NOT_RUNNING");
        assertThat(job(id).get("status").asString()).isEqualTo("CANCELLED");
    }

    @Test
    @DisplayName("REQ-804 failure: cancelling an unknown job answers 404 JOB_NOT_FOUND")
    void req804_cancelUnknown() throws Exception {
        var reply = call("POST", "/transport/jobs/00000000-0000-0000-0000-000000000000/cancel", null);
        assertThat(reply.status()).isEqualTo(404);
        assertThat(reply.body().get("error").asString()).isEqualTo("JOB_NOT_FOUND");
    }

    // ---- REQ-806 ----

    @Test
    @DisplayName("REQ-806: a completed job writes one history line with jobStatus COMPLETED while a synchronous POST /transport line has no jobStatus")
    void req806_historyJobStatus() throws Exception {
        var sync = call("POST", "/transport", DEMO_PREVIEW);
        var syncLine = historyLines().stream().filter(l -> l.get("transportId").asString()
                .equals(sync.body().get("transportId").asString())).findFirst().orElseThrow();
        assertThat(syncLine.has("jobStatus")).isFalse();

        var started = start(DEMO_PREVIEW);
        var end = awaitEnd(started.body().get("jobId").asString()).getLast();
        var transportId = end.get("result").get("transportId").asString();
        var lines = historyLines().stream().filter(l -> l.get("transportId").asString().equals(transportId)).toList();
        assertThat(lines).hasSize(1);
        assertThat(lines.getFirst().get("jobStatus").asString()).isEqualTo("COMPLETED");
        var api = call("GET", "/transport/history", null).body();
        boolean found = false;
        for (var entry : api) if (entry.get("transportId").asString().equals(transportId)) {
            found = true;
            assertThat(entry.get("jobStatus").asString()).isEqualTo("COMPLETED");
        }
        assertThat(found).isTrue();
    }
}
