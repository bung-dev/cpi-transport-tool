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
 * 20261121-perf-retry S5: REQ-907 다시 이관 API(POST /transport/jobs/retry), 이력 줄의 skipped·retryOf.
 * 앱을 직접 띄우고 로컬 WireMock 스텁(LocalCpiStubs)과 더미 자격증명만 쓴다.
 */
class RetryApiTests {
    @TempDir static Path directory;
    static LocalCpiStubs stubs;
    static ConfigurableApplicationContext app;
    static Path history;
    static final JsonMapper JSON = JsonMapper.builder().build();
    static final String ROOT = "/api/v1/";

    @TestConfiguration(proxyBeanMethods = false)
    static class TestBeans {
        @Bean @Primary Sleeper testSleeper() { return duration -> {}; }
    }

    @BeforeAll static void start() throws Exception {
        stubs = new LocalCpiStubs(directory.resolve("dev-zips"));
        stubs.start(0, 0);
        var work = directory.resolve("app");
        history = work.resolve("history.jsonl");
        var args = new ArrayList<>(List.of("--server.port=0", "--spring.main.banner-mode=off",
                "--cpi.transport.read-only=false",
                "--cpi.transport.deploy.poll-interval=200ms",
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
        stubs.dev().setGlobalFixedDelay(0);
        stubs.prd().setGlobalFixedDelay(0);
        stubs.dev().resetScenarios();
        stubs.prd().resetScenarios();
        stubs.dev().resetRequests();
        stubs.prd().resetRequests();
        assertThat(call("PUT", "/settings", "{\"previewConcurrency\":4,\"transportConcurrency\":4}").status()).isEqualTo(200);
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
    static JsonNode await(String jobId) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
        while (true) {
            var job = call("GET", "/transport/jobs/" + jobId, null).body();
            if (!job.get("status").asString().equals("RUNNING")) return job;
            if (System.nanoTime() > deadline) fail("job did not finish: " + job);
            Thread.sleep(25);
        }
    }
    static String start(String body) throws Exception {
        var started = call("POST", "/transport/jobs", body);
        assertThat(started.status()).as(String.valueOf(started.body())).isEqualTo(202);
        return started.body().get("jobId").asString();
    }
    static String real(String pkg, List<String> ids, boolean deploy) {
        return JSON.writeValueAsString(Map.of("packageId", pkg, "artifactIds", ids, "dryRun", false, "deploy", deploy));
    }
    static Reply retry(String transportId) throws Exception {
        return call("POST", "/transport/jobs/retry", JSON.writeValueAsString(Map.of("transportId", transportId)));
    }
    static JsonNode historyLine(String transportId) throws Exception {
        for (var line : Files.readAllLines(history, StandardCharsets.UTF_8)) {
            if (line.isBlank()) continue;
            var node = JSON.readTree(line);
            if (node.get("transportId").asString().equals(transportId)) return node;
        }
        return null;
    }
    static List<String> artifactIds(JsonNode node) {
        var ids = new ArrayList<String>();
        for (var r : node) ids.add(r.get("artifactId").asString());
        return ids;
    }

    @Test
    @DisplayName("REQ-907: retry starts a new real job with only the failed iFlows, same tenants and deploy setting, and the new history line carries retryOf")
    void req907_failedOnly() throws Exception {
        var original = await(start(real("PkgFaultDemo", List.of("IF_Fault_A", "IF_Fault_Download500", "IF_Fault_UploadFail"), true)));
        String transportId = original.get("result").get("transportId").asString();
        assertThat(original.get("result").get("summary").get("failed").asInt()).isEqualTo(2);

        var reply = retry(transportId);
        assertThat(reply.status()).as(String.valueOf(reply.body())).isEqualTo(202);
        assertThat(reply.body().get("status").asString()).isEqualTo("RUNNING");
        assertThat(reply.body().get("dryRun").asBoolean()).isFalse();
        assertThat(reply.body().get("total").asInt()).isEqualTo(2);
        var again = await(reply.body().get("jobId").asString());
        assertThat(again.get("deploy").asBoolean()).isTrue();
        assertThat(again.get("sourceTenant").get("id").asString()).isEqualTo("DEV");
        assertThat(again.get("targetTenant").get("id").asString()).isEqualTo("PRD");
        assertThat(artifactIds(again.get("items"))).containsExactly("IF_Fault_Download500", "IF_Fault_UploadFail");
        assertThat(again.get("result").get("retryOf").asString()).isEqualTo(transportId);
        // 미리보기 묶음을 쓰지 않고 원본에서 새로 내려받는다.
        assertThat(stubs.dev().findAll(getRequestedFor(urlPathMatching(".*IF_Fault_UploadFail.*\\$value")))).isNotEmpty();
        var line = historyLine(again.get("result").get("transportId").asString());
        assertThat(line.get("retryOf").asString()).isEqualTo(transportId);
        assertThat(line.get("skipped").isArray()).isTrue();
        assertThat(line.get("skipped").size()).isZero();
    }

    @Test
    @DisplayName("REQ-907: iFlows skipped by cancellation are written to the history line and included in the retry")
    void req907_skippedIncluded() throws Exception {
        assertThat(call("PUT", "/settings", "{\"previewConcurrency\":4,\"transportConcurrency\":1}").status()).isEqualTo(200);
        stubs.prd().setGlobalFixedDelay(600);
        String jobId = start(real("PkgTransportDemo", List.of("IF_Order_Sync", "IF_Customer_Push"), false));
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        while (!call("GET", "/transport/jobs/" + jobId, null).body().get("items").get(0).get("stage").asString().matches("DOWNLOAD|TARGET|UPLOAD")) {
            if (System.nanoTime() > deadline) fail("first iFlow did not start");
            Thread.sleep(10);
        }
        assertThat(call("POST", "/transport/jobs/" + jobId + "/cancel", null).status()).isEqualTo(202);
        var original = await(jobId);
        stubs.prd().setGlobalFixedDelay(0);
        assertThat(original.get("status").asString()).isEqualTo("CANCELLED");
        String transportId = original.get("result").get("transportId").asString();
        var line = historyLine(transportId);
        assertThat(line.get("skipped")).hasSize(1);
        assertThat(line.get("skipped").get(0).get("packageId").asString()).isEqualTo("PkgTransportDemo");
        assertThat(line.get("skipped").get(0).get("artifactId").asString()).isEqualTo("IF_Customer_Push");

        var reply = retry(transportId);
        assertThat(reply.status()).as(String.valueOf(reply.body())).isEqualTo(202);
        assertThat(reply.body().get("total").asInt()).isEqualTo(1);
        var again = await(reply.body().get("jobId").asString());
        assertThat(artifactIds(again.get("items"))).containsExactly("IF_Customer_Push");
        assertThat(again.get("status").asString()).isEqualTo("COMPLETED");
    }

    @Test
    @DisplayName("REQ-907: a package the original transport could not create (CREATE_FAILED) or did not find (NOT_FOUND) is put back for creation")
    void req907_createAgain() throws Exception {
        var createFailed = await(start(JSON.writeValueAsString(Map.of("packageId", "PkgCreateFail", "dryRun", false, "createPackages", List.of("PkgCreateFail")))));
        assertThat(createFailed.get("packages").get(0).get("targetPackage").asString()).isEqualTo("CREATE_FAILED");
        var notFound = await(start(JSON.writeValueAsString(Map.of("packageId", "PkgNotInPrd", "dryRun", false))));
        assertThat(notFound.get("packages").get(0).get("targetPackage").asString()).isEqualTo("NOT_FOUND");
        stubs.prd().resetRequests();

        var first = retry(createFailed.get("result").get("transportId").asString());
        assertThat(first.status()).isEqualTo(202);
        var firstJob = await(first.body().get("jobId").asString());
        stubs.prd().verify(1, postRequestedFor(urlPathEqualTo(ROOT + "IntegrationPackages")).withRequestBody(matchingJsonPath("$.Id", equalTo("PkgCreateFail"))));
        assertThat(firstJob.get("packages").get(0).get("targetPackage").asString()).isEqualTo("CREATE_FAILED");

        var second = retry(notFound.get("result").get("transportId").asString());
        assertThat(second.status()).isEqualTo(202);
        var secondJob = await(second.body().get("jobId").asString());
        stubs.prd().verify(1, postRequestedFor(urlPathEqualTo(ROOT + "IntegrationPackages")).withRequestBody(matchingJsonPath("$.Id", equalTo("PkgNotInPrd"))));
        assertThat(secondJob.get("packages").get(0).get("targetPackage").asString()).isEqualTo("CREATED");
        assertThat(secondJob.get("result").get("summary").get("failed").asInt()).isZero();
    }

    @Test
    @DisplayName("REQ-907: a package the original transport created (CREATED) is not created again, and an old history line without skipped retries its failures only")
    void req907_createdNotAgainAndOldLine() throws Exception {
        String old = "{\"transportId\":\"t-old-created\",\"packages\":[{\"packageId\":\"PkgNotInPrd\",\"packageName\":\"Not In PRD\",\"targetPackage\":\"CREATED\"}],"
                + "\"dryRun\":false,\"deploy\":false,\"startedAt\":\"2026-11-01T00:00:00Z\",\"finishedAt\":\"2026-11-01T00:00:05Z\","
                + "\"summary\":{\"total\":1,\"succeeded\":0,\"failed\":1},\"results\":[{\"packageId\":\"PkgNotInPrd\",\"artifactId\":\"IF_Orphan\",\"status\":\"FAILED\","
                + "\"action\":\"NONE\",\"configurations\":[],\"deployStatus\":\"NOT_REQUESTED\",\"error\":{\"code\":\"UPLOAD_FAILED\",\"message\":\"UPLOAD: HTTP 500; CPI call failed\"}}],"
                + "\"sourceTenant\":{\"id\":\"DEV\",\"name\":\"DEV\"},\"targetTenant\":{\"id\":\"PRD\",\"name\":\"PRD\"}}";
        Files.createDirectories(history.getParent());
        Files.writeString(history, old + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        var reply = retry("t-old-created");
        assertThat(reply.status()).as(String.valueOf(reply.body())).isEqualTo(202);
        assertThat(reply.body().get("total").asInt()).isEqualTo(1);
        var again = await(reply.body().get("jobId").asString());
        stubs.prd().verify(0, postRequestedFor(urlPathEqualTo(ROOT + "IntegrationPackages")));
        // 스텁의 대상에는 PkgNotInPrd가 여전히 없으므로, 다시 만들지 않으면 대상 패키지 없음으로 끝난다.
        assertThat(again.get("packages").get(0).get("targetPackage").asString()).isEqualTo("NOT_FOUND");
        assertThat(again.get("result").get("results").get(0).get("error").get("code").asString()).isEqualTo("PACKAGE_NOT_FOUND_IN_TARGET");
    }

    @Test
    @DisplayName("REQ-907 failure: unknown transport 404 TRANSPORT_NOT_FOUND, preview 400 RETRY_NOT_ALLOWED, nothing failed 400 NOTHING_TO_RETRY, bad body 400 INVALID_REQUEST, and no job is created")
    void req907_errors() throws Exception {
        var unknown = retry("00000000-0000-0000-0000-000000000000");
        assertThat(unknown.status()).isEqualTo(404);
        assertThat(unknown.body().get("error").asString()).isEqualTo("TRANSPORT_NOT_FOUND");

        var preview = await(start(JSON.writeValueAsString(Map.of("packageId", "PkgFaultDemo", "artifactIds", List.of("IF_Fault_Download500"), "dryRun", true))));
        var notAllowed = retry(preview.get("result").get("transportId").asString());
        assertThat(notAllowed.status()).isEqualTo(400);
        assertThat(notAllowed.body().get("error").asString()).isEqualTo("RETRY_NOT_ALLOWED");

        var clean = await(start(real("PkgTransportDemo", List.of("IF_Customer_Push"), false)));
        assertThat(clean.get("result").get("summary").get("failed").asInt()).isZero();
        var nothing = retry(clean.get("result").get("transportId").asString());
        assertThat(nothing.status()).isEqualTo(400);
        assertThat(nothing.body().get("error").asString()).isEqualTo("NOTHING_TO_RETRY");

        for (String body : List.of("{}", "{\"transportId\":123}", "{\"transportId\":\"\"}", "[]")) {
            var bad = call("POST", "/transport/jobs/retry", body);
            assertThat(bad.status()).as(body).isEqualTo(400);
            assertThat(bad.body().get("error").asString()).as(body).isEqualTo("INVALID_REQUEST");
        }
        assertThat(call("GET", "/transport/jobs/active", null).status()).isEqualTo(204);
    }

    @Test
    @DisplayName("REQ-907 failure: while another real transport runs the retry answers 409 JOB_ALREADY_RUNNING and creates no job")
    void req907_alreadyRunning() throws Exception {
        var failedRun = await(start(real("PkgFaultDemo", List.of("IF_Fault_Download500"), false)));
        String transportId = failedRun.get("result").get("transportId").asString();
        stubs.prd().setGlobalFixedDelay(800);
        String running = start(real("PkgTransportDemo", List.of("IF_Order_Sync", "IF_Customer_Push"), false));
        try {
            var reply = retry(transportId);
            assertThat(reply.status()).isEqualTo(409);
            assertThat(reply.body().get("error").asString()).isEqualTo("JOB_ALREADY_RUNNING");
            assertThat(call("GET", "/transport/jobs/active", null).body().get("jobId").asString()).isEqualTo(running);
        } finally {
            stubs.prd().setGlobalFixedDelay(0);
            await(running);
        }
    }
}
