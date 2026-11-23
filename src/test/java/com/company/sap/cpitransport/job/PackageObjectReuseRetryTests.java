package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.stub.LocalCpiStubs;
import com.github.tomakehurst.wiremock.WireMockServer;
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
 * 20261121-package-objects S4: REQ-1006 미리보기 묶음·다시 이관에 종류 적용.
 * - 미리보기 묶음은 새 종류 zip도 보관·재사용한다. 열쇠는 원본 테넌트+종류+Id+버전. 재사용하면 reusedPreview=true.
 * - 다시 이관은 실패·건너뜀을 종류째 다시 보낸다(새 작업 요청에 종류별 Id 목록). 옛 이력 줄은 모두 iFlow로 본다.
 * 앱을 직접 띄우고 로컬 WireMock 스텁(LocalCpiStubs)에 이 테스트용 패키지(PkgObjReuse, PkgObjSame)를 더한다. 더미 자격증명만 쓴다.
 */
class PackageObjectReuseRetryTests {
    @TempDir static Path directory;
    static LocalCpiStubs stubs;
    static ConfigurableApplicationContext app;
    static Path history;
    static final JsonMapper JSON = JsonMapper.builder().build();
    static final String ROOT = "/api/v1";
    static final String PKG = "PkgObjReuse", SAME = "PkgObjSame";

    @TestConfiguration(proxyBeanMethods = false)
    static class TestBeans {
        @Bean @Primary Sleeper testSleeper() { return duration -> Thread.sleep(Math.min(duration.toMillis(), 50)); }
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
        // PkgObjReuse: iFlow F1, 스크립트 컬렉션 SC1, 메시지 매핑 MM1, 밸류 매핑 VM1
        stubPackage(PKG, List.of(List.of("Integration", "F1", "src-F1"), List.of("ScriptCollection", "SC1", "src-SC1"),
                List.of("MessageMapping", "MM1", "src-MM1"), List.of("ValueMapping", "VM1", "src-VM1")));
        // PkgObjSame: 같은 Id·같은 버전의 스크립트 컬렉션과 메시지 매핑(내용이 다름)
        stubPackage(SAME, List.of(List.of("ScriptCollection", "Same", "sc-same"), List.of("MessageMapping", "Same", "mm-same"),
                List.of("ValueMapping", "", ""), List.of("Integration", "", "")));
        assertThat(call("PUT", "/settings", "{\"previewConcurrency\":4,\"transportConcurrency\":4}").status()).isEqualTo(200);
    }

    static String slash(Path path) { return path.toString().replace('\\', '/'); }
    static String collection(String segment) { return ROOT + "/" + segment + "DesigntimeArtifacts"; }
    static String entity(String segment, String id) { return collection(segment) + "(Id='" + id + "',Version='active')"; }
    static String list(String pkg, String segment) { return ROOT + "/IntegrationPackages('" + pkg + "')/" + segment + "DesigntimeArtifacts"; }
    static String b64(String text) { return Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)); }

    /** 원본 목록·내려받기, 대상은 패키지 있음·아티팩트 없음(생성 성공). entry = [segment, id(빈 문자열이면 빈 목록), zip 내용]. */
    static void stubPackage(String pkg, List<List<String>> entries) {
        var dev = stubs.dev();
        var prd = stubs.prd();
        String meta = "{\"d\":{\"Id\":\"" + pkg + "\",\"Name\":\"" + pkg + "\",\"Version\":\"1.0.0\"}}";
        dev.stubFor(get(urlEqualTo(ROOT + "/IntegrationPackages('" + pkg + "')")).atPriority(1).willReturn(okJson(meta)));
        prd.stubFor(get(urlEqualTo(ROOT + "/IntegrationPackages('" + pkg + "')")).atPriority(1).willReturn(okJson(meta)));
        for (var entry : entries) {
            String segment = entry.get(0), id = entry.get(1);
            sourceList(pkg, segment, id, "1.0.0");
            if (id.isEmpty()) continue;
            dev.stubFor(get(urlEqualTo(entity(segment, id) + "/$value")).atPriority(1).willReturn(ok().withBody(entry.get(2))));
            prd.stubFor(get(urlEqualTo(entity(segment, id))).atPriority(1).willReturn(notFound()));
            prd.stubFor(post(urlEqualTo(collection(segment))).atPriority(1)
                    .withRequestBody(matchingJsonPath("$.Id", equalTo(id))).willReturn(created()));
            if (segment.equals("Integration")) {
                dev.stubFor(get(urlEqualTo(entity(segment, id) + "/Configurations")).atPriority(1)
                        .willReturn(okJson("{\"d\":{\"results\":[]}}")));
            }
        }
    }

    static void sourceList(String pkg, String segment, String id, String version) {
        String results = id.isEmpty() ? "" : "{\"Id\":\"" + id + "\",\"Name\":\"Name " + id + "\",\"Version\":\"" + version
                + "\",\"PackageId\":\"" + pkg + "\"}";
        stubs.dev().stubFor(get(urlEqualTo(list(pkg, segment))).atPriority(1).willReturn(okJson("{\"d\":{\"results\":[" + results + "]}}")));
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

    static JsonNode await(String jobId) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
        while (true) {
            var reply = call("GET", "/transport/jobs/" + jobId, null);
            assertThat(reply.status()).isEqualTo(200);
            if (!"RUNNING".equals(reply.body().get("status").asString())) return reply.body();
            if (System.nanoTime() > deadline) fail("job " + jobId + " did not finish");
            Thread.sleep(20);
        }
    }

    static JsonNode runJob(String body) throws Exception {
        var started = call("POST", "/transport/jobs", body);
        assertThat(started.status()).as(String.valueOf(started.body())).isEqualTo(202);
        return await(started.body().get("jobId").asString());
    }

    static String body(String pkg, boolean dryRun, String previewId, List<String> flows, List<String> scripts,
                       List<String> mappings, List<String> valueMappings) {
        var selection = new LinkedHashMap<String, Object>();
        selection.put("packageId", pkg);
        selection.put("artifactIds", flows);
        selection.put("scriptCollectionIds", scripts);
        selection.put("messageMappingIds", mappings);
        selection.put("valueMappingIds", valueMappings);
        var body = new LinkedHashMap<String, Object>();
        body.put("packages", List.of(selection));
        body.put("dryRun", dryRun);
        if (previewId != null) body.put("previewId", previewId);
        return JSON.writeValueAsString(body);
    }

    static Map<String, JsonNode> byTypeAndId(JsonNode result) {
        var map = new LinkedHashMap<String, JsonNode>();
        for (var r : result.get("results")) map.put(r.get("type").asString() + ":" + r.get("artifactId").asString(), r);
        return map;
    }

    static List<String> itemKeys(JsonNode job) {
        var keys = new ArrayList<String>();
        for (var item : job.get("items")) keys.add(item.get("type").asString() + ":" + item.get("artifactId").asString());
        return keys;
    }

    static int reads(WireMockServer server, String segment, String id) {
        return server.findAll(getRequestedFor(urlEqualTo(entity(segment, id) + "/$value"))).size();
    }

    static String uploaded(String segment, String id) {
        var posts = stubs.prd().findAll(postRequestedFor(urlEqualTo(collection(segment)))
                .withRequestBody(matchingJsonPath("$.Id", equalTo(id))));
        assertThat(posts).as("POST " + segment + " " + id).hasSize(1);
        return JSON.readTree(posts.getFirst().getBodyAsString()).path("ArtifactContent").asString();
    }

    static void appendHistory(String line) throws Exception {
        Files.createDirectories(history.getParent());
        Files.writeString(history, line + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }

    // ---- 미리보기 묶음 ----

    @Test
    @DisplayName("REQ-1006: 실제 이관에 previewId가 있으면 새 종류도 미리보기 묶음 zip을 그대로 올리고 원본을 다시 읽지 않으며 reusedPreview=true")
    void reusesPreviewBundleForNewTypes() throws Exception {
        var preview = runJob(body(PKG, true, null, List.of("F1"), List.of("SC1"), List.of("MM1"), List.of("VM1")));
        assertThat(preview.get("status").asString()).isEqualTo("COMPLETED");
        String previewId = preview.at("/result/transportId").asString();
        // 미리보기 뒤 원본 zip이 바뀌어도(버전 같음) 미리보기 때 받은 zip을 올린다.
        for (String id : List.of("SC1", "MM1", "VM1")) {
            String segment = id.startsWith("SC") ? "ScriptCollection" : id.startsWith("MM") ? "MessageMapping" : "ValueMapping";
            stubs.dev().stubFor(get(urlEqualTo(entity(segment, id) + "/$value")).atPriority(1).willReturn(ok().withBody("changed-" + id)));
        }
        stubs.dev().resetRequests();

        var real = runJob(body(PKG, false, previewId, List.of("F1"), List.of("SC1"), List.of("MM1"), List.of("VM1")));
        var results = byTypeAndId(real.get("result"));
        for (String key : List.of("SCRIPT_COLLECTION:SC1", "MESSAGE_MAPPING:MM1", "VALUE_MAPPING:VM1", "INTEGRATION_FLOW:F1")) {
            assertThat(results.get(key)).as(key).isNotNull();
            assertThat(results.get(key).get("status").asString()).as(key).isEqualTo("SUCCESS");
            assertThat(results.get(key).get("reusedPreview").asBoolean()).as(key).isTrue();
        }
        assertThat(reads(stubs.dev(), "ScriptCollection", "SC1")).isZero();
        assertThat(reads(stubs.dev(), "MessageMapping", "MM1")).isZero();
        assertThat(reads(stubs.dev(), "ValueMapping", "VM1")).isZero();
        assertThat(uploaded("ScriptCollection", "SC1")).isEqualTo(b64("src-SC1"));
        assertThat(uploaded("MessageMapping", "MM1")).isEqualTo(b64("src-MM1"));
        assertThat(uploaded("ValueMapping", "VM1")).isEqualTo(b64("src-VM1"));
    }

    @Test
    @DisplayName("REQ-1006 실패: 미리보기 뒤 새 종류의 원본 버전이 바뀌면 그 아티팩트는 재사용하지 않고 원본을 다시 읽는다")
    void versionChangeDisablesReuse() throws Exception {
        String previewId = runJob(body(PKG, true, null, List.of(), List.of("SC1"), List.of(), List.of("VM1")))
                .at("/result/transportId").asString();
        sourceList(PKG, "ValueMapping", "VM1", "1.0.1");
        stubs.dev().stubFor(get(urlEqualTo(entity("ValueMapping", "VM1") + "/$value")).atPriority(1).willReturn(ok().withBody("src-VM1-v2")));
        stubs.dev().resetRequests();
        var results = byTypeAndId(runJob(body(PKG, false, previewId, List.of(), List.of("SC1"), List.of(), List.of("VM1"))).get("result"));
        assertThat(results.get("SCRIPT_COLLECTION:SC1").get("reusedPreview").asBoolean()).isTrue();
        assertThat(results.get("VALUE_MAPPING:VM1").get("reusedPreview").asBoolean()).isFalse();
        assertThat(reads(stubs.dev(), "ValueMapping", "VM1")).isEqualTo(1);
        assertThat(uploaded("ValueMapping", "VM1")).isEqualTo(b64("src-VM1-v2"));
    }

    @Test
    @DisplayName("REQ-1006: 묶음 열쇠에 종류가 들어간다 — 같은 Id·같은 버전의 스크립트 컬렉션과 메시지 매핑은 각자 자기 zip을 재사용한다")
    void bundleKeyIncludesType() throws Exception {
        String previewId = runJob(body(SAME, true, null, List.of(), List.of("Same"), List.of("Same"), List.of()))
                .at("/result/transportId").asString();
        stubs.dev().resetRequests();
        var results = byTypeAndId(runJob(body(SAME, false, previewId, List.of(), List.of("Same"), List.of("Same"), List.of())).get("result"));
        assertThat(results.get("SCRIPT_COLLECTION:Same").get("reusedPreview").asBoolean()).isTrue();
        assertThat(results.get("MESSAGE_MAPPING:Same").get("reusedPreview").asBoolean()).isTrue();
        assertThat(uploaded("ScriptCollection", "Same")).isEqualTo(b64("sc-same"));
        assertThat(uploaded("MessageMapping", "Same")).isEqualTo(b64("mm-same"));
    }

    // ---- 다시 이관 ----

    @Test
    @DisplayName("REQ-1006: 다시 이관은 실패한 새 종류를 종류째 다시 보내고(iFlow로 보내지 않음) 성공한 iFlow는 빼며, summary는 모든 종류를 합친다")
    void retryKeepsTypes() throws Exception {
        var prd = stubs.prd();
        var failScript = prd.stubFor(post(urlEqualTo(collection("ScriptCollection"))).atPriority(1)
                .withRequestBody(matchingJsonPath("$.Id", equalTo("SC1"))).willReturn(aResponse().withStatus(400)));
        var failValue = prd.stubFor(post(urlEqualTo(collection("ValueMapping"))).atPriority(1)
                .withRequestBody(matchingJsonPath("$.Id", equalTo("VM1"))).willReturn(aResponse().withStatus(400)));
        var original = runJob(body(PKG, false, null, List.of("F1"), List.of("SC1"), List.of("MM1"), List.of("VM1")));
        var summary = original.at("/result/summary");
        assertThat(summary.get("total").asInt()).isEqualTo(4);
        assertThat(summary.get("succeeded").asInt()).isEqualTo(2);
        assertThat(summary.get("failed").asInt()).isEqualTo(2);
        assertThat(summary.get("fixRequired").asInt()).isEqualTo(2);
        String transportId = original.at("/result/transportId").asString();
        prd.removeStub(failScript);
        prd.removeStub(failValue);
        stubs.dev().resetRequests();

        var reply = call("POST", "/transport/jobs/retry", JSON.writeValueAsString(Map.of("transportId", transportId)));
        assertThat(reply.status()).as(String.valueOf(reply.body())).isEqualTo(202);
        assertThat(reply.body().get("total").asInt()).isEqualTo(2);
        var again = await(reply.body().get("jobId").asString());
        assertThat(itemKeys(again)).containsExactly("SCRIPT_COLLECTION:SC1", "VALUE_MAPPING:VM1");
        assertThat(again.get("status").asString()).isEqualTo("COMPLETED");
        var results = byTypeAndId(again.get("result"));
        assertThat(results.get("SCRIPT_COLLECTION:SC1").get("status").asString()).isEqualTo("SUCCESS");
        assertThat(results.get("VALUE_MAPPING:VM1").get("status").asString()).isEqualTo("SUCCESS");
        assertThat(again.at("/result/retryOf").asString()).isEqualTo(transportId);
        // 성공한 iFlow F1·메시지 매핑 MM1은 다시 읽지 않는다. iFlow 목록에서 SC1·VM1을 찾지도 않는다.
        assertThat(reads(stubs.dev(), "Integration", "F1")).isZero();
        assertThat(reads(stubs.dev(), "MessageMapping", "MM1")).isZero();
        assertThat(stubs.dev().findAll(getRequestedFor(urlMatching(".*IntegrationDesigntimeArtifacts\\(Id='(SC1|VM1)'.*")))).isEmpty();
    }

    @Test
    @DisplayName("REQ-1006: 다시 이관은 건너뜀(skipped)의 종류도 지켜 처리 단계 순서로 다시 보낸다")
    void retrySkippedKeepsTypes() throws Exception {
        appendHistory("{\"transportId\":\"t-obj-cancelled\",\"packages\":[{\"packageId\":\"" + PKG + "\",\"packageName\":\"" + PKG
                + "\",\"targetPackage\":\"EXISTING\"}],\"dryRun\":false,\"deploy\":false,\"startedAt\":\"2026-11-21T00:00:00Z\","
                + "\"finishedAt\":\"2026-11-21T00:00:05Z\",\"summary\":{\"total\":2,\"succeeded\":1,\"failed\":1,\"fixRequired\":0,"
                + "\"retryable\":1,\"skipped\":2},\"results\":["
                + "{\"type\":\"SCRIPT_COLLECTION\",\"packageId\":\"" + PKG + "\",\"artifactId\":\"SC1\",\"status\":\"SUCCESS\",\"action\":\"CREATED\","
                + "\"configurations\":[],\"deployStatus\":\"NOT_REQUESTED\",\"error\":null,\"grade\":\"SUCCESS\"},"
                + "{\"type\":\"MESSAGE_MAPPING\",\"packageId\":\"" + PKG + "\",\"artifactId\":\"MM1\",\"status\":\"FAILED\",\"action\":\"NONE\","
                + "\"configurations\":[],\"deployStatus\":\"NOT_REQUESTED\",\"error\":{\"code\":\"UPLOAD_FAILED\",\"message\":\"UPLOAD: HTTP 500; CPI call failed\"},"
                + "\"grade\":\"RETRYABLE\"}],\"jobStatus\":\"CANCELLED\",\"skipped\":["
                + "{\"packageId\":\"" + PKG + "\",\"artifactId\":\"F1\",\"type\":\"INTEGRATION_FLOW\"},"
                + "{\"packageId\":\"" + PKG + "\",\"artifactId\":\"VM1\",\"type\":\"VALUE_MAPPING\"}]}");
        var reply = call("POST", "/transport/jobs/retry", "{\"transportId\":\"t-obj-cancelled\"}");
        assertThat(reply.status()).as(String.valueOf(reply.body())).isEqualTo(202);
        assertThat(reply.body().get("total").asInt()).isEqualTo(3);
        var again = await(reply.body().get("jobId").asString());
        assertThat(itemKeys(again)).containsExactly("MESSAGE_MAPPING:MM1", "VALUE_MAPPING:VM1", "INTEGRATION_FLOW:F1");
        for (var r : again.at("/result/results")) assertThat(r.get("status").asString()).as(r.toString()).isEqualTo("SUCCESS");
    }

    @Test
    @DisplayName("REQ-1006 실패: 이 변경 전 이력 줄(type 없음)로 다시 이관하면 실패·건너뜀을 모두 iFlow로 보고 보낸다")
    void retryOldLineAsIflow() throws Exception {
        appendHistory("{\"transportId\":\"t-obj-old\",\"packages\":[{\"packageId\":\"" + PKG + "\",\"packageName\":\"" + PKG
                + "\",\"targetPackage\":\"EXISTING\"}],\"dryRun\":false,\"deploy\":false,\"startedAt\":\"2026-11-01T00:00:00Z\","
                + "\"finishedAt\":\"2026-11-01T00:00:05Z\",\"summary\":{\"total\":1,\"succeeded\":0,\"failed\":1},\"results\":["
                + "{\"packageId\":\"" + PKG + "\",\"artifactId\":\"F1\",\"status\":\"FAILED\",\"action\":\"NONE\",\"configurations\":[],"
                + "\"deployStatus\":\"NOT_REQUESTED\",\"error\":{\"code\":\"UPLOAD_FAILED\",\"message\":\"UPLOAD: HTTP 500; CPI call failed\"}}],"
                + "\"skipped\":[{\"packageId\":\"" + PKG + "\",\"artifactId\":\"SC1\"}]}");
        var reply = call("POST", "/transport/jobs/retry", "{\"transportId\":\"t-obj-old\"}");
        assertThat(reply.status()).as(String.valueOf(reply.body())).isEqualTo(202);
        assertThat(reply.body().get("total").asInt()).isEqualTo(2);
        var again = await(reply.body().get("jobId").asString());
        assertThat(itemKeys(again)).containsExactly("INTEGRATION_FLOW:F1", "INTEGRATION_FLOW:SC1");
        var results = byTypeAndId(again.get("result"));
        assertThat(results.get("INTEGRATION_FLOW:F1").get("status").asString()).isEqualTo("SUCCESS");
        // SC1은 iFlow로 보내므로 iFlow 목록에 없어 ARTIFACT_NOT_FOUND
        assertThat(results.get("INTEGRATION_FLOW:SC1").at("/error/code").asString()).isEqualTo("ARTIFACT_NOT_FOUND");
        assertThat(stubs.dev().findAll(getRequestedFor(urlMatching(".*/(ScriptCollection|MessageMapping|ValueMapping)DesigntimeArtifacts.*")))).isEmpty();
    }
}
