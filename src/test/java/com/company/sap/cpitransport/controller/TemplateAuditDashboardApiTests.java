package com.company.sap.cpitransport.controller;

import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.tenant.TenantStoreKeySource;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;

/**
 * 20261110-ui-refresh S1: REQ-401 템플릿, REQ-402 테넌트 삭제와 템플릿, REQ-403 이관 기록의 템플릿 연결,
 * REQ-404 감사 기록, REQ-405 대시보드 API. HTTP 블랙박스로 검증한다(CPI는 WireMock).
 * 20261118-package-autocreate-multi S2: REQ-610 템플릿은 경로만, REQ-611 기존 템플릿 1회 삭제, REQ-612 대시보드 대기 항목.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = {CpiTransportToolApplication.class, TemplateAuditDashboardApiTests.TestBeans.class})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
class TemplateAuditDashboardApiTests {
    @TempDir static Path directory;
    @LocalServerPort int port;
    static final ObjectMapper JSON = new ObjectMapper();
    static final String KEY = randomKey();
    static final ZoneId ZONE = ZoneId.systemDefault();
    static final MutableClock CLOCK = new MutableClock(LocalDate.of(2026, 11, 11).atTime(12, 0).atZone(ZONE).toInstant());
    static WireMockServer server;

    static final class MutableClock extends Clock {
        private volatile Instant now;
        MutableClock(Instant now) { this.now = now; }
        void advance(Duration duration) { now = now.plus(duration); }
        @Override public ZoneId getZone() { return ZONE; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    static String randomKey() {
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestBeans {
        @Bean @Primary TenantStoreKeySource testKey() { return () -> Optional.of(KEY); }
        @Bean @Primary Clock testClock() { return CLOCK; }
    }

    static Path templatesFile() { return directory.resolve("templates.json"); }
    static Path auditFile() { return directory.resolve("audit.jsonl"); }
    static Path historyFile() { return directory.resolve("history.jsonl"); }

    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry values) {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost")); server.start();
        stubSource(server);
        values.add("cpi.tenants.store-file", () -> directory.resolve("tenants.enc").toString());
        values.add("cpi.transport.history.file", () -> historyFile().toString());
        values.add("cpi.templates.store-file", () -> templatesFile().toString());
        values.add("cpi.audit.file", () -> auditFile().toString());
        values.add("cpi.transport.read-only", () -> "true");
        for (String env : List.of("dev", "prd")) {
            String prefix = "cpi.environments." + env + ".";
            values.add(prefix + "api-url", () -> server.baseUrl());
            values.add(prefix + "token-url", () -> server.baseUrl() + "/oauth/token");
            values.add(prefix + "client-id", () -> "test-dummy-env-client");
            values.add(prefix + "client-secret", () -> "test-dummy-env-secret");
        }
    }

    static void stubSource(WireMockServer server) {
        server.stubFor(post(urlEqualTo("/oauth/token")).willReturn(okJson("{\"access_token\":\"test-dummy-token\",\"expires_in\":3600}")));
        server.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages('Pkg')")).willReturn(okJson("{\"d\":{\"Id\":\"Pkg\",\"Name\":\"Source package\",\"Version\":\"1\"}}")));
        server.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages('Pkg')/IntegrationDesigntimeArtifacts")).willReturn(okJson("{\"d\":{\"results\":[]}}")));
    }

    @AfterAll static void stop() { if (server != null) server.stop(); }

    // ---- HTTP helpers ----

    static HttpResponse<String> request(int port, String method, String path, String body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        try (var client = HttpClient.newHttpClient()) {
            return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        }
    }
    HttpResponse<String> request(String method, String path, Object body) throws Exception {
        CLOCK.advance(Duration.ofSeconds(1));
        return request(port, method, path, body == null ? null : body instanceof String s ? s : JSON.writeValueAsString(body));
    }
    static JsonNode ok(HttpResponse<String> response, int status) {
        assertThat(response.statusCode()).as(response.body()).isEqualTo(status);
        assertThat(response.body()).doesNotContain("test-dummy-api-client", "test-dummy-api-secret", KEY);
        return JSON.readTree(response.body());
    }
    static void error(HttpResponse<String> response, int status, String code) {
        assertThat(response.statusCode()).as(response.body()).isEqualTo(status);
        assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo(code);
    }

    static ObjectNode tenantBody(String name) {
        var node = JSON.createObjectNode().put("name", name);
        var oauth = node.putObject("serviceKey").putObject("oauth");
        oauth.put("url", server.baseUrl()); oauth.put("tokenurl", server.baseUrl() + "/oauth/token");
        oauth.put("clientid", "test-dummy-api-client"); oauth.put("clientsecret", "test-dummy-api-secret");
        return node;
    }
    String tenant(String name) throws Exception {
        return ok(request("POST", "/tenants", tenantBody(name)), 201).get("id").asString();
    }
    static ObjectNode templateBody(String name, String source, String target, String packageId) {
        var node = JSON.createObjectNode().put("name", name).put("sourceTenantId", source).put("targetTenantId", target);
        if (packageId != null) node.put("packageId", packageId);
        return node;
    }
    String template(String name, String source, String target, String packageId) throws Exception {
        return ok(request("POST", "/templates", templateBody(name, source, target, packageId)), 201).get("id").asString();
    }
    JsonNode findTemplate(String id) throws Exception {
        for (JsonNode t : ok(request("GET", "/templates", null), 200)) if (t.get("id").asString().equals(id)) return t;
        return null;
    }
    List<JsonNode> audit(String category) throws Exception {
        var list = new ArrayList<JsonNode>();
        ok(request("GET", "/audit?category=" + category, null), 200).forEach(list::add);
        return list;
    }

    static String historyLine(String id, String pkg, boolean dryRun, String src, String srcName, String tgt, String tgtName,
                              Instant startedAt, int total, int failed) {
        var node = JSON.createObjectNode();
        node.put("transportId", id).put("packageId", pkg).put("dryRun", dryRun).put("deploy", false)
                .put("startedAt", startedAt.toString()).put("finishedAt", startedAt.toString());
        node.putObject("summary").put("total", total).put("succeeded", total - failed).put("failed", failed);
        var results = node.putArray("results");
        for (int i = 0; i < total; i++) {
            var r = results.addObject().put("artifactId", pkg + "_A" + i).put("status", i < failed ? "FAILED" : "SUCCESS");
            if (i < failed) r.putObject("error").put("code", "UPLOAD_FAILED").put("message", "TARGET: HTTP 500; CPI call failed");
        }
        node.putObject("sourceTenant").put("id", src).put("name", srcName);
        node.putObject("targetTenant").put("id", tgt).put("name", tgtName);
        return JSON.writeValueAsString(node);
    }

    /** 새 형식(묶음) 이력 줄: packages[]와 결과마다 packageId. 패키지마다 {아티팩트 수, 실패 수}. */
    static String bundleLine(String id, boolean dryRun, String src, String tgt, Instant startedAt,
                             LinkedHashMap<String, int[]> perPackage) {
        return bundleLine(id, dryRun, src, tgt, startedAt, perPackage, Map.of());
    }

    /** targetStatus에 없는 패키지는 dryRun이면 NOT_CHECKED, 아니면 EXISTING. */
    static String bundleLine(String id, boolean dryRun, String src, String tgt, Instant startedAt,
                             LinkedHashMap<String, int[]> perPackage, Map<String, String> targetStatus) {
        var node = JSON.createObjectNode();
        node.put("transportId", id).put("dryRun", dryRun).put("deploy", false)
                .put("startedAt", startedAt.toString()).put("finishedAt", startedAt.toString());
        var packages = node.putArray("packages");
        var results = node.putArray("results");
        int total = 0, failed = 0;
        for (var e : perPackage.entrySet()) {
            packages.addObject().put("packageId", e.getKey()).put("packageName", e.getKey() + " name")
                    .put("targetPackage", targetStatus.getOrDefault(e.getKey(), dryRun ? "NOT_CHECKED" : "EXISTING"));
            for (int i = 0; i < e.getValue()[0]; i++) {
                boolean bad = i < e.getValue()[1];
                var r = results.addObject().put("packageId", e.getKey()).put("artifactId", e.getKey() + "_A" + i)
                        .put("status", bad ? "FAILED" : "SUCCESS");
                if (bad) r.putObject("error").put("code", "UPLOAD_FAILED").put("message", "TARGET: HTTP 500; CPI call failed");
            }
            total += e.getValue()[0];
            failed += e.getValue()[1];
        }
        node.putObject("summary").put("total", total).put("succeeded", total - failed).put("failed", failed);
        node.putObject("sourceTenant").put("id", src).put("name", src);
        node.putObject("targetTenant").put("id", tgt).put("name", tgt);
        return JSON.writeValueAsString(node);
    }

    // ---- REQ-401 템플릿 저장 ----

    @Test @DisplayName("REQ-401·REQ-610: 생성 응답 필드(패키지 없음), 목록, 수정 시 updatedAt 갱신, 삭제 204")
    void req401_crud() throws Exception {
        server.resetRequests();
        var created = ok(request("POST", "/templates", templateBody("CRUD template", "DEV", "PRD", "Pkg")), 201);
        assertThat(created.propertyNames()).contains("id", "name", "sourceTenantId", "targetTenantId",
                "createdAt", "updatedAt", "usable").doesNotContain("packageId");
        assertThat(created.get("name").asString()).isEqualTo("CRUD template");
        assertThat(created.get("sourceTenantId").asString()).isEqualTo("DEV");
        assertThat(created.get("targetTenantId").asString()).isEqualTo("PRD");
        assertThat(created.get("usable").asBoolean()).isTrue();
        Instant createdAt = Instant.parse(created.get("createdAt").asString());
        Instant updatedAt = Instant.parse(created.get("updatedAt").asString());
        String id = created.get("id").asString();

        var noPackage = ok(request("POST", "/templates", templateBody("CRUD no package", "DEV", "PRD", null)), 201);
        assertThat(noPackage.has("packageId")).isFalse();

        assertThat(findTemplate(id)).isNotNull();
        assertThat(findTemplate(id).has("packageId")).isFalse();
        var updated = ok(request("PUT", "/templates/" + id, templateBody("CRUD renamed", "PRD", "DEV", "Pkg")), 200);
        assertThat(updated.get("name").asString()).isEqualTo("CRUD renamed");
        assertThat(updated.get("sourceTenantId").asString()).isEqualTo("PRD");
        assertThat(updated.has("packageId")).isFalse();
        assertThat(Instant.parse(updated.get("createdAt").asString())).isEqualTo(createdAt);
        assertThat(Instant.parse(updated.get("updatedAt").asString())).isAfter(updatedAt);
        var reread = findTemplate(id);
        assertThat(reread.get("name").asString()).isEqualTo("CRUD renamed");
        assertThat(reread.get("targetTenantId").asString()).isEqualTo("DEV");
        assertThat(reread.has("packageId")).isFalse();

        var deleted = request("DELETE", "/templates/" + id, null);
        assertThat(deleted.statusCode()).isEqualTo(204);
        assertThat(findTemplate(id)).isNull();
        assertThat(server.getAllServeEvents()).isEmpty();
    }

    @Test @DisplayName("REQ-610: 보낸 패키지 필드는 형식과 관계없이 무시하고 저장 파일에도 남기지 않는다")
    void req610_packageIgnored() throws Exception {
        var values = List.<JsonNode>of(JSON.getNodeFactory().numberNode(123), JSON.createArrayNode().add("P1"),
                JSON.getNodeFactory().stringNode(""), JSON.getNodeFactory().stringNode("Pkg"));
        for (int i = 0; i < values.size(); i++) {
            var value = values.get(i);
            var body = templateBody("Ignore package " + i, "DEV", "PRD", null);
            body.set("packageId", value);
            var created = ok(request("POST", "/templates", body), 201);
            assertThat(created.has("packageId")).as(value.toString()).isFalse();
            var updated = ok(request("PUT", "/templates/" + created.get("id").asString(), body), 200);
            assertThat(updated.has("packageId")).as(value.toString()).isFalse();
        }
        // 같은 이름 규칙은 그대로
        error(request("POST", "/templates", templateBody("ignore package 3", "DEV", "PRD", "Pkg")), 409, "TEMPLATE_NAME_DUPLICATE");
        assertThat(Files.readString(templatesFile(), StandardCharsets.UTF_8)).doesNotContain("packageId");
    }

    @Test @DisplayName("REQ-401: 검증 실패 400, 대소문자 무시 이름 중복 409, 없는 ID 404, 저장하지 않음")
    void req401_validation() throws Exception {
        String existing = template("Validation Base", "DEV", "PRD", null);
        int before = ok(request("GET", "/templates", null), 200).size();
        for (String name : List.of("", "   ", "a".repeat(61))) {
            error(request("POST", "/templates", templateBody(name, "DEV", "PRD", null)), 400, "INVALID_REQUEST");
        }
        error(request("POST", "/templates", templateBody("Same tenant", "DEV", "DEV", null)), 400, "INVALID_REQUEST");
        error(request("POST", "/templates", templateBody("Unknown source", "missing-tenant", "PRD", null)), 400, "INVALID_REQUEST");
        error(request("POST", "/templates", templateBody("Unknown target", "DEV", "missing-tenant", null)), 400, "INVALID_REQUEST");
        error(request("POST", "/templates", "not JSON"), 400, "INVALID_REQUEST");
        error(request("POST", "/templates", templateBody("validation base", "PRD", "DEV", null)), 409, "TEMPLATE_NAME_DUPLICATE");
        assertThat(ok(request("GET", "/templates", null), 200).size()).isEqualTo(before);

        ok(request("POST", "/templates", templateBody("a".repeat(60), "DEV", "PRD", null)), 201);
        String other = template("Validation Other", "DEV", "PRD", null);
        error(request("PUT", "/templates/" + other, templateBody("VALIDATION BASE", "DEV", "PRD", null)), 409, "TEMPLATE_NAME_DUPLICATE");
        error(request("PUT", "/templates/" + other, templateBody("Validation Other", "PRD", "PRD", null)), 400, "INVALID_REQUEST");
        assertThat(findTemplate(other).get("name").asString()).isEqualTo("Validation Other");
        // 자기 자신과의 대소문자 차이는 중복이 아니다
        ok(request("PUT", "/templates/" + existing, templateBody("VALIDATION BASE", "DEV", "PRD", null)), 200);

        error(request("PUT", "/templates/missing-template", templateBody("Missing", "DEV", "PRD", null)), 404, "TEMPLATE_NOT_FOUND");
        error(request("DELETE", "/templates/missing-template", null), 404, "TEMPLATE_NOT_FOUND");
    }

    @Test @DisplayName("REQ-401: 앱 재시작 뒤에도 생성·수정 값이 남는다")
    void req401_restart() throws Exception {
        String id = template("Restart template", "DEV", "PRD", "Pkg");
        ok(request("PUT", "/templates/" + id, templateBody("Restart template v2", "DEV", "PRD", "Pkg")), 200);
        try (var context = start(templatesFile(), auditFile())) {
            var list = ok(request(port(context), "GET", "/templates", null), 200);
            JsonNode found = null;
            for (JsonNode t : list) if (t.get("id").asString().equals(id)) found = t;
            assertThat(found).isNotNull();
            assertThat(found.get("name").asString()).isEqualTo("Restart template v2");
            assertThat(found.has("packageId")).isFalse();
        }
    }

    // ---- REQ-611 기존 템플릿 1회 삭제 ----

    /** 이전 버전이 쓰던 저장 파일 형식: 항목마다 packageId 키(값이 null이어도 있음). */
    static String legacyTemplates(String... namesAndPackages) {
        var array = JSON.createArrayNode();
        for (int i = 0; i < namesAndPackages.length; i += 2) {
            var node = array.addObject().put("id", "legacy-" + i).put("name", namesAndPackages[i])
                    .put("sourceTenantId", "DEV").put("targetTenantId", "PRD");
            if (namesAndPackages[i + 1] == null) node.putNull("packageId"); else node.put("packageId", namesAndPackages[i + 1]);
            node.put("createdAt", "2026-11-01T00:00:00Z").put("updatedAt", "2026-11-02T00:00:00Z");
        }
        return JSON.writeValueAsString(array);
    }
    static List<JsonNode> auditLines(Path file) throws Exception {
        if (!Files.exists(file)) return List.of();
        return Files.readAllLines(file, StandardCharsets.UTF_8).stream().filter(l -> !l.isBlank()).map(JSON::readTree).toList();
    }
    static List<JsonNode> upgradeDeletions(Path file) throws Exception {
        return auditLines(file).stream().filter(l -> l.get("category").asString().equals("template")
                && l.get("action").asString().equals("deleted")
                && l.get("detail").asString().contains("업그레이드로 삭제")).toList();
    }

    @Test @DisplayName("REQ-611: 첫 기동에 이전 형식 템플릿이 있으면 모두 지우고 삭제마다 감사 이력(이름, 업그레이드로 삭제)을 남기며 이관 이력의 템플릿 이름은 그대로다")
    void req611_upgradeDeletesLegacyTemplates() throws Exception {
        Path dir = Files.createDirectories(directory.resolve("upgrade-legacy"));
        Path templates = dir.resolve("templates.json"), audit = dir.resolve("audit.jsonl");
        Files.writeString(templates, legacyTemplates("Legacy with package", "Pkg", "Legacy no package", null), StandardCharsets.UTF_8);
        Path history = directory.resolve("restart-history.jsonl");
        var linked = (ObjectNode) JSON.readTree(historyLine("upgrade-linked", "Pkg", true, "DEV", "DEV", "PRD", "PRD", CLOCK.instant(), 1, 0));
        linked.putObject("template").put("id", "legacy-0").put("name", "Legacy with package");
        Files.writeString(history, JSON.writeValueAsString(linked) + "\n", StandardCharsets.UTF_8);
        try (var context = start(templates, audit)) {
            int p = port(context);
            assertThat(ok(request(p, "GET", "/templates", null), 200).size()).isZero();
            var deletions = upgradeDeletions(audit);
            assertThat(deletions).extracting(l -> l.get("objectName").asString())
                    .containsExactlyInAnyOrder("Legacy with package", "Legacy no package");
            assertThat(deletions).extracting(l -> l.get("objectId").asString()).containsExactlyInAnyOrder("legacy-0", "legacy-2");
            var categoryView = ok(request(p, "GET", "/audit?category=template", null), 200);
            assertThat(categoryView).anySatisfy(e -> assertThat(e.get("detail").asString()).contains("업그레이드로 삭제"));
            JsonNode entry = null;
            for (JsonNode h : ok(request(p, "GET", "/transport/history", null), 200))
                if (h.get("transportId").asString().equals("upgrade-linked")) entry = h;
            assertThat(entry).isNotNull();
            assertThat(entry.get("template").get("name").asString()).isEqualTo("Legacy with package");
        } finally {
            Files.deleteIfExists(history);
        }
        assertThat(Files.readString(templates, StandardCharsets.UTF_8)).doesNotContain("packageId", "Legacy");
    }

    @Test @DisplayName("REQ-611: 한 번만 지운다. 업그레이드 뒤 새로 만든 템플릿은 재기동해도 남고 삭제 감사 이력이 늘지 않는다")
    void req611_onlyOnce() throws Exception {
        Path dir = Files.createDirectories(directory.resolve("upgrade-once"));
        Path templates = dir.resolve("templates.json"), audit = dir.resolve("audit.jsonl");
        Files.writeString(templates, legacyTemplates("Once legacy", null), StandardCharsets.UTF_8);
        String id;
        try (var context = start(templates, audit)) {
            int p = port(context);
            assertThat(ok(request(p, "GET", "/templates", null), 200).size()).isZero();
            id = ok(request(p, "POST", "/templates", JSON.writeValueAsString(
                    templateBody("After upgrade", "DEV", "PRD", "Pkg"))), 201).get("id").asString();
        }
        assertThat(upgradeDeletions(audit)).hasSize(1);
        for (int restart = 0; restart < 2; restart++) {
            try (var context = start(templates, audit)) {
                var list = ok(request(port(context), "GET", "/templates", null), 200);
                assertThat(list).singleElement().satisfies(t -> {
                    assertThat(t.get("id").asString()).isEqualTo(id);
                    assertThat(t.get("name").asString()).isEqualTo("After upgrade");
                    assertThat(t.has("packageId")).isFalse();
                });
            }
        }
        assertThat(upgradeDeletions(audit)).hasSize(1);
    }

    @Test @DisplayName("REQ-611 실패: 저장 파일을 읽지 못하면 지우지 않고 앱은 기동하며 템플릿 API는 TEMPLATE_STORE_UNREADABLE이다")
    void req611_unreadableStoreNotDeleted() throws Exception {
        Path dir = Files.createDirectories(directory.resolve("upgrade-unreadable"));
        Path templates = dir.resolve("templates.json"), audit = dir.resolve("audit.jsonl");
        Files.writeString(templates, "[{\"id\":\"x\",\"packageId\":", StandardCharsets.UTF_8);
        byte[] original = Files.readAllBytes(templates);
        try (var context = start(templates, audit)) {
            error(request(port(context), "GET", "/templates", null), 500, "TEMPLATE_STORE_UNREADABLE");
        }
        assertThat(Files.readAllBytes(templates)).isEqualTo(original);
        assertThat(upgradeDeletions(audit)).isEmpty();
    }

    @Test @DisplayName("REQ-611 실패: 저장 파일을 쓰지 못하면 지우지 않고(파일 그대로, 삭제 감사 이력 없음) 앱은 기동한다")
    void req611_unwritableStoreNotDeleted() throws Exception {
        Path dir = Files.createDirectories(directory.resolve("upgrade-unwritable"));
        Path templates = dir.resolve("templates.json"), audit = directory.resolve("upgrade-unwritable-audit.jsonl");
        Files.writeString(templates, legacyTemplates("Unwritable legacy", "Pkg"), StandardCharsets.UTF_8);
        byte[] original = Files.readAllBytes(templates);
        assertThat(templates.toFile().setWritable(false)).isTrue();
        dir.toFile().setWritable(false);
        try (var context = start(templates, audit)) {
            assertThat(request(port(context), "GET", "/tenants", null).statusCode()).isEqualTo(200);
        } finally {
            dir.toFile().setWritable(true);
            templates.toFile().setWritable(true);
        }
        assertThat(Files.readAllBytes(templates)).isEqualTo(original);
        assertThat(upgradeDeletions(audit)).isEmpty();
    }

    @Test @DisplayName("REQ-401·REQ-405: 형식이 깨진 저장 파일은 500 TEMPLATE_STORE_UNREADABLE이고 덮어쓰지 않는다")
    void req401_unreadableStore() throws Exception {
        Path broken = directory.resolve("broken-templates.json");
        Files.writeString(broken, "{ not json", StandardCharsets.UTF_8);
        byte[] original = Files.readAllBytes(broken);
        try (var context = start(broken, directory.resolve("broken-audit.jsonl"))) {
            int p = port(context);
            error(request(p, "GET", "/templates", null), 500, "TEMPLATE_STORE_UNREADABLE");
            error(request(p, "POST", "/templates", JSON.writeValueAsString(templateBody("Broken", "DEV", "PRD", null))),
                    500, "TEMPLATE_STORE_UNREADABLE");
            error(request(p, "PUT", "/templates/any", JSON.writeValueAsString(templateBody("Broken", "DEV", "PRD", null))),
                    500, "TEMPLATE_STORE_UNREADABLE");
            error(request(p, "DELETE", "/templates/any", null), 500, "TEMPLATE_STORE_UNREADABLE");
            error(request(p, "GET", "/dashboard", null), 500, "TEMPLATE_STORE_UNREADABLE");
        }
        assertThat(Files.readAllBytes(broken)).isEqualTo(original);
    }

    @Test @DisplayName("REQ-401: 원본·대상 테넌트가 없어지면 usable=false와 이유")
    void req401_unusable() throws Exception {
        String a = tenant("Unusable A");
        String b = tenant("Unusable B");
        String sourceGone = template("Unusable source gone", a, "PRD", null);
        String targetGone = template("Unusable target gone", "DEV", b, null);
        assertThat(request("DELETE", "/tenants/" + a, null).statusCode()).isEqualTo(204);
        assertThat(request("DELETE", "/tenants/" + b, null).statusCode()).isEqualTo(204);
        var s = findTemplate(sourceGone);
        assertThat(s.get("usable").asBoolean()).isFalse();
        assertThat(s.get("unusableReason").asString()).isEqualTo("SOURCE_TENANT_MISSING");
        var t = findTemplate(targetGone);
        assertThat(t.get("usable").asBoolean()).isFalse();
        assertThat(t.get("unusableReason").asString()).isEqualTo("TARGET_TENANT_MISSING");
    }

    // ---- REQ-402 테넌트 삭제와 템플릿 ----

    @Test @DisplayName("REQ-402: 기본 삭제는 템플릿을 남기고, deleteTemplates=true는 함께 지우며 감사 기록을 남긴다")
    void req402_deleteOptions() throws Exception {
        String keep = tenant("Delete keep");
        String kept = template("Delete keep template", keep, "PRD", null);
        assertThat(request("DELETE", "/tenants/" + keep, null).statusCode()).isEqualTo(204);
        assertThat(findTemplate(kept)).isNotNull();
        assertThat(findTemplate(kept).get("usable").asBoolean()).isFalse();

        String drop = tenant("Delete drop");
        String asSource = template("Delete drop as source", drop, "PRD", null);
        String asTarget = template("Delete drop as target", "DEV", drop, null);
        String unrelated = template("Delete drop unrelated", "DEV", "PRD", null);
        assertThat(request("DELETE", "/tenants/" + drop + "?deleteTemplates=true", null).statusCode()).isEqualTo(204);
        assertThat(findTemplate(asSource)).isNull();
        assertThat(findTemplate(asTarget)).isNull();
        assertThat(findTemplate(unrelated)).isNotNull();
        var deletions = audit("template").stream()
                .filter(e -> e.get("action").asString().equals("deleted")).map(e -> e.get("objectId").asString()).toList();
        assertThat(deletions).contains(asSource, asTarget).doesNotContain(unrelated);
    }

    @Test @DisplayName("REQ-402: 없는 테넌트와 env 테넌트 삭제는 기존 오류이고 템플릿을 지우지 않는다")
    void req402_failures() throws Exception {
        String envTemplate = template("Delete env template", "DEV", "PRD", null);
        error(request("DELETE", "/tenants/missing?deleteTemplates=true", null), 404, "TENANT_NOT_FOUND");
        error(request("DELETE", "/tenants/DEV?deleteTemplates=true", null), 409, "TENANT_READ_ONLY");
        assertThat(findTemplate(envTemplate)).isNotNull();
        assertThat(findTemplate(envTemplate).get("usable").asBoolean()).isTrue();
    }

    @Test @DisplayName("REQ-402 (리뷰 결함): deleteTemplates=true에서 템플릿 저장이 실패하면 500이고 테넌트는 지우지 않는다(일부만 적용하지 않음)")
    void req402_templateWriteFailure() throws Exception {
        Path dir = Files.createDirectories(directory.resolve("unwritable-templates"));
        Path file = dir.resolve("templates.json");
        try (var context = start(file, directory.resolve("unwritable-audit.jsonl"))) {
            int p = port(context);
            String id = ok(request(p, "POST", "/tenants", JSON.writeValueAsString(tenantBody("Write failure tenant"))), 201).get("id").asString();
            ok(request(p, "POST", "/templates", JSON.writeValueAsString(templateBody("Write failure template", id, "PRD", null))), 201);
            // 읽기는 되고 쓰기만 실패하게 한다(Windows는 읽기 전용 파일 교체 실패, POSIX는 폴더 쓰기 금지로 임시 파일 생성 실패).
            assertThat(file.toFile().setWritable(false)).isTrue();
            dir.toFile().setWritable(false);
            try {
                error(request(p, "DELETE", "/tenants/" + id + "?deleteTemplates=true", null), 500, "TEMPLATE_STORE_UNREADABLE");
                var ids = new ArrayList<String>();
                ok(request(p, "GET", "/tenants", null), 200).get("tenants").forEach(t -> ids.add(t.get("id").asString()));
                assertThat(ids).as("템플릿을 지우지 못했으면 테넌트도 남아 있다").contains(id);
                var names = new ArrayList<String>();
                ok(request(p, "GET", "/templates", null), 200).forEach(t -> names.add(t.get("name").asString()));
                assertThat(names).contains("Write failure template");
            } finally {
                dir.toFile().setWritable(true);
                file.toFile().setWritable(true);
                request(p, "DELETE", "/tenants/" + id + "?deleteTemplates=true", null);
            }
        }
    }

    @Test @DisplayName("REQ-402 (리뷰 2차): 함께 삭제에서 테넌트 저장소 쓰기가 실패하면 템플릿도 지우지 않는다(전부 적용 또는 전부 안 함)")
    void req402_tenantWriteFailure() throws Exception {
        Path dir = Files.createDirectories(directory.resolve("tenant-write-failure"));
        // start()의 컨텍스트는 테넌트 저장소로 other-tenants.enc를 쓴다. Windows에서 읽기 전용 파일은 교체(쓰기)가 실패한다.
        Path tenantsFile = directory.resolve("other-tenants.enc");
        try (var context = start(dir.resolve("templates.json"), dir.resolve("audit.jsonl"))) {
            int p = port(context);
            String id = ok(request(p, "POST", "/tenants", JSON.writeValueAsString(tenantBody("Tenant write failure"))), 201).get("id").asString();
            ok(request(p, "POST", "/templates", JSON.writeValueAsString(templateBody("Tenant write failure template", id, "PRD", null))), 201);
            assertThat(tenantsFile.toFile().setWritable(false)).isTrue();
            try {
                // 테넌트 저장소 쓰기 실패는 기존 오류 계약 그대로(409 TENANT_STORE_UNREADABLE)
                error(request(p, "DELETE", "/tenants/" + id + "?deleteTemplates=true", null), 409, "TENANT_STORE_UNREADABLE");
                var ids = new ArrayList<String>();
                ok(request(p, "GET", "/tenants", null), 200).get("tenants").forEach(t -> ids.add(t.get("id").asString()));
                assertThat(ids).as("테넌트는 남아 있다").contains(id);
                var names = new ArrayList<String>();
                ok(request(p, "GET", "/templates", null), 200).forEach(t -> names.add(t.get("name").asString()));
                assertThat(names).as("테넌트를 지우지 못했으면 템플릿도 남아 있다").contains("Tenant write failure template");
            } finally {
                tenantsFile.toFile().setWritable(true);
                request(p, "DELETE", "/tenants/" + id + "?deleteTemplates=true", null);
            }
        }
    }

    @Test @DisplayName("REQ-402 (리뷰 2차): 함께 삭제와 같은 테넌트로의 템플릿 생성이 겹쳐도, 삭제 뒤 그 테넌트를 가리키는 템플릿이 남지 않는다")
    void req402_concurrentCreate() throws Exception {
        for (int round = 0; round < 5; round++) {
            final int r = round;
            String id = tenant("Race tenant " + r);
            var pool = Executors.newFixedThreadPool(8);
            var gate = new CountDownLatch(1);
            var futures = new ArrayList<Future<HttpResponse<String>>>();
            for (int i = 0; i < 6; i++) {
                final int n = i;
                futures.add(pool.submit(() -> {
                    gate.await();
                    return request(port, "POST", "/templates", JSON.writeValueAsString(templateBody("Race " + r + "-" + n, id, "PRD", null)));
                }));
            }
            futures.add(pool.submit(() -> {
                gate.await();
                return request(port, "DELETE", "/tenants/" + id + "?deleteTemplates=true", null);
            }));
            gate.countDown();
            for (var f : futures) f.get(60, TimeUnit.SECONDS);
            pool.shutdown();
            assertThat(futures.get(futures.size() - 1).get().statusCode()).isEqualTo(204);
            for (JsonNode t : ok(request("GET", "/templates", null), 200)) {
                assertThat(t.get("sourceTenantId").asString()).as("round %d: %s", r, t.get("name").asString()).isNotEqualTo(id);
            }
        }
    }

    // ---- REQ-403 이관 기록의 템플릿 연결 ----

    @Test @DisplayName("REQ-403: templateId가 맞으면 응답·이력에 실행 당시 template {id,name}, 없으면 필드 없음")
    void req403_templateLink() throws Exception {
        Files.deleteIfExists(historyFile());
        String id = template("Link template", "DEV", "PRD", "OtherPkg");
        var body = JSON.createObjectNode().put("packageId", "Pkg").put("dryRun", true)
                .put("sourceTenantId", "DEV").put("targetTenantId", "PRD").put("templateId", id);
        var linked = ok(request("POST", "/transport", body), 200);
        assertThat(linked.get("template").get("id").asString()).isEqualTo(id);
        assertThat(linked.get("template").get("name").asString()).isEqualTo("Link template");
        String linkedId = linked.get("transportId").asString();

        ok(request("PUT", "/templates/" + id, templateBody("Link template renamed", "DEV", "PRD", "OtherPkg")), 200);
        var plain = ok(request("POST", "/transport", JSON.createObjectNode().put("packageId", "Pkg").put("dryRun", true)), 200);
        assertThat(plain.has("template")).isFalse();

        var history = ok(request("GET", "/transport/history", null), 200);
        for (JsonNode entry : history) {
            if (entry.get("transportId").asString().equals(linkedId)) {
                assertThat(entry.get("template").get("name").asString()).isEqualTo("Link template");
            } else {
                assertThat(entry.has("template")).isFalse();
            }
        }
        assertThat(Files.readAllLines(historyFile())).hasSize(2)
                .anySatisfy(line -> assertThat(line).contains("\"template\"").contains("Link template"))
                .anySatisfy(line -> assertThat(line).doesNotContain("\"template\""));
    }

    @Test @DisplayName("REQ-403: 없는 템플릿 404, 사용 불가·경로 불일치 400 TEMPLATE_MISMATCH, CPI 요청과 이력 없음")
    void req403_failures() throws Exception {
        Files.deleteIfExists(historyFile());
        String other = tenant("Mismatch other");
        String reversed = template("Mismatch reversed", "PRD", "DEV", null);
        String otherTarget = template("Mismatch other target", "DEV", other, null);
        String gone = tenant("Mismatch gone");
        String unusable = template("Mismatch unusable", "DEV", gone, null);
        assertThat(request("DELETE", "/tenants/" + gone, null).statusCode()).isEqualTo(204);
        server.resetRequests();

        var base = JSON.createObjectNode().put("packageId", "Pkg").put("dryRun", true)
                .put("sourceTenantId", "DEV").put("targetTenantId", "PRD");
        error(request("POST", "/transport", base.deepCopy().put("templateId", "missing-template")), 404, "TEMPLATE_NOT_FOUND");
        error(request("POST", "/transport", base.deepCopy().put("templateId", reversed)), 400, "TEMPLATE_MISMATCH");
        error(request("POST", "/transport", base.deepCopy().put("templateId", otherTarget)), 400, "TEMPLATE_MISMATCH");
        var toGone = base.deepCopy().put("targetTenantId", "PRD").put("templateId", unusable);
        error(request("POST", "/transport", toGone), 400, "TEMPLATE_MISMATCH");
        assertThat(server.getAllServeEvents()).isEmpty();
        assertThat(Files.exists(historyFile())).isFalse();
    }

    // ---- REQ-404 감사 기록 ----

    @Test @DisplayName("REQ-404: 테넌트·템플릿 변경이 audit.jsonl에 남고, 서비스 키 교체는 내용 없이 기록된다")
    void req404_records() throws Exception {
        String id = tenant("Audit tenant");
        ok(request("PUT", "/tenants/" + id, JSON.createObjectNode().put("name", "Audit tenant 2")), 200);
        var keyChange = JSON.createObjectNode();
        var oauth = keyChange.putObject("serviceKey").putObject("oauth");
        oauth.put("url", server.baseUrl()); oauth.put("tokenurl", server.baseUrl() + "/oauth/token");
        oauth.put("clientid", "test-dummy-new-client"); oauth.put("clientsecret", "test-dummy-new-secret");
        ok(request("PUT", "/tenants/" + id, keyChange), 200);
        String t = template("Audit template", id, "PRD", null);
        ok(request("PUT", "/templates/" + t, templateBody("Audit template 2", id, "PRD", null)), 200);
        assertThat(request("DELETE", "/templates/" + t, null).statusCode()).isEqualTo(204);
        assertThat(request("DELETE", "/tenants/" + id, null).statusCode()).isEqualTo(204);

        var lines = Files.readAllLines(auditFile(), StandardCharsets.UTF_8).stream().filter(l -> !l.isBlank())
                .map(JSON::readTree).toList();
        for (JsonNode line : lines) {
            assertThat(line.propertyNames()).contains("id", "time", "category", "action", "objectId", "objectName", "detail");
            assertThat(line.get("category").asString()).isIn("tenant", "template");
        }
        var mine = lines.stream().filter(l -> l.get("objectId").asString().equals(id)).toList();
        assertThat(mine).extracting(l -> l.get("action").asString()).containsExactly("created", "updated", "updated", "deleted");
        assertThat(mine).allSatisfy(l -> assertThat(l.get("category").asString()).isEqualTo("tenant"));
        assertThat(mine.get(2).get("detail").asString()).isEqualTo("서비스 키 교체");
        var templ = lines.stream().filter(l -> l.get("objectId").asString().equals(t)).toList();
        assertThat(templ).extracting(l -> l.get("action").asString()).containsExactly("created", "updated", "deleted");
        assertThat(templ).allSatisfy(l -> assertThat(l.get("category").asString()).isEqualTo("template"));
        assertThat(Files.readString(auditFile(), StandardCharsets.UTF_8)).doesNotContain(
                "test-dummy-api-client", "test-dummy-api-secret", "test-dummy-new-client", "test-dummy-new-secret",
                server.baseUrl(), "/oauth/token", KEY);
        // 이관 실행은 audit.jsonl에 쓰지 않는다
        long before = Files.readAllLines(auditFile()).size();
        ok(request("POST", "/transport", JSON.createObjectNode().put("packageId", "Pkg").put("dryRun", true)), 200);
        assertThat(Files.readAllLines(auditFile())).hasSize((int) before);
    }

    @Test @DisplayName("REQ-404: GET /audit는 감사와 이관 이력을 시간 역순으로 합치고 category로 거른다")
    void req404_query() throws Exception {
        Files.deleteIfExists(auditFile());
        Files.deleteIfExists(historyFile());
        assertThat(audit("all")).isEmpty();

        String t = template("Query template", "DEV", "PRD", null);
        Instant between = CLOCK.instant().plusMillis(500);
        CLOCK.advance(Duration.ofSeconds(2));
        Files.writeString(historyFile(), historyLine("q-preview", "QueryPkg", true, "DEV", "DEV", "PRD", "PRD", between, 2, 0) + "\n"
                + historyLine("q-real", "QueryPkg", false, "DEV", "DEV", "PRD", "PRD", CLOCK.instant(), 3, 1) + "\n");
        String tenantId = tenant("Query tenant");

        var all = audit("all");
        assertThat(all).extracting(e -> e.get("category").asString())
                .containsExactly("tenant", "transport", "transport", "template");
        var times = all.stream().map(e -> Instant.parse(e.get("time").asString())).toList();
        assertThat(times).isSortedAccordingTo(Comparator.reverseOrder());
        assertThat(all.get(0).get("objectId").asString()).isEqualTo(tenantId);
        assertThat(all.get(3).get("objectId").asString()).isEqualTo(t);

        var transports = audit("transport");
        assertThat(transports).hasSize(2);
        assertThat(transports.get(0).get("action").asString()).isEqualTo("transport");
        assertThat(transports.get(1).get("action").asString()).isEqualTo("preview");
        assertThat(transports).allSatisfy(e -> {
            assertThat(e.get("objectName").asString()).isEqualTo("QueryPkg");
            assertThat(e.get("detail").asString()).isNotBlank();
        });
        assertThat(audit("tenant")).singleElement().satisfies(e -> assertThat(e.get("action").asString()).isEqualTo("created"));
        assertThat(audit("template")).singleElement().satisfies(e -> assertThat(e.get("objectName").asString()).isEqualTo("Query template"));

        error(request("GET", "/audit?category=bogus", null), 400, "INVALID_REQUEST");
    }

    @Test @DisplayName("REQ-404: 감사 줄 쓰기 실패는 변경을 유지하고 성공 응답, 로그에 ERROR")
    void req404_writeFailure(CapturedOutput output) throws Exception {
        Path auditAsDirectory = Files.createDirectories(directory.resolve("audit-is-a-directory"));
        try (var context = start(directory.resolve("failure-templates.json"), auditAsDirectory)) {
            int p = port(context);
            var created = ok(request(p, "POST", "/templates",
                    JSON.writeValueAsString(templateBody("Audit failure template", "DEV", "PRD", null))), 201);
            var list = ok(request(p, "GET", "/templates", null), 200);
            assertThat(list).anySatisfy(t -> assertThat(t.get("id").asString()).isEqualTo(created.get("id").asString()));
            var tenant = request(p, "POST", "/tenants", JSON.writeValueAsString(tenantBody("Audit failure tenant")));
            assertThat(tenant.statusCode()).isEqualTo(201);
        }
        assertThat(output.getAll()).contains("ERROR");
        assertThat(output.getAll()).doesNotContain("test-dummy-api-secret", KEY);
    }

    @Test @DisplayName("감사 파일을 읽지 못하면 GET /audit는 500 AUDIT_STORE_UNREADABLE이고, 이관 분류만 보면 200")
    void auditReadFailure() throws Exception {
        Path auditAsDirectory = Files.createDirectories(directory.resolve("audit-read-is-a-directory"));
        try (var context = start(directory.resolve("read-failure-templates.json"), auditAsDirectory)) {
            int p = port(context);
            error(request(p, "GET", "/audit?category=all", null), 500, "AUDIT_STORE_UNREADABLE");
            error(request(p, "GET", "/audit?category=tenant", null), 500, "AUDIT_STORE_UNREADABLE");
            assertThat(request(p, "GET", "/audit?category=transport", null).statusCode()).isEqualTo(200);
        }
    }

    // ---- REQ-405 대시보드 API ----

    @Test @DisplayName("REQ-405: nodes, 사용 가능한 템플릿 경로 edges, 이력에서 계산한 대기 항목, templateId 필터")
    void req405_dashboard() throws Exception {
        String a = tenant("Dash A"), b = tenant("Dash B"), c = tenant("Dash C"), z = tenant("Dash Z");
        String x1 = template("Dash X1", a, b, null);
        String x2 = template("Dash X2", b, c, null);
        String x3 = template("Dash X3", b, c, null);
        String x4 = template("Dash X4", b, z, null);
        assertThat(request("DELETE", "/tenants/" + z, null).statusCode()).isEqualTo(204);
        var mine = Set.of(x1, x2, x3, x4);

        Instant t0 = CLOCK.instant().minus(Duration.ofDays(3));
        Instant h1 = t0.plus(Duration.ofHours(1)), h2 = t0.plus(Duration.ofHours(2));
        var lines = List.of(
                historyLine("p1-a", "P1", false, a, "Dash A", b, "Dash B", h1, 2, 0),
                historyLine("p1-b", "P1", false, a, "Dash A", b, "Dash B", h2, 3, 0),
                historyLine("p2-a", "P2", false, a, "Dash A", b, "Dash B", h1, 1, 0),
                historyLine("p2-b", "P2", false, b, "Dash B", c, "Dash C", h2, 1, 0),
                historyLine("p3-a", "P3", false, a, "Dash A", b, "Dash B", h1, 2, 1),
                historyLine("p4-a", "P4", true, a, "Dash A", b, "Dash B", h1, 2, 0),
                historyLine("p5-a", "P5", false, a, "Dash A", b, "Dash B", h1, 1, 0),
                historyLine("p5-b", "P5", false, b, "Dash B", c, "Dash C", h2, 1, 1),
                historyLine("p6-a", "P6", false, b, "Dash B", c, "Dash C", h1, 1, 0),
                historyLine("p6-b", "P6", false, a, "Dash A", b, "Dash B", h2, 1, 0),
                historyLine("only-a", "Only", false, a, "Dash A", b, "Dash B", h1, 4, 0),
                historyLine("p7-a", "P7", false, b, "Dash B", c, "Dash C", h1, 1, 0),
                historyLine("p8-a", "P8", false, a, "Dash A", b, "Dash B", h1, 1, 0),
                historyLine("p8-b", "P8", true, b, "Dash B", c, "Dash C", h2, 1, 0));
        Files.write(historyFile(), lines, StandardCharsets.UTF_8);

        var dashboard = ok(request("GET", "/dashboard", null), 200);
        assertThat(dashboard.propertyNames()).contains("nodes", "edges", "queue", "today");
        var nodes = new HashMap<String, String>();
        dashboard.get("nodes").forEach(n -> nodes.put(n.get("id").asString(), n.get("origin").asString()));
        assertThat(nodes).containsEntry("DEV", "env").containsEntry("PRD", "env")
                .containsEntry(a, "registered").containsEntry(b, "registered").containsEntry(c, "registered")
                .doesNotContainKey(z);
        dashboard.get("nodes").forEach(n -> assertThat(n.has("name")).isTrue());

        var edges = new HashMap<String, Set<String>>();
        for (JsonNode e : dashboard.get("edges")) {
            var ids = new HashSet<String>(); e.get("templateIds").forEach(i -> ids.add(i.asString()));
            ids.retainAll(mine);
            if (!ids.isEmpty()) edges.put(e.get("sourceTenantId").asString() + ">" + e.get("targetTenantId").asString(), ids);
        }
        assertThat(edges).containsOnly(Map.entry(a + ">" + b, Set.of(x1)), Map.entry(b + ">" + c, Set.of(x2, x3)));

        var queue = new HashMap<String, JsonNode>();
        for (JsonNode q : dashboard.get("queue")) {
            if (!mine.contains(q.get("nextTemplateId").asString())) continue;
            queue.put(q.get("packageId").asString() + "|" + q.get("nextTemplateId").asString(), q);
        }
        // REQ-612: 템플릿에 패키지가 없으므로 같은 경로의 템플릿마다 같은 대기 항목이 생긴다(예전 이력 줄도 같은 결과).
        assertThat(queue.keySet()).containsExactlyInAnyOrder(
                "P1|" + x2, "P5|" + x2, "P6|" + x2, "Only|" + x2, "P8|" + x2,
                "P1|" + x3, "P5|" + x3, "P6|" + x3, "Only|" + x3, "P8|" + x3);
        var p1 = queue.get("P1|" + x2);
        assertThat(p1.get("atTenantId").asString()).isEqualTo(b);
        assertThat(p1.get("nextTargetTenantId").asString()).isEqualTo(c);
        assertThat(p1.get("arrivedTransportId").asString()).isEqualTo("p1-b");
        assertThat(Instant.parse(p1.get("arrivedAt").asString())).isEqualTo(h2);
        assertThat(p1.get("artifactCount").asInt()).isEqualTo(3);
        assertThat(queue.get("P6|" + x2).get("arrivedTransportId").asString()).isEqualTo("p6-b");

        var filtered = ok(request("GET", "/dashboard?templateId=" + x3, null), 200);
        assertThat(filtered.get("edges")).singleElement().satisfies(e -> {
            assertThat(e.get("sourceTenantId").asString()).isEqualTo(b);
            assertThat(e.get("targetTenantId").asString()).isEqualTo(c);
            var ids = new ArrayList<String>(); e.get("templateIds").forEach(i -> ids.add(i.asString()));
            assertThat(ids).containsExactly(x3);
        });
        var filteredQueue = new HashMap<String, JsonNode>();
        filtered.get("queue").forEach(q -> filteredQueue.put(q.get("packageId").asString(), q));
        assertThat(filteredQueue.keySet()).containsExactlyInAnyOrder("P1", "P5", "P6", "Only", "P8");
        assertThat(filteredQueue.values()).allSatisfy(q -> assertThat(q.get("nextTemplateId").asString()).isEqualTo(x3));
        assertThat(filteredQueue.get("Only").get("arrivedTransportId").asString()).isEqualTo("only-a");

        error(request("GET", "/dashboard?templateId=missing-template", null), 404, "TEMPLATE_NOT_FOUND");
    }

    @Test @DisplayName("REQ-612: 묶음 이관은 패키지별 결과로 대기 항목을 계산한다(실패 0개 패키지만 도착, 아티팩트 수는 그 패키지 것)")
    void req612_bundleQueue() throws Exception {
        String a = tenant("Bundle A"), b = tenant("Bundle B"), c = tenant("Bundle C");
        template("Bundle AB", a, b, null);
        String next = template("Bundle BC", b, c, null);
        Instant t0 = CLOCK.instant().minus(Duration.ofDays(2));
        var bundle = new LinkedHashMap<String, int[]>();
        bundle.put("BOk", new int[]{2, 0});
        bundle.put("BFail", new int[]{3, 1});
        bundle.put("BCreateFailed", new int[]{1, 1});
        var forwarded = new LinkedHashMap<String, int[]>();
        forwarded.put("BForwarded", new int[]{1, 0});
        var forwardedOut = new LinkedHashMap<String, int[]>();
        forwardedOut.put("BForwarded", new int[]{1, 0});
        forwardedOut.put("BOther", new int[]{1, 1});
        var preview = new LinkedHashMap<String, int[]>();
        preview.put("BPreview", new int[]{1, 0});
        Files.write(historyFile(), List.of(
                bundleLine("bundle-1", false, a, b, t0.plus(Duration.ofHours(1)), bundle),
                bundleLine("bundle-2", false, a, b, t0.plus(Duration.ofHours(1)), forwarded),
                // 다음 경로로 보낸 묶음에 실패한 다른 패키지가 있어도 BForwarded는 보낸 것으로 본다
                bundleLine("bundle-3", false, b, c, t0.plus(Duration.ofHours(2)), forwardedOut),
                bundleLine("bundle-4", true, a, b, t0.plus(Duration.ofHours(1)), preview),
                historyLine("legacy-1", "LegacyOk", false, a, "Bundle A", b, "Bundle B", t0.plus(Duration.ofHours(1)), 2, 0),
                historyLine("legacy-2", "LegacyFail", false, a, "Bundle A", b, "Bundle B", t0.plus(Duration.ofHours(1)), 2, 1)),
                StandardCharsets.UTF_8);

        var queue = new HashMap<String, JsonNode>();
        for (JsonNode q : ok(request("GET", "/dashboard?templateId=" + next, null), 200).get("queue"))
            queue.put(q.get("packageId").asString(), q);
        assertThat(queue.keySet()).containsExactlyInAnyOrder("BOk", "LegacyOk");
        var item = queue.get("BOk");
        assertThat(item.get("atTenantId").asString()).isEqualTo(b);
        assertThat(item.get("nextTargetTenantId").asString()).isEqualTo(c);
        assertThat(item.get("arrivedTransportId").asString()).isEqualTo("bundle-1");
        assertThat(item.get("artifactCount").asInt()).isEqualTo(2);
        assertThat(queue.get("LegacyOk").get("artifactCount").asInt()).isEqualTo(2);
    }

    @Test @DisplayName("REQ-612: 아티팩트 결과 0개 패키지도 실패 0개면 도착(예전 total 0 줄 포함), 대상 패키지가 없음·생성 실패·확인 실패면 도착 아님")
    void req612_emptyPackageQueue() throws Exception {
        String a = tenant("Empty A"), b = tenant("Empty B"), c = tenant("Empty C");
        template("Empty AB", a, b, null);
        String next = template("Empty BC", b, c, null);
        Instant t0 = CLOCK.instant().minus(Duration.ofDays(2));
        var bundle = new LinkedHashMap<String, int[]>();
        bundle.put("EExisting", new int[]{0, 0});
        bundle.put("ECreated", new int[]{0, 0});
        bundle.put("ENotFound", new int[]{0, 0});
        bundle.put("ECreateFailed", new int[]{0, 0});
        bundle.put("ECheckFailed", new int[]{0, 0});
        bundle.put("EWithArtifacts", new int[]{1, 0});
        Files.write(historyFile(), List.of(
                bundleLine("empty-1", false, a, b, t0.plus(Duration.ofHours(1)), bundle, Map.of(
                        "ECreated", "CREATED", "ENotFound", "NOT_FOUND",
                        "ECreateFailed", "CREATE_FAILED", "ECheckFailed", "CHECK_FAILED")),
                historyLine("legacy-empty", "LegacyEmpty", false, a, "Empty A", b, "Empty B", t0.plus(Duration.ofHours(1)), 0, 0)),
                StandardCharsets.UTF_8);

        var queue = new HashMap<String, JsonNode>();
        for (JsonNode q : ok(request("GET", "/dashboard?templateId=" + next, null), 200).get("queue"))
            queue.put(q.get("packageId").asString(), q);
        assertThat(queue.keySet()).containsExactlyInAnyOrder("EExisting", "ECreated", "EWithArtifacts", "LegacyEmpty");
        assertThat(queue.get("EExisting").get("artifactCount").asInt()).isEqualTo(0);
        assertThat(queue.get("ECreated").get("arrivedTransportId").asString()).isEqualTo("empty-1");
        assertThat(queue.get("LegacyEmpty").get("artifactCount").asInt()).isEqualTo(0);
        assertThat(queue.get("LegacyEmpty").get("arrivedTransportId").asString()).isEqualTo("legacy-empty");
        assertThat(queue.get("EWithArtifacts").get("artifactCount").asInt()).isEqualTo(1);
    }

    @Test @DisplayName("REQ-405: today는 서버 시간대 기준 오늘의 미리보기·실제 이관 수와 성공·실패 수, 이력이 없으면 0")
    void req405_today() throws Exception {
        LocalDate today = LocalDate.ofInstant(CLOCK.instant(), ZONE);
        Instant morning = today.atTime(0, 5).atZone(ZONE).toInstant();
        Instant yesterday = today.minusDays(1).atTime(23, 55).atZone(ZONE).toInstant();
        Files.write(historyFile(), List.of(
                historyLine("t-preview", "TodayPkg", true, "DEV", "DEV", "PRD", "PRD", morning, 1, 0),
                historyLine("t-ok", "TodayPkg", false, "DEV", "DEV", "PRD", "PRD", morning.plusSeconds(60), 2, 0),
                historyLine("t-fail", "TodayPkg", false, "DEV", "DEV", "PRD", "PRD", morning.plusSeconds(120), 2, 2),
                historyLine("y-ok", "TodayPkg", false, "DEV", "DEV", "PRD", "PRD", yesterday, 1, 0),
                historyLine("y-preview", "TodayPkg", true, "DEV", "DEV", "PRD", "PRD", yesterday, 1, 0)), StandardCharsets.UTF_8);
        var todayNode = ok(request("GET", "/dashboard", null), 200).get("today");
        assertThat(todayNode.get("previews").asInt()).isEqualTo(1);
        assertThat(todayNode.get("transports").asInt()).isEqualTo(2);
        assertThat(todayNode.get("succeeded").asInt()).isEqualTo(1);
        assertThat(todayNode.get("failed").asInt()).isEqualTo(1);

        Files.deleteIfExists(historyFile());
        var empty = ok(request("GET", "/dashboard", null), 200);
        assertThat(empty.get("queue").size()).isZero();
        for (String field : List.of("previews", "transports", "succeeded", "failed"))
            assertThat(empty.get("today").get(field).asInt()).isZero();
    }

    // ---- 20261120-r1-wording REQ-804: 이력 API 선택 조건 ----

    List<String> historyIds(String query) throws Exception {
        var ids = new ArrayList<String>();
        ok(request("GET", "/transport/history" + query, null), 200).forEach(h -> ids.add(h.get("transportId").asString()));
        return ids;
    }

    @Test @DisplayName("REQ-804: date·mode·result 조건은 대시보드 today와 같은 판단으로 거르고, 조건 없으면 전체를 같은 순서로 돌려준다")
    void req804_historyQuery() throws Exception {
        LocalDate today = LocalDate.ofInstant(CLOCK.instant(), ZONE);
        Instant morning = today.atTime(0, 5).atZone(ZONE).toInstant();
        Instant yesterday = today.minusDays(1).atTime(23, 55).atZone(ZONE).toInstant();
        Files.write(historyFile(), List.of(
                historyLine("q-preview", "QPkg", true, "DEV", "DEV", "PRD", "PRD", morning, 1, 0),
                historyLine("q-ok", "QPkg", false, "DEV", "DEV", "PRD", "PRD", morning.plusSeconds(60), 2, 0),
                historyLine("q-fail", "QPkg", false, "DEV", "DEV", "PRD", "PRD", morning.plusSeconds(120), 2, 2),
                historyLine("q-preview-fail", "QPkg", true, "DEV", "DEV", "PRD", "PRD", morning.plusSeconds(180), 2, 1),
                historyLine("q-ok2", "QPkg", false, "DEV", "DEV", "PRD", "PRD", morning.plusSeconds(240), 1, 0),
                historyLine("y-ok", "QPkg", false, "DEV", "DEV", "PRD", "PRD", yesterday, 1, 0),
                historyLine("y-fail", "QPkg", false, "DEV", "DEV", "PRD", "PRD", yesterday, 1, 1),
                historyLine("y-preview", "QPkg", true, "DEV", "DEV", "PRD", "PRD", yesterday, 1, 0)), StandardCharsets.UTF_8);

        var all = historyIds("");
        assertThat(all).containsExactlyInAnyOrder("q-preview", "q-ok", "q-fail", "q-preview-fail", "q-ok2", "y-ok", "y-fail", "y-preview");

        var previews = historyIds("?date=today&mode=preview");
        var reals = historyIds("?date=today&mode=real");
        var succeeded = historyIds("?date=today&mode=real&result=succeeded");
        var failed = historyIds("?date=today&mode=real&result=failed");
        assertThat(previews).containsExactlyInAnyOrder("q-preview", "q-preview-fail");
        assertThat(reals).containsExactlyInAnyOrder("q-ok", "q-fail", "q-ok2");
        assertThat(succeeded).containsExactlyInAnyOrder("q-ok", "q-ok2");
        assertThat(failed).containsExactly("q-fail");
        // 걸러진 목록은 조건 없는 목록의 순서를 그대로 따른다
        assertThat(reals).isEqualTo(all.stream().filter(reals::contains).toList());

        // 같은 시점의 대시보드 숫자와 건수가 같다
        var todayNode = ok(request("GET", "/dashboard", null), 200).get("today");
        assertThat(previews).hasSize(todayNode.get("previews").asInt());
        assertThat(reals).hasSize(todayNode.get("transports").asInt());
        assertThat(succeeded).hasSize(todayNode.get("succeeded").asInt());
        assertThat(failed).hasSize(todayNode.get("failed").asInt());

        // 조건끼리는 AND이고, result가 있으면 미리보기는 빠진다
        assertThat(historyIds("?date=today")).containsExactlyInAnyOrder("q-preview", "q-ok", "q-fail", "q-preview-fail", "q-ok2");
        assertThat(historyIds("?mode=preview")).containsExactlyInAnyOrder("q-preview", "q-preview-fail", "y-preview");
        assertThat(historyIds("?result=failed")).containsExactlyInAnyOrder("q-fail", "y-fail");
        assertThat(historyIds("?result=succeeded")).containsExactlyInAnyOrder("q-ok", "q-ok2", "y-ok");
        assertThat(historyIds("?date=today&mode=preview&result=failed")).isEmpty();

        // 응답 원소 형식은 조건 없는 응답과 같다
        var one = ok(request("GET", "/transport/history?date=today&mode=real&result=failed", null), 200).get(0);
        assertThat(one.propertyNames()).containsAll(List.of("transportId", "dryRun", "deploy", "startedAt", "finishedAt", "summary", "results", "sourceTenant", "targetTenant"));
    }

    @Test @DisplayName("REQ-804 실패: 허용 목록 밖의 date·mode·result 값은 400 INVALID_REQUEST")
    void req804_historyQueryInvalid() throws Exception {
        for (String query : List.of("?date=yesterday", "?date=", "?mode=x", "?mode=PREVIEW", "?result=ok", "?result=", "?date=today&mode=real&result=partial"))
            error(request("GET", "/transport/history" + query, null), 400, "INVALID_REQUEST");
    }

    // ---- 별도 앱 컨텍스트 ----

    org.springframework.context.ConfigurableApplicationContext start(Path templates, Path audit) {
        List<String> args = new ArrayList<>(List.of("--server.port=0", "--spring.main.banner-mode=off",
                "--cpi.tenants.store-file=" + slash(directory.resolve("other-tenants.enc")),
                "--cpi.transport.history.file=" + slash(directory.resolve("restart-history.jsonl")),
                "--cpi.templates.store-file=" + slash(templates),
                "--cpi.audit.file=" + slash(audit)));
        for (String env : List.of("dev", "prd")) {
            String prefix = "--cpi.environments." + env + ".";
            args.add(prefix + "api-url=" + server.baseUrl());
            args.add(prefix + "token-url=" + server.baseUrl() + "/oauth/token");
            args.add(prefix + "client-id=test-dummy-env-client");
            args.add(prefix + "client-secret=test-dummy-env-secret");
        }
        return new SpringApplicationBuilder(CpiTransportToolApplication.class, TestBeans.class).run(args.toArray(String[]::new));
    }
    static String slash(Path path) { return path.toString().replace('\\', '/'); }
    static int port(org.springframework.context.ConfigurableApplicationContext context) {
        return ((org.springframework.boot.web.server.context.WebServerApplicationContext) context).getWebServer().getPort();
    }
}
