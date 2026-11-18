package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.model.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.zip.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;

class TransportServiceWireMockTests {
    private WireMockServer dev, prd;
    private TransportService service;
    private CpiApiClient api;
    private TransportProperties settings;
    private SensitiveKeyMatcher sensitive;
    private Sleeper sleeper;
    private final MutableClock clock = new MutableClock();
    private final JsonMapper json = JsonMapper.builder().build();
    @TempDir Path temporary;
    private static final String PACKAGE = "/api/v1/IntegrationPackages('PKG')";
    private static final String COLLECTION = "/api/v1/IntegrationDesigntimeArtifacts";

    @BeforeEach
    void setUp() throws Exception {
        dev = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        prd = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        dev.start();
        prd.start();
        settings = new TransportProperties(new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of("password", "token"));
        var connections = new CpiProperties(connection(dev, "dev"), connection(prd, "prd"));
        sleeper = clock::advance;
        var tokens = new OAuthTokenProvider(connections, settings, clock, sleeper);
        api = new CpiApiClient(new CpiHttpExecutor(connections, tokens, new CsrfTokenStore(), settings, sleeper), json);
        sensitive = new SensitiveKeyMatcher(settings);
        service = new TransportService(api, new ConfigurationCopier(api, sensitive),
                new DeployService(api, settings, clock, sleeper), clock);
        dev.stubFor(post(urlEqualTo("/token")).willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(post(urlEqualTo("/token")).willReturn(okJson("{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(get(urlEqualTo("/api/v1/")).willReturn(ok().withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
        prd.stubFor(get(urlEqualTo(PACKAGE)).willReturn(okJson("{\"d\":{\"Id\":\"PKG\",\"Name\":\"Package\",\"Version\":\"1.0\"}}")));
        prd.stubFor(post(urlEqualTo(COLLECTION)).willReturn(created()));
        dev.stubFor(get(urlEqualTo(PACKAGE + "/IntegrationDesigntimeArtifacts")).willReturn(okJson(
                "{\"d\":{\"results\":[{\"Id\":\"A\",\"Name\":\"Name A\",\"Version\":\"1.0\"},{\"Id\":\"B\",\"Name\":\"Name B\",\"Version\":\"1.0\"},{\"Id\":\"C\",\"Name\":\"Name C\",\"Version\":\"1.0\"}]}}")));
        for (String id : List.of("A", "B", "C")) {
            dev.stubFor(get(urlEqualTo(path(id) + "/$value")).willReturn(ok().withBody(zip())));
            prd.stubFor(get(urlEqualTo(path(id))).willReturn(notFound()));
            prd.stubFor(put(urlEqualTo(path(id))).willReturn(noContent()));
            configurations(id, "{\"ParameterKey\":\"Endpoint\",\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"}");
            prd.stubFor(put(urlMatching(java.util.regex.Pattern.quote(path(id)) + "/\\$links/Configurations\\(.*\\)")).willReturn(noContent()));
            prd.stubFor(post(urlEqualTo(deploy(id))).willReturn(noContent()));
            prd.stubFor(get(urlEqualTo(runtime(id))).willReturn(okJson("{\"d\":{\"Status\":\"STARTED\"}}")));
        }
    }

    @AfterEach void tearDown() { if (dev != null) dev.stop(); if (prd != null) prd.stop(); }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-501, REQ-502: create and update upload the downloaded zip byte for byte and copy the source value without reading the target")
    void req501_upload(boolean existing) throws Exception {
        if (existing) prd.stubFor(get(urlEqualTo(path("A"))).willReturn(okJson("{\"d\":{\"Id\":\"A\"}}")));
        var response = run(List.of("A"), false, true);
        var result = response.results().getFirst();
        assertThat(result.action()).isEqualTo(existing ? TransportAction.UPDATED : TransportAction.CREATED);
        assertThat(result.status()).isEqualTo(ArtifactStatus.SUCCESS);
        assertThat(result.deployStatus()).isEqualTo(DeployStatus.STARTED);
        assertThat(result.configurations()).containsExactly(
                new ConfigurationItem("Endpoint", "dev", "xsd:string", ConfigurationStatus.COPIED));
        var requests = existing ? prd.findAll(putRequestedFor(urlEqualTo(path("A"))))
                : prd.findAll(postRequestedFor(urlEqualTo(COLLECTION)));
        assertThat(requests).hasSize(1);
        var body = json.readTree(requests.getFirst().getBodyAsString());
        assertThat(body.path("Name").asString()).isEqualTo("Name A");
        if (!existing) assertThat(body.path("PackageId").asString()).isEqualTo("PKG");
        assertThat(Base64.getDecoder().decode(body.path("ArtifactContent").asString())).isEqualTo(zip());
        prd.verify(1, putRequestedFor(urlEqualTo(parameter("A")))
                .withRequestBody(equalToJson("{\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"}")));
        prd.verify(0, getRequestedFor(urlMatching(".*/Configurations")));
        assertThat(UUID.fromString(response.transportId()).toString()).isEqualTo(response.transportId());
        assertThat(response.finishedAt()).isAfter(response.startedAt());
        assertThat(json.readTree(json.writeValueAsString(response)).path("startedAt").asString()).endsWith("Z");
    }

    @ParameterizedTest
    @ValueSource(strings = {"notZip", "brokenIflw"})
    @DisplayName("REQ-501: an unparsable bundle or broken .iflw is uploaded unchanged and does not fail the artifact")
    void req501_unparsable(String kind) throws Exception {
        byte[] bundle = kind.equals("notZip") ? "invalid zip".getBytes(StandardCharsets.UTF_8) : brokenZip();
        dev.stubFor(get(urlEqualTo(path("A") + "/$value")).willReturn(ok().withBody(bundle)));
        var result = run(List.of("A"), false, false).results().getFirst();
        assertThat(result.status()).isEqualTo(ArtifactStatus.SUCCESS);
        assertThat(result.error()).isNull();
        var upload = prd.findAll(postRequestedFor(urlEqualTo(COLLECTION)));
        assertThat(upload).hasSize(1);
        assertThat(Base64.getDecoder().decode(json.readTree(upload.getFirst().getBodyAsString())
                .path("ArtifactContent").asString())).isEqualTo(bundle);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-005 AC-1, REQ-503: omitted and empty artifactIds use DEV list order and preview sends nothing to the target")
    void req005_ac1_all(boolean empty) {
        var response = service.execute(new TransportRequest("PKG", empty ? List.of() : null, true, false));
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactly("A", "B", "C");
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 3, 0));
        assertThat(response.results()).allSatisfy(r -> assertThat(r.configurations()).containsExactly(
                new ConfigurationItem("Endpoint", "dev", "xsd:string", ConfigurationStatus.PLANNED)));
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-005 AC-6, REQ-504: unknown artifact fails alone with empty configurations and request order is preserved")
    void req005_ac6_missing() {
        var response = run(List.of("C", "missing", "A"), false, false);
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactly("C", "missing", "A");
        var missing = response.results().get(1);
        assertThat(missing.error().code()).isEqualTo("ARTIFACT_NOT_FOUND");
        assertThat(missing.configurations()).isEmpty();
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 2, 1));
    }

    @ParameterizedTest
    @ValueSource(ints = {404, 500})
    @DisplayName("REQ-005 AC-5, REQ-504: target package absence or failure prevents uploads and leaves configurations empty")
    void req005_ac5_targetPackage(int status) {
        prd.stubFor(get(urlEqualTo(PACKAGE)).willReturn(aResponse().withStatus(status)));
        var result = run(List.of("A"), false, true).results().getFirst();
        beforeUploadFailure(result, status == 404 ? "PACKAGE_NOT_FOUND_IN_TARGET" : "TARGET_CHECK_FAILED");
        prd.verify(0, postRequestedFor(urlEqualTo(COLLECTION)));
        prd.verify(0, getRequestedFor(urlEqualTo(path("A"))));
    }

    @Test
    @DisplayName("REQ-013 AC-2: existence check failure stops before upload")
    void req013_ac2_targetArtifact() {
        prd.stubFor(get(urlEqualTo(path("A"))).willReturn(serverError()));
        beforeUploadFailure(run(List.of("A"), false, true).results().getFirst(), "TARGET_CHECK_FAILED");
        prd.verify(0, postRequestedFor(urlEqualTo(COLLECTION)));
    }

    @Test
    @DisplayName("REQ-013 AC-2, REQ-504: upload failure masks error body, writes no configuration and leaves configurations empty")
    void req013_ac2_upload() {
        prd.stubFor(post(urlEqualTo(COLLECTION)).willReturn(serverError().withBody("dummy-prd-secret Password=hidden-value")));
        var result = run(List.of("A"), false, true).results().getFirst();
        beforeUploadFailure(result, "UPLOAD_FAILED");
        assertThat(result.error().message()).contains("UPLOAD", "500", "CPI").doesNotContain("dummy-prd-secret", "hidden-value");
        prd.verify(0, putRequestedFor(urlEqualTo(parameter("A"))));
    }

    @Test
    @DisplayName("REQ-013 AC-1: second download 500 is isolated and third succeeds")
    void req013_ac1_isolation() {
        dev.stubFor(get(urlEqualTo(path("B") + "/$value")).willReturn(serverError()));
        var response = run(null, false, false);
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 2, 1));
        assertThat(response.results()).extracting(ArtifactResult::status)
                .containsExactly(ArtifactStatus.SUCCESS, ArtifactStatus.FAILED, ArtifactStatus.SUCCESS);
        assertThat(response.results().get(1).error().code()).isEqualTo("DOWNLOAD_FAILED");
        assertThat(response.results().get(1).configurations()).isEmpty();
        dev.verify(3, getRequestedFor(urlEqualTo(path("B") + "/$value")));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-502, REQ-503: source configuration read failure fails only that artifact before any target request")
    void req502_sourceReadFailure(boolean dryRun) {
        dev.stubFor(get(urlEqualTo(path("A") + "/Configurations")).willReturn(serverError()));
        var response = run(List.of("A", "B"), dryRun, false);
        var failed = response.results().getFirst();
        assertThat(failed.error().code()).isEqualTo("CONFIGURATION_READ_FAILED");
        assertThat(failed.action()).isEqualTo(TransportAction.NONE);
        assertThat(failed.configurations()).isEmpty();
        assertThat(response.results().get(1).status()).isEqualTo(ArtifactStatus.SUCCESS);
        prd.verify(0, getRequestedFor(urlEqualTo(path("A"))));
        prd.verify(0, postRequestedFor(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo("A"))));
        prd.verify(0, putRequestedFor(urlMatching(java.util.regex.Pattern.quote(path("A")) + ".*")));
    }

    @Test
    @DisplayName("REQ-502, REQ-504: every source key is written in order, empty sensitive values are skipped, sensitive values stay plain and PUT failures block deploy")
    void req502_statuses() {
        configurations("A",
                "{\"ParameterKey\":\"Endpoint\",\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"}",
                "{\"ParameterKey\":\"Next\",\"ParameterValue\":\"42\",\"DataType\":\"xsd:integer\"}",
                "{\"ParameterKey\":\"ClientPassword\",\"ParameterValue\":\"dummy-dev-pass-1\",\"DataType\":\"xsd:string\"}",
                "{\"ParameterKey\":\"Password\",\"ParameterValue\":\"\",\"DataType\":\"xsd:string\"}",
                "{\"ParameterKey\":\"AccessToken\",\"DataType\":\"xsd:string\"}",
                "{\"ParameterKey\":\"Plain\",\"ParameterValue\":\"\",\"DataType\":\"xsd:string\"}");
        prd.stubFor(put(urlEqualTo(parameter("A"))).willReturn(serverError().withBody("dev hidden-body")));
        var result = run(List.of("A"), false, true).results().getFirst();
        assertThat(result.configurations()).extracting(ConfigurationItem::key, ConfigurationItem::status).containsExactly(
                tuple("Endpoint", ConfigurationStatus.FAILED), tuple("Next", ConfigurationStatus.COPIED),
                tuple("ClientPassword", ConfigurationStatus.COPIED), tuple("Password", ConfigurationStatus.SKIPPED_EMPTY),
                tuple("AccessToken", ConfigurationStatus.SKIPPED_EMPTY), tuple("Plain", ConfigurationStatus.COPIED));
        assertThat(result.configurations().get(2)).isEqualTo(
                new ConfigurationItem("ClientPassword", "dummy-dev-pass-1", "xsd:string", ConfigurationStatus.COPIED));
        assertThat(result.error().code()).isEqualTo("CONFIGURATION_UPDATE_FAILED");
        assertThat(result.error().message()).contains("Endpoint: HTTP 500").doesNotContain("Next", "42", "dummy-dev-pass-1", "hidden-body");
        assertThat(result.action()).isEqualTo(TransportAction.CREATED);
        prd.verify(1, putRequestedFor(urlEqualTo(path("A") + "/$links/Configurations('Next')"))
                .withRequestBody(equalToJson("{\"ParameterValue\":\"42\",\"DataType\":\"xsd:integer\"}")));
        prd.verify(1, putRequestedFor(urlEqualTo(path("A") + "/$links/Configurations('ClientPassword')"))
                .withRequestBody(equalToJson("{\"ParameterValue\":\"dummy-dev-pass-1\",\"DataType\":\"xsd:string\"}")));
        prd.verify(1, putRequestedFor(urlEqualTo(path("A") + "/$links/Configurations('Plain')"))
                .withRequestBody(equalToJson("{\"ParameterValue\":\"\",\"DataType\":\"xsd:string\"}")));
        prd.verify(0, putRequestedFor(urlEqualTo(path("A") + "/$links/Configurations('Password')")));
        prd.verify(0, putRequestedFor(urlEqualTo(path("A") + "/$links/Configurations('AccessToken')")));
        prd.verify(0, getRequestedFor(urlMatching(".*/Configurations")));
        noDeploy(result);
    }

    @ParameterizedTest(name = "{displayName} [{index}] deploy={0}")
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-010, REQ-503: preview plans every source key, isolates source read failures and sends no request to the target")
    void req503_preview(boolean deploy) {
        configurations("A",
                "{\"ParameterKey\":\"Endpoint\",\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"}",
                "{\"ParameterKey\":\"Password\",\"ParameterValue\":\"\",\"DataType\":\"xsd:string\"}",
                "{\"ParameterKey\":\"ClientPassword\",\"ParameterValue\":\"dummy-dev-pass-1\",\"DataType\":\"xsd:string\"}");
        dev.stubFor(get(urlEqualTo(path("B") + "/Configurations")).willReturn(serverError()));
        var response = run(List.of("A", "B", "missing"), true, deploy);
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 1, 2));
        assertThat(response.results()).allMatch(r -> r.action() == TransportAction.NONE)
                .allMatch(r -> r.deployStatus() == (deploy ? DeployStatus.SKIPPED_DRY_RUN : DeployStatus.NOT_REQUESTED));
        assertThat(response.results().getFirst().configurations()).containsExactly(
                new ConfigurationItem("Endpoint", "dev", "xsd:string", ConfigurationStatus.PLANNED),
                new ConfigurationItem("Password", "", "xsd:string", ConfigurationStatus.SKIPPED_EMPTY),
                new ConfigurationItem("ClientPassword", "dummy-dev-pass-1", "xsd:string", ConfigurationStatus.PLANNED));
        assertThat(response.results().get(1).error().code()).isEqualTo("CONFIGURATION_READ_FAILED");
        assertThat(response.results().get(1).configurations()).isEmpty();
        assertThat(prd.getAllServeEvents()).isEmpty();
        assertThat(dev.getAllServeEvents()).allMatch(e -> e.getRequest().getMethod().getName().equals("GET")
                || e.getRequest().getUrl().equals("/token"));
        dev.verify(0, getRequestedFor(urlEqualTo("/api/v1/")));
        dev.verify(0, anyRequestedFor(anyUrl()).withHeader("X-CSRF-Token", matching(".*")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"ERROR", "WAITING", "HTTP_FAILURE"})
    @DisplayName("REQ-009 AC-3, AC-4: deployment failure or timeout preserves upload and copied configurations")
    void req009_ac3_deployment(String status) {
        if (status.equals("HTTP_FAILURE")) prd.stubFor(post(urlEqualTo(deploy("A"))).willReturn(serverError()));
        else prd.stubFor(get(urlEqualTo(runtime("A"))).willReturn(okJson("{\"d\":{\"Status\":\"" + status + "\"}}")));
        var result = run(List.of("A"), false, true).results().getFirst();
        assertThat(result.error().code()).isEqualTo(status.equals("WAITING") ? "DEPLOY_TIMEOUT" : "DEPLOY_FAILED");
        assertThat(result.deployStatus()).isEqualTo(status.equals("WAITING") ? DeployStatus.TIMEOUT : DeployStatus.ERROR);
        assertThat(result.action()).isEqualTo(TransportAction.CREATED);
        assertThat(result.configurations()).extracting(ConfigurationItem::status).containsOnly(ConfigurationStatus.COPIED);
    }

    @Test
    @DisplayName("REQ-013 AC-1: arbitrary runtime exception is isolated without exposing exception text")
    void req013_ac1_runtimeFailure() {
        var failing = new CpiApiClient(new CpiHttpExecutor(new CpiProperties(connection(dev, "dev"), connection(prd, "prd")),
                new OAuthTokenProvider(new CpiProperties(connection(dev, "dev"), connection(prd, "prd")), settings, clock, sleeper),
                new CsrfTokenStore(), settings, sleeper), json) {
            private int calls;
            @Override public byte[] downloadArtifact(String environment, String id) {
                if (++calls == 2) throw new IllegalStateException("sensitive exception value");
                return super.downloadArtifact(environment, id);
            }
        };
        var isolated = new TransportService(failing, new ConfigurationCopier(failing, sensitive),
                new DeployService(failing, settings, clock, sleeper), clock);
        var response = isolated.execute(new TransportRequest("PKG", null, true, true), artifacts());
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 2, 1));
        assertThat(response.results().get(1).error().code()).isEqualTo("DOWNLOAD_FAILED");
        assertThat(response.results().get(1).error().message()).doesNotContain("sensitive exception value");
        assertThat(response.results()).allMatch(r -> r.deployStatus() == DeployStatus.SKIPPED_DRY_RUN);
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-013 AC-2: first failure wins over later target failure")
    void req013_ac2_firstFailure() {
        dev.stubFor(get(urlEqualTo(path("A") + "/$value")).willReturn(serverError()));
        prd.stubFor(get(urlEqualTo(PACKAGE)).willReturn(notFound()));
        var response = run(List.of("missing", "A", "B"), false, true);
        assertThat(response.results()).extracting(r -> r.error().code())
                .containsExactly("ARTIFACT_NOT_FOUND", "DOWNLOAD_FAILED", "PACKAGE_NOT_FOUND_IN_TARGET");
        assertThat(response.results()).allMatch(r -> r.deployStatus() == DeployStatus.NOT_REQUESTED);
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 0, 3));
        prd.verify(1, getRequestedFor(urlEqualTo(PACKAGE)));
        prd.verify(0, postRequestedFor(urlEqualTo(COLLECTION)));
    }

    private void beforeUploadFailure(ArtifactResult result, String code) {
        assertThat(result.error().code()).isEqualTo(code);
        assertThat(result.action()).isEqualTo(TransportAction.NONE);
        assertThat(result.configurations()).isEmpty();
        noDeploy(result);
    }
    private void noDeploy(ArtifactResult result) {
        assertThat(result.deployStatus()).isEqualTo(DeployStatus.NOT_REQUESTED);
        prd.verify(0, postRequestedFor(urlMatching("/api/v1/Deploy.*")));
    }
    private void configurations(String id, String... items) {
        dev.stubFor(get(urlEqualTo(path(id) + "/Configurations"))
                .willReturn(okJson("{\"d\":{\"results\":[" + String.join(",", items) + "]}}")));
    }
    private TransportResponse run(List<String> ids, boolean dry, boolean deploy) {
        return service.execute(new TransportRequest("PKG", ids, dry, deploy), artifacts());
    }
    private List<CpiArtifact> artifacts() {
        return List.of(new CpiArtifact("A", "Name A", "1.0"), new CpiArtifact("B", "Name B", "1.0"), new CpiArtifact("C", "Name C", "1.0"));
    }
    private CpiProperties.Connection connection(WireMockServer server, String env) {
        String base = "http://localhost:" + server.port();
        return new CpiProperties.Connection(base, base + "/token", "dummy-" + env + "-client", "dummy-" + env + "-secret");
    }
    private static String path(String id) { return COLLECTION + "(Id='" + id + "',Version='active')"; }
    private static String parameter(String id) { return path(id) + "/$links/Configurations('Endpoint')"; }
    private static String deploy(String id) { return "/api/v1/DeployIntegrationDesigntimeArtifact?Id='" + id + "'&Version='active'"; }
    private static String runtime(String id) { return "/api/v1/IntegrationRuntimeArtifacts('" + id + "')"; }
    private byte[] zip() throws IOException {
        return zipOf("<b:definitions xmlns:b=\"http://www.omg.org/spec/BPMN/20100524/MODEL\"><b:callActivity/></b:definitions>");
    }
    private byte[] brokenZip() throws IOException { return zipOf("<b:definitions><unclosed"); }
    private byte[] zipOf(String iflw) throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            var flow = new ZipEntry("src/main/resources/scenarioflows/integrationflow/flow.iflw");
            flow.setTime(0);
            zip.putNextEntry(flow);
            zip.write(iflw.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            var version = new ZipEntry("version.txt");
            version.setTime(0);
            zip.putNextEntry(version);
            zip.write("1.0".getBytes(StandardCharsets.UTF_8));
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
