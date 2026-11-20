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
 * 20261120-async-transport 리뷰 1차 "검증 근거 없음" 보강(테스트만 추가):
 * REQ-801 실패 — 읽기 전용 모드의 실제 이관, 환경 미설정, CPI_UNAVAILABLE이 작업 API에서도 동기 API와 같은 상태·코드로 나오고 작업을 만들지 않는다.
 * REQ-806 실패 — 이력 저장이 실패해도 작업은 완료로 끝난다.
 * 로컬 WireMock 스텁과 더미 자격증명만 쓴다.
 */
@ExtendWith(OutputCaptureExtension.class)
class TransportJobErrorParityTests {
    @TempDir static Path directory;
    static LocalCpiStubs stubs;
    static final JsonMapper JSON = JsonMapper.builder().build();
    static final String REAL = "{\"packageId\":\"PkgTransportDemo\",\"dryRun\":false}";
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

    /** envs: 설정할 환경("dev","prd"), deadDev: DEV api-url을 닫힌 포트로 */
    static ConfigurableApplicationContext app(String name, boolean readOnly, List<String> envs, boolean deadDev, Path history) {
        var args = new ArrayList<>(List.of("--server.port=0", "--spring.main.banner-mode=off",
                "--cpi.transport.read-only=" + readOnly,
                "--cpi.transport.jobs.file=" + slash(directory.resolve(name + "/jobs.json")),
                "--cpi.transport.history.file=" + slash(history),
                "--cpi.settings.store-file=" + slash(directory.resolve(name + "/settings.json")),
                "--cpi.tenants.store-file=" + slash(directory.resolve(name + "/tenants.enc")),
                "--cpi.templates.store-file=" + slash(directory.resolve(name + "/templates.json")),
                "--cpi.audit.file=" + slash(directory.resolve(name + "/audit.jsonl"))));
        for (String env : envs) {
            String base = env.equals("dev")
                    ? (deadDev ? "http://localhost:1" : "http://localhost:" + stubs.dev().port())
                    : "http://localhost:" + stubs.prd().port();
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

    static void sameError(ConfigurableApplicationContext app, String body, int expectedStatus, String expectedCode) throws Exception {
        var sync = call(app, "POST", "/transport", body);
        var job = call(app, "POST", "/transport/jobs", body);
        assertThat(sync.status()).as("sync " + body).isEqualTo(expectedStatus);
        assertThat(sync.body().get("error").asString()).isEqualTo(expectedCode);
        assertThat(job.status()).as("job " + body).isEqualTo(sync.status());
        assertThat(job.body().get("error").asString()).isEqualTo(sync.body().get("error").asString());
        assertThat(call(app, "GET", "/transport/jobs/active", null).status()).isEqualTo(204);
    }

    @Test
    @DisplayName("REQ-801 failure: a real transport job in read-only mode answers exactly like POST /transport and creates no job")
    void req801_readOnly() throws Exception {
        try (var app = app("readonly", true, List.of("dev", "prd"), false, directory.resolve("readonly/history.jsonl"))) {
            var sync = call(app, "POST", "/transport", REAL);
            sameError(app, REAL, sync.status(), sync.body().get("error").asString());
            assertThat(sync.body().get("error").asString()).isEqualTo("READ_ONLY_MODE");
        }
    }

    @Test
    @DisplayName("REQ-801 failure: a real transport job without the target environment configured answers exactly like POST /transport and creates no job")
    void req801_environmentMissing() throws Exception {
        try (var app = app("noenv", false, List.of("dev"), false, directory.resolve("noenv/history.jsonl"))) {
            var sync = call(app, "POST", "/transport", REAL);
            assertThat(sync.status()).isBetween(400, 599);
            sameError(app, REAL, sync.status(), sync.body().get("error").asString());
        }
    }

    @Test
    @DisplayName("REQ-801 failure: when the source CPI cannot be reached a preview job answers 502 CPI_UNAVAILABLE exactly like POST /transport and creates no job")
    void req801_cpiUnavailable() throws Exception {
        try (var app = app("dead", false, List.of("dev", "prd"), true, directory.resolve("dead/history.jsonl"))) {
            sameError(app, PREVIEW, 502, "CPI_UNAVAILABLE");
        }
    }

    @Test
    @DisplayName("REQ-806 failure: when the history file cannot be written the job still ends COMPLETED with its result and a warning is logged")
    void req806_historySaveFailure(CapturedOutput output) throws Exception {
        var history = directory.resolve("blocked/history.jsonl");
        Files.createDirectories(history); // 파일 자리에 폴더가 있어 이력을 쓸 수 없다.
        try (var app = app("blocked", false, List.of("dev", "prd"), false, history)) {
            var started = call(app, "POST", "/transport/jobs", PREVIEW);
            assertThat(started.status()).isEqualTo(202);
            var id = started.body().get("jobId").asString();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
            JsonNode end;
            while (true) {
                end = call(app, "GET", "/transport/jobs/" + id, null).body();
                if (!end.get("status").asString().equals("RUNNING")) break;
                if (System.nanoTime() > deadline) fail("job did not finish");
                Thread.sleep(25);
            }
            assertThat(end.get("status").asString()).isEqualTo("COMPLETED");
            assertThat(end.get("result").isNull()).isFalse();
            assertThat(end.get("result").get("summary").get("total").asInt()).isEqualTo(2);
        }
        assertThat(output.getAll()).containsPattern("WARN.*");
    }
}
