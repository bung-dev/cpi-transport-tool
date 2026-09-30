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
        settings = new TransportProperties("", new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of("password", "token"));
        var connections = new CpiProperties(connection(dev, "dev"), connection(prd, "prd"));
        sleeper = clock::advance;
        var tokens = new OAuthTokenProvider(connections, settings, clock, sleeper);
        api = new CpiApiClient(new CpiHttpExecutor(connections, tokens, new CsrfTokenStore(), settings, sleeper), json);
        sensitive = new SensitiveKeyMatcher(settings);
        service = new TransportService(api, new IflwReplacer(sensitive), new ExternalParameterReplacer(api, sensitive),
                new DeployService(api, settings, clock, sleeper), new MappingFileLoader(settings), clock);
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
            for (var server : List.of(dev, prd)) server.stubFor(get(urlEqualTo(path(id) + "/Configurations"))
                    .willReturn(okJson("{\"d\":{\"results\":[{\"ParameterKey\":\"Endpoint\",\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"}]}}")));
            prd.stubFor(put(urlEqualTo(parameter(id))).willReturn(noContent()));
            prd.stubFor(post(urlEqualTo(deploy(id))).willReturn(noContent()));
            prd.stubFor(get(urlEqualTo(runtime(id))).willReturn(okJson("{\"d\":{\"Status\":\"STARTED\"}}")));
        }
    }

    @AfterEach void tearDown() { if (dev != null) dev.stop(); if (prd != null) prd.stop(); }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-005 AC-4, AC-4a: create and update upload replaced zip and preserve version")
    void req005_ac4_upload(boolean existing) throws Exception {
        if (existing) prd.stubFor(get(urlEqualTo(path("A"))).willReturn(okJson("{\"d\":{\"Id\":\"A\"}}")));
        var response = run(List.of("A"), false, true);
        var result = response.results().getFirst();
        assertThat(result.action()).isEqualTo(existing ? TransportAction.UPDATED : TransportAction.CREATED);
        assertThat(result.status()).isEqualTo(ArtifactStatus.SUCCESS);
        assertThat(result.deployStatus()).isEqualTo(DeployStatus.STARTED);
        var requests = existing ? prd.findAll(putRequestedFor(urlEqualTo(path("A"))))
                : prd.findAll(postRequestedFor(urlEqualTo(COLLECTION)));
        assertThat(requests).hasSize(1);
        var body = json.readTree(requests.getFirst().getBodyAsString());
        assertThat(body.path("Name").asString()).isEqualTo("Name A");
        if (!existing) assertThat(body.path("PackageId").asString()).isEqualTo("PKG");
        try (var zip = new ZipInputStream(new ByteArrayInputStream(Base64.getDecoder().decode(body.path("ArtifactContent").asString())))) {
            assertThat(zip.getNextEntry().getName()).endsWith("flow.iflw");
            String xml = new String(zip.readAllBytes(), StandardCharsets.UTF_8);
            assertThat(xml).contains("prd").doesNotContain(">dev<");
            assertThat(zip.getNextEntry().getName()).isEqualTo("version.txt");
            assertThat(new String(zip.readAllBytes(), StandardCharsets.UTF_8)).isEqualTo("1.0");
        }
        assertThat(UUID.fromString(response.transportId()).toString()).isEqualTo(response.transportId());
        assertThat(response.finishedAt()).isAfter(response.startedAt());
        assertThat(json.readTree(json.writeValueAsString(response)).path("startedAt").asString()).endsWith("Z");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-005 AC-1: omitted and empty artifactIds use DEV list order")
    void req005_ac1_all(boolean empty) {
        var response = service.execute(new TransportRequest("PKG", empty ? List.of() : null, true, false));
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactly("A", "B", "C");
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 3, 0));
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-005 AC-6: unknown artifact fails alone and request order is preserved")
    void req005_ac6_missing() {
        var response = run(List.of("C", "missing", "A"), false, false);
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactly("C", "missing", "A");
        var missing = response.results().get(1);
        assertThat(missing.error().code()).isEqualTo("ARTIFACT_NOT_FOUND");
        assertThat(missing.replacements()).isEmpty();
        assertThat(missing.unmappedKeys()).isEmpty();
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 2, 1));
    }

    @ParameterizedTest
    @ValueSource(ints = {404, 500})
    @DisplayName("REQ-005 AC-5: target package absence or failure prevents uploads and retains planned diff")
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
    @DisplayName("REQ-013 AC-2: upload failure retains planned diff and masks error body")
    void req013_ac2_upload() {
        prd.stubFor(post(urlEqualTo(COLLECTION)).willReturn(serverError().withBody("dummy-prd-secret Password=hidden-value")));
        var result = run(List.of("A"), false, true).results().getFirst();
        beforeUploadFailure(result, "UPLOAD_FAILED");
        assertThat(result.error().message()).contains("UPLOAD", "500", "CPI").doesNotContain("dummy-prd-secret", "hidden-value");
        prd.verify(0, getRequestedFor(urlEqualTo(path("A") + "/Configurations")));
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
        assertThat(response.results().get(1).replacements()).isEmpty();
        dev.verify(3, getRequestedFor(urlEqualTo(path("B") + "/$value")));
    }

    @Test
    @DisplayName("REQ-013 AC-2: malformed zip stops before target checks with empty diff")
    void req013_ac2_parse() {
        dev.stubFor(get(urlEqualTo(path("A") + "/$value")).willReturn(ok().withBody("invalid zip")));
        var result = run(List.of("A"), false, true).results().getFirst();
        assertThat(result.error().code()).isEqualTo("IFLW_PARSE_ERROR");
        assertThat(result.replacements()).isEmpty();
        assertThat(result.unmappedKeys()).isEmpty();
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-005 AC-4a: configuration read failure retains successful upload and applied header")
    void req005_ac4a_configurationRead() {
        prd.stubFor(get(urlEqualTo(path("A") + "/Configurations")).willReturn(serverError()));
        var result = run(List.of("A"), false, true).results().getFirst();
        assertThat(result.error().code()).isEqualTo("CONFIGURATION_READ_FAILED");
        assertThat(result.action()).isEqualTo(TransportAction.CREATED);
        assertThat(result.replacements()).extracting(Replacement::status).containsOnly(ReplacementStatus.APPLIED);
        assertThat(result.replacements()).noneMatch(r -> r.targetType() == TargetType.EXTERNAL_PARAM);
        noDeploy(result);
    }

    @Test
    @DisplayName("REQ-008 AC-4: failed parameter preserves upload and successful keys and blocks deploy")
    void req008_ac4_parameterFailure() {
        prd.stubFor(get(urlEqualTo(path("A") + "/Configurations")).willReturn(okJson(
                "{\"d\":{\"results\":[{\"ParameterKey\":\"Endpoint\",\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"},{\"ParameterKey\":\"Next\",\"ParameterValue\":\"dev\",\"DataType\":\"xsd:string\"}]}}")));
        prd.stubFor(put(urlEqualTo(parameter("A"))).willReturn(serverError()));
        prd.stubFor(put(urlEqualTo(path("A") + "/$links/Configurations('Next')")).willReturn(noContent()));
        var rules = new ArrayList<>(rules());
        rules.add(new MappingEntry("A", TargetType.EXTERNAL_PARAM, "Next", "dev", "prd"));
        var result = service.execute(new TransportRequest("PKG", List.of("A"), false, true), artifacts(), rules).results().getFirst();
        assertThat(result.error().code()).isEqualTo("CONFIGURATION_UPDATE_FAILED");
        assertThat(result.action()).isEqualTo(TransportAction.CREATED);
        assertThat(result.replacements()).filteredOn(r -> r.targetType() == TargetType.EXTERNAL_PARAM)
                .extracting(Replacement::status).containsExactly(ReplacementStatus.FAILED, ReplacementStatus.APPLIED);
        noDeploy(result);
    }

    @ParameterizedTest
    @ValueSource(strings = {"ERROR", "WAITING", "HTTP_FAILURE"})
    @DisplayName("REQ-009 AC-3, AC-4: deployment failure or timeout preserves upload and replacements")
    void req009_ac3_deployment(String status) {
        if (status.equals("HTTP_FAILURE")) prd.stubFor(post(urlEqualTo(deploy("A"))).willReturn(serverError()));
        else prd.stubFor(get(urlEqualTo(runtime("A"))).willReturn(okJson("{\"d\":{\"Status\":\"" + status + "\"}}")));
        var result = run(List.of("A"), false, true).results().getFirst();
        assertThat(result.error().code()).isEqualTo(status.equals("WAITING") ? "DEPLOY_TIMEOUT" : "DEPLOY_FAILED");
        assertThat(result.deployStatus()).isEqualTo(status.equals("WAITING") ? DeployStatus.TIMEOUT : DeployStatus.ERROR);
        assertThat(result.action()).isEqualTo(TransportAction.CREATED);
        assertThat(result.replacements()).extracting(Replacement::status).containsOnly(ReplacementStatus.APPLIED);
    }

    @ParameterizedTest(name = "{displayName} [{index}] deploy={0}")
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-010 AC-1, AC-2, AC-3, AC-4: dry run performs no writes CSRF or PRD requests even on failure")
    void req010_ac1_dryRun(boolean deploy) {
        dev.stubFor(get(urlEqualTo(path("B") + "/Configurations")).willReturn(serverError()));
        var response = run(List.of("A", "B", "missing"), true, deploy);
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 1, 2));
        assertThat(response.results()).allMatch(r -> r.action() == TransportAction.NONE)
                .allMatch(r -> r.deployStatus() == (deploy ? DeployStatus.SKIPPED_DRY_RUN : DeployStatus.NOT_REQUESTED));
        assertThat(response.results().getFirst().replacements()).extracting(Replacement::status).containsOnly(ReplacementStatus.PLANNED);
        assertThat(response.results().getFirst().replacements()).extracting(Replacement::targetType).contains(TargetType.EXTERNAL_PARAM);
        assertThat(response.results().get(1).error().code()).isEqualTo("CONFIGURATION_READ_FAILED");
        assertThat(response.results().get(1).replacements()).extracting(Replacement::status).containsOnly(ReplacementStatus.PLANNED);
        assertThat(prd.getAllServeEvents()).isEmpty();
        assertThat(dev.getAllServeEvents()).allMatch(e -> e.getRequest().getMethod().getName().equals("GET")
                || e.getRequest().getUrl().equals("/token"));
        dev.verify(0, getRequestedFor(urlEqualTo("/api/v1/")));
        dev.verify(0, anyRequestedFor(anyUrl()).withHeader("X-CSRF-Token", matching(".*")));
    }

    @Test
    @DisplayName("REQ-005 AC-3a: value mismatch alone succeeds")
    void req005_ac3a_mismatch() {
        var result = service.execute(new TransportRequest("PKG", List.of("A"), false, false), artifacts(),
                List.of(new MappingEntry("A", TargetType.HEADER, "Endpoint", "different", "prd"))).results().getFirst();
        assertThat(result.replacements()).extracting(Replacement::status).containsExactly(ReplacementStatus.VALUE_MISMATCH);
        assertThat(result.status()).isEqualTo(ArtifactStatus.SUCCESS);
        assertThat(result.error()).isNull();
        noDeploy(result);
    }

    @Test
    @DisplayName("REQ-013 AC-1: arbitrary runtime exception is isolated without exposing exception text")
    void req013_ac1_runtimeFailure() {
        var replacer = new IflwReplacer(sensitive) {
            private int calls;
            @Override public Result process(byte[] zip, List<MappingEntry> mappings, boolean dryRun) {
                if (++calls == 2) throw new IllegalStateException("sensitive exception value");
                return super.process(zip, mappings, dryRun);
            }
        };
        var isolated = new TransportService(api, replacer, new ExternalParameterReplacer(api, sensitive),
                new DeployService(api, settings, clock, sleeper), new MappingFileLoader(settings), clock);
        var response = isolated.execute(new TransportRequest("PKG", null, true, true), artifacts(), rules());
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 2, 1));
        assertThat(response.results().get(1).error().code()).isEqualTo("IFLW_PARSE_ERROR");
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
        assertThat(result.replacements()).extracting(Replacement::status).containsOnly(ReplacementStatus.PLANNED);
        assertThat(result.replacements()).noneMatch(r -> r.targetType() == TargetType.EXTERNAL_PARAM);
        assertThat(result.unmappedKeys()).contains(new UnmappedKey(TargetType.HEADER, "Unmapped"));
        noDeploy(result);
    }
    private void noDeploy(ArtifactResult result) {
        assertThat(result.deployStatus()).isEqualTo(DeployStatus.NOT_REQUESTED);
        prd.verify(0, postRequestedFor(urlMatching("/api/v1/Deploy.*")));
    }
    private TransportResponse run(List<String> ids, boolean dry, boolean deploy) {
        return service.execute(new TransportRequest("PKG", ids, dry, deploy), artifacts(), rules());
    }
    private List<CpiArtifact> artifacts() {
        return List.of(new CpiArtifact("A", "Name A", "1.0"), new CpiArtifact("B", "Name B", "1.0"), new CpiArtifact("C", "Name C", "1.0"));
    }
    private List<MappingEntry> rules() {
        var rules = new ArrayList<MappingEntry>();
        for (String id : List.of("A", "B", "C")) {
            rules.add(new MappingEntry(id, TargetType.HEADER, "Endpoint", "dev", "prd"));
            rules.add(new MappingEntry(id, TargetType.PROPERTY, "Property", "dev", "prd"));
            rules.add(new MappingEntry(id, TargetType.EXTERNAL_PARAM, "Endpoint", "dev", "prd"));
        }
        return rules;
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
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry("src/main/resources/scenarioflows/integrationflow/flow.iflw"));
            zip.write(("<b:definitions xmlns:b=\"http://www.omg.org/spec/BPMN/20100524/MODEL\" xmlns:ifl=\"http:///com.sap.ifl.model/Ifl.xsd\">"
                    + "<b:callActivity><ifl:property><key>activityType</key><value>Enricher</value></ifl:property>"
                    + "<ifl:property><key>headerTable</key><value><![CDATA[<row><cell id='Name'>Endpoint</cell><cell id='Value'>dev</cell></row>"
                    + "<row><cell id='Name'>Unmapped</cell><cell id='Value'>unchanged</cell></row>]]></value></ifl:property>"
                    + "<ifl:property><key>propertyTable</key><value><![CDATA[<row><cell id='Name'>Property</cell><cell id='Value'>dev</cell></row>]]></value></ifl:property>"
                    + "</b:callActivity></b:definitions>").getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("version.txt"));
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
