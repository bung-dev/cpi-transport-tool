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
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

/**
 * 20261120-async-transport S2: REQ-805 작업 상태 저장과 재기동.
 * 앱을 직접 띄우고 닫아 재기동을 흉내 낸다. "진행 중에 앱이 죽은" 상태는 진행 중 저장 파일·이력 파일을
 * 그 순간 복사해 두고 새 앱이 그 복사본을 읽게 해서 만든다. 로컬 WireMock 스텁과 더미 자격증명만 쓴다.
 */
@ExtendWith(OutputCaptureExtension.class)
class TransportJobPersistenceTests {
    @TempDir static Path directory;
    static LocalCpiStubs stubs;
    static final JsonMapper JSON = JsonMapper.builder().build();
    static final List<String> SIMPLE = List.of("IF_Fault_A", "IF_Fault_B", "IF_Fault_BadXml", "IF_Fault_NotZip");
    static final String PREVIEW = "{\"packageId\":\"PkgTransportDemo\",\"dryRun\":true}";

    @TestConfiguration(proxyBeanMethods = false)
    static class TestBeans {
        @Bean @Primary Sleeper testSleeper() { return duration -> {}; }
    }

    @BeforeAll static void startStubs() throws Exception {
        stubs = new LocalCpiStubs(directory.resolve("dev-zips"));
        stubs.start(0, 0);
    }
    @AfterAll static void stopStubs() { if (stubs != null) stubs.stop(); }
    @BeforeEach void reset() {
        stubs.dev().setGlobalFixedDelay(0);
        stubs.prd().setGlobalFixedDelay(0);
        stubs.dev().resetScenarios();
        stubs.prd().resetScenarios();
        stubs.prd().resetRequests();
    }

    // ---- helpers ----

    record Files2(Path jobs, Path history) {}

    static Files2 files(String name) {
        return new Files2(directory.resolve(name + "/nested/jobs.json"), directory.resolve(name + "/history.jsonl"));
    }

    static ConfigurableApplicationContext app(Files2 files) {
        var args = new ArrayList<>(List.of("--server.port=0", "--spring.main.banner-mode=off",
                "--cpi.transport.read-only=false",
                "--cpi.transport.transport-concurrency=1", "--cpi.transport.preview-concurrency=1",
                "--cpi.transport.jobs.file=" + slash(files.jobs()),
                "--cpi.transport.history.file=" + slash(files.history()),
                "--cpi.settings.store-file=" + slash(directory.resolve("settings.json")),
                "--cpi.tenants.store-file=" + slash(directory.resolve("tenants.enc")),
                "--cpi.templates.store-file=" + slash(directory.resolve("templates.json")),
                "--cpi.audit.file=" + slash(directory.resolve("audit.jsonl"))));
        for (String env : List.of("dev", "prd")) {
            String base = "http://localhost:" + (env.equals("dev") ? stubs.dev().port() : stubs.prd().port());
            String prefix = "--cpi.environments." + env + ".";
            args.add(prefix + "api-url=" + base);
            args.add(prefix + "token-url=" + base + "/oauth/token");
            args.add(prefix + "client-id=dummy-" + env + "-client");
            args.add(prefix + "client-secret=dummy-" + env + "-secret");
        }
        return new SpringApplicationBuilder(CpiTransportToolApplication.class, TestBeans.class).run(args.toArray(String[]::new));
    }
    static String slash(Path path) { return path.toString().replace('\\', '/'); }
    static int port(ConfigurableApplicationContext context) {
        return ((org.springframework.boot.web.server.context.WebServerApplicationContext) context).getWebServer().getPort();
    }

    record Reply(int status, JsonNode body) {}

    static Reply call(ConfigurableApplicationContext app, String method, String path, String body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port(app) + path)).timeout(Duration.ofSeconds(60));
        if (body != null) builder.header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        try (var client = HttpClient.newHttpClient()) {
            var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            var text = response.body();
            return new Reply(response.statusCode(), text == null || text.isBlank() ? null : JSON.readTree(text));
        }
    }

    static String startJob(ConfigurableApplicationContext app, String body) throws Exception {
        var reply = call(app, "POST", "/transport/jobs", body);
        assertThat(reply.status()).as(String.valueOf(reply.body())).isEqualTo(202);
        return reply.body().get("jobId").asString();
    }

    static JsonNode job(ConfigurableApplicationContext app, String id) throws Exception {
        var reply = call(app, "GET", "/transport/jobs/" + id, null);
        assertThat(reply.status()).as(id).isEqualTo(200);
        return reply.body();
    }

    static JsonNode awaitEnd(ConfigurableApplicationContext app, String id) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
        while (true) {
            var current = job(app, id);
            if (!"RUNNING".equals(current.get("status").asString())) return current;
            if (System.nanoTime() > deadline) fail("job did not finish: " + current);
            Thread.sleep(25);
        }
    }

    static List<JsonNode> lines(Path history) throws Exception {
        if (!Files.exists(history)) return List.of();
        var result = new ArrayList<JsonNode>();
        for (var line : Files.readAllLines(history)) if (!line.isBlank()) result.add(JSON.readTree(line));
        return result;
    }

    static String realBody() {
        return "{\"packageId\":\"PkgFaultDemo\",\"dryRun\":false,\"artifactIds\":" + JSON.writeValueAsString(SIMPLE) + "}";
    }

    // ---- REQ-805 ----

    @Test
    @DisplayName("REQ-805: a job that was RUNNING when the app died becomes INTERRUPTED on restart, unfinished items become SKIPPED, finished results go to one history line with jobStatus INTERRUPTED, nothing resumes and a second restart adds no duplicate line")
    void req805_restartMarksInterrupted() throws Exception {
        var live = files("live");
        var crashed = files("crashed");
        String id;
        try (var first = app(live)) {
            stubs.prd().setGlobalFixedDelay(400);
            id = startJob(first, realBody());
            // 첫 iFlow가 끝나고 작업이 아직 진행 중인 순간의 저장 파일·이력을 복사한다(= 그 순간 앱이 죽음).
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
            while (true) {
                var current = job(first, id);
                if (current.get("status").asString().equals("RUNNING") && current.get("done").asInt() >= 1) break;
                if (!current.get("status").asString().equals("RUNNING")) fail("finished before snapshot: " + current);
                if (System.nanoTime() > deadline) fail("no progress");
                Thread.sleep(20);
            }
            Thread.sleep(100); // 단계 변화 저장이 파일에 닿을 여유
            Files.createDirectories(crashed.jobs().getParent());
            Files.copy(live.jobs(), crashed.jobs(), StandardCopyOption.REPLACE_EXISTING);
            if (Files.exists(live.history())) Files.copy(live.history(), crashed.history(), StandardCopyOption.REPLACE_EXISTING);
            awaitEnd(first, id);
        }
        int linesBefore = lines(crashed.history()).size();
        var snapshot = JSON.readTree(Files.readString(crashed.jobs()));
        assertThat(snapshot.toString()).contains(id).contains("RUNNING");

        stubs.prd().setGlobalFixedDelay(0);
        stubs.prd().resetRequests();
        String transportId;
        try (var second = app(crashed)) {
            var after = job(second, id);
            assertThat(after.get("status").asString()).isEqualTo("INTERRUPTED");
            assertThat(after.get("finishedAt").isNull()).isFalse();
            assertThat(after.get("total").asInt()).isEqualTo(4);
            assertThat(after.get("done").asInt()).isEqualTo(4);
            var finished = new ArrayList<String>();
            for (var item : after.get("items")) {
                switch (item.get("stage").asString()) {
                    case "DONE" -> finished.add(item.get("artifactId").asString());
                    case "SKIPPED" -> assertThat(item.get("status").isNull()).isTrue();
                    default -> fail("unexpected stage after restart: " + item);
                }
            }
            assertThat(finished).isNotEmpty().hasSizeLessThan(4);
            var result = after.get("result");
            assertThat(result.isNull()).isFalse();
            assertThat(result.get("jobStatus").asString()).isEqualTo("INTERRUPTED");
            assertThat(result.get("summary").get("total").asInt()).isEqualTo(finished.size());
            var ids = new ArrayList<String>();
            for (var r : result.get("results")) ids.add(r.get("artifactId").asString());
            assertThat(ids).containsExactlyElementsOf(finished);
            transportId = result.get("transportId").asString();

            var added = lines(crashed.history());
            assertThat(added).hasSize(linesBefore + 1);
            assertThat(added.getLast().get("transportId").asString()).isEqualTo(transportId);
            assertThat(added.getLast().get("jobStatus").asString()).isEqualTo("INTERRUPTED");
            assertThat(call(second, "GET", "/transport/jobs/active", null).status()).isEqualTo(204);
            // 자동으로 이어서 하지 않는다: 재기동 뒤 대상에 아무 요청도 가지 않는다.
            Thread.sleep(500);
            assertThat(stubs.prd().getAllServeEvents()).isEmpty();
            // 새 실제 이관은 막히지 않는다(중단된 작업은 진행 중이 아님).
            var fresh = startJob(second, realBody());
            awaitEnd(second, fresh);
        }
        int linesAfterSecond = lines(crashed.history()).size();
        try (var third = app(crashed)) {
            var again = job(third, id);
            assertThat(again.get("status").asString()).isEqualTo("INTERRUPTED");
            assertThat(again.get("result").get("transportId").asString()).isEqualTo(transportId);
            assertThat(lines(crashed.history())).hasSize(linesAfterSecond);
        }
    }

    @Test
    @DisplayName("REQ-805: a finished job reads back the same status, items and result after a restart, with result taken from history by transportId")
    void req805_finishedJobSurvivesRestart() throws Exception {
        var store = files("finished");
        String id;
        JsonNode before;
        try (var first = app(store)) {
            id = startJob(first, PREVIEW);
            before = awaitEnd(first, id);
            assertThat(before.get("status").asString()).isEqualTo("COMPLETED");
        }
        assertThat(Files.exists(store.jobs())).isTrue();
        try (var second = app(store)) {
            var after = job(second, id);
            assertThat(after.get("status")).isEqualTo(before.get("status"));
            assertThat(after.get("items")).isEqualTo(before.get("items"));
            assertThat(after.get("total")).isEqualTo(before.get("total"));
            assertThat(after.get("done")).isEqualTo(before.get("done"));
            assertThat(after.get("startedAt")).isEqualTo(before.get("startedAt"));
            assertThat(after.get("finishedAt")).isEqualTo(before.get("finishedAt"));
            assertThat(after.get("result")).isEqualTo(before.get("result"));
        }
    }

    @Test
    @DisplayName("REQ-805: only the 20 most recent finished jobs are kept, the oldest is dropped and answers 404 after restart")
    void req805_keepsTwenty() throws Exception {
        var store = files("twenty");
        var ids = new ArrayList<String>();
        try (var first = app(store)) {
            for (int i = 0; i < 21; i++) {
                var id = startJob(first, PREVIEW);
                awaitEnd(first, id);
                ids.add(id);
            }
        }
        try (var second = app(store)) {
            var oldest = call(second, "GET", "/transport/jobs/" + ids.getFirst(), null);
            assertThat(oldest.status()).isEqualTo(404);
            assertThat(oldest.body().get("error").asString()).isEqualTo("JOB_NOT_FOUND");
            for (var id : ids.subList(1, 21)) assertThat(job(second, id).get("status").asString()).isEqualTo("COMPLETED");
        }
        assertThat(Files.readString(store.jobs())).doesNotContain(ids.getFirst());
    }

    @Test
    @DisplayName("REQ-805 failure: a missing file starts empty, a broken file logs a warning without its content and starts empty, and the next job writes a valid file")
    void req805_missingAndBrokenFile(CapturedOutput output) throws Exception {
        var missing = files("missing");
        try (var app = app(missing)) {
            assertThat(call(app, "GET", "/transport/jobs/00000000-0000-0000-0000-000000000000", null).status()).isEqualTo(404);
            assertThat(Files.exists(missing.jobs())).isFalse();
            var id = startJob(app, PREVIEW);
            awaitEnd(app, id);
            assertThat(JSON.readTree(Files.readString(missing.jobs())).toString()).contains(id);
        }

        var broken = files("broken");
        Files.createDirectories(broken.jobs().getParent());
        Files.writeString(broken.jobs(), "{broken-private-job-content");
        try (var app = app(broken)) {
            assertThat(call(app, "GET", "/transport/jobs/active", null).status()).isEqualTo(204);
            var id = startJob(app, PREVIEW);
            assertThat(awaitEnd(app, id).get("status").asString()).isEqualTo("COMPLETED");
            assertThat(JSON.readTree(Files.readString(broken.jobs())).toString()).contains(id);
        }
        assertThat(output.getAll()).containsIgnoringCase("jobs").doesNotContain("broken-private-job-content");
        assertThat(output.getAll()).containsPattern("WARN.*(?i)job");
    }

    @Test
    @DisplayName("REQ-805 failure: when the jobs file cannot be written the job still completes and a warning is logged")
    void req805_saveFailureKeepsRunning(CapturedOutput output) throws Exception {
        var blocked = files("blocked");
        Files.createDirectories(blocked.jobs()); // 파일 자리에 폴더가 있어 쓸 수 없다.
        try (var app = app(blocked)) {
            var id = startJob(app, PREVIEW);
            var end = awaitEnd(app, id);
            assertThat(end.get("status").asString()).isEqualTo("COMPLETED");
            assertThat(lines(blocked.history()).stream().anyMatch(l -> l.get("transportId").asString()
                    .equals(end.get("result").get("transportId").asString()))).isTrue();
        }
        assertThat(output.getAll()).containsPattern("WARN.*(?i)job");
    }

    @Test
    @DisplayName("REQ-805: the E2E app launcher passes a jobs file inside its work folder so E2E never writes the person's real jobs.json")
    void req805_e2eLauncherUsesWorkFolder() throws Exception {
        var launcher = Files.readString(Path.of("e2e/tools/app.py"));
        assertThat(launcher).contains("--cpi.transport.jobs.file={work / f'jobs-{a.label}.json'}");
        var properties = Files.readString(Path.of("src/main/resources/application.properties"));
        assertThat(properties).contains("cpi.transport.jobs.file=${user.home}/.cpi-transport-tool/jobs.json");
    }
}
