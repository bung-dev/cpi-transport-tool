package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.model.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import java.util.zip.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;

/** REQ-601, REQ-602, REQ-604: several packages in one transport and target package auto creation. */
@ExtendWith(OutputCaptureExtension.class)
class MultiPackageTransportWireMockTests {
    private static final String PACKAGES = "/api/v1/IntegrationPackages";
    private static final String COLLECTION = "/api/v1/IntegrationDesigntimeArtifacts";
    private static final String P1_JSON = "{\"Id\":\"P1\",\"Name\":\"Package One\",\"ShortText\":\"short one\","
            + "\"Description\":\"long one\",\"Version\":\"1.0.0\",\"Mode\":\"EDIT_ALLOWED\"}";
    private static final String P2_JSON = "{\"Id\":\"P2\",\"Name\":\"Package Two\",\"ShortText\":\"short two\","
            + "\"Description\":\"long two\",\"Version\":\"2.0.1\"}";
    private static final TenantRef DEV = new TenantRef("DEV", "DEV");
    private static final TenantRef PRD = new TenantRef("PRD", "PRD");
    private WireMockServer dev, prd;
    private TransportService service;
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-18T00:00:00Z"), ZoneOffset.UTC);
    private final JsonMapper json = JsonMapper.builder().build();
    @TempDir Path temporary;

    @BeforeEach
    void setUp() throws Exception {
        dev = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        prd = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        dev.start();
        prd.start();
        var settings = new TransportProperties(new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of("password"));
        var connections = new CpiProperties(connection(dev, "dev"), connection(prd, "prd"));
        Sleeper sleeper = duration -> {};
        var tokens = new OAuthTokenProvider(connections, settings, clock, sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(connections, tokens, new CsrfTokenStore(), settings, sleeper), json);
        service = new TransportService(api, new ConfigurationCopier(api, new SensitiveKeyMatcher(settings)),
                new DeployService(api, settings, clock, sleeper), clock);
        dev.stubFor(post(urlEqualTo("/token")).willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(post(urlEqualTo("/token")).willReturn(okJson("{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(get(urlEqualTo("/api/v1/")).willReturn(ok().withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
        dev.stubFor(get(urlEqualTo(pkg("P1"))).willReturn(okJson("{\"d\":" + P1_JSON + "}")));
        dev.stubFor(get(urlEqualTo(pkg("P2"))).willReturn(okJson("{\"d\":" + P2_JSON + "}")));
        dev.stubFor(get(urlEqualTo(pkg("P1") + "/IntegrationDesigntimeArtifacts")).willReturn(okJson(
                "{\"d\":{\"results\":[{\"Id\":\"A\",\"Name\":\"Name A\",\"Version\":\"1.0\"},{\"Id\":\"B\",\"Name\":\"Name B\",\"Version\":\"1.0\"}]}}")));
        dev.stubFor(get(urlEqualTo(pkg("P2") + "/IntegrationDesigntimeArtifacts")).willReturn(okJson(
                "{\"d\":{\"results\":[{\"Id\":\"C\",\"Name\":\"Name C\",\"Version\":\"1.0\"}]}}")));
        // P1 exists in the target, P2 does not until it is created.
        prd.stubFor(get(urlEqualTo(pkg("P1"))).willReturn(okJson("{\"d\":" + P1_JSON + "}")));
        prd.stubFor(get(urlEqualTo(pkg("P2"))).willReturn(notFound()));
        prd.stubFor(post(urlEqualTo(PACKAGES)).willReturn(created()));
        prd.stubFor(post(urlEqualTo(COLLECTION)).willReturn(created()));
        for (String id : List.of("A", "B", "C")) {
            dev.stubFor(get(urlEqualTo(path(id) + "/$value")).willReturn(ok().withBody(zip(id))));
            dev.stubFor(get(urlEqualTo(path(id) + "/Configurations")).willReturn(okJson("{\"d\":{\"results\":[]}}")));
            prd.stubFor(get(urlEqualTo(path(id))).willReturn(notFound()));
        }
    }

    @AfterEach void tearDown() { if (dev != null) dev.stop(); if (prd != null) prd.stop(); }

    @Test
    @DisplayName("REQ-601, REQ-602, REQ-604: packages run in request order, results carry packageId and the summary covers every package")
    void req601_order() {
        var response = run(List.of(new PackageSelection("P2", null), new PackageSelection("P1", List.of())), List.of("P2"), false);
        assertThat(response.packages()).containsExactly(
                new TransportPackage("P2", "Package Two", TargetPackageStatus.CREATED),
                new TransportPackage("P1", "Package One", TargetPackageStatus.EXISTING));
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactly("C", "A", "B");
        assertThat(response.results()).extracting(ArtifactResult::packageId).containsExactly("P2", "P1", "P1");
        assertThat(response.results()).allSatisfy(r -> assertThat(r.status()).isEqualTo(ArtifactStatus.SUCCESS));
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 3, 0));
        assertThat(UUID.fromString(response.transportId()).toString()).isEqualTo(response.transportId());
        // REQ-604: the target package is checked once per package, before its artifacts.
        prd.verify(1, getRequestedFor(urlEqualTo(pkg("P1"))));
        prd.verify(1, getRequestedFor(urlEqualTo(pkg("P2"))));
        assertThat(prd.findAll(postRequestedFor(urlEqualTo(COLLECTION)))).extracting(r -> json.readTree(r.getBodyAsString()).path("PackageId").asString())
                .containsExactlyInAnyOrder("P2", "P1");
    }

    @Test
    @DisplayName("REQ-601, REQ-602: preview selects per package, marks every package NOT_CHECKED, ignores createPackages and sends nothing to the target")
    void req601_preview() {
        var response = run(List.of(new PackageSelection("P1", List.of("B")), new PackageSelection("P2", null)), List.of("P2"), true);
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactly("B", "C");
        assertThat(response.results()).extracting(ArtifactResult::packageId).containsExactly("P1", "P2");
        assertThat(response.packages()).containsExactly(
                new TransportPackage("P1", "Package One", TargetPackageStatus.NOT_CHECKED),
                new TransportPackage("P2", "Package Two", TargetPackageStatus.NOT_CHECKED));
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-601: an artifact failure in one package does not stop the other artifacts or packages")
    void req601_isolation() {
        dev.stubFor(get(urlEqualTo(path("A") + "/$value")).willReturn(serverError()));
        var response = run(List.of(new PackageSelection("P1", null), new PackageSelection("P2", null)), List.of("P2"), false);
        assertThat(response.results()).extracting(ArtifactResult::artifactId, ArtifactResult::status).containsExactly(
                tuple("A", ArtifactStatus.FAILED), tuple("B", ArtifactStatus.SUCCESS), tuple("C", ArtifactStatus.SUCCESS));
        assertThat(response.results().getFirst().error().code()).isEqualTo("DOWNLOAD_FAILED");
        assertThat(response.summary()).isEqualTo(new TransportSummary(3, 2, 1));
    }

    @Test
    @DisplayName("REQ-604: an approved missing package is created from the source ID, name, short text, description and version before its upload")
    void req604_created(CapturedOutput output) {
        var response = run(List.of(new PackageSelection("P2", null)), List.of("P2"), false);
        assertThat(response.packages()).containsExactly(new TransportPackage("P2", "Package Two", TargetPackageStatus.CREATED));
        var creates = prd.findAll(postRequestedFor(urlEqualTo(PACKAGES)));
        assertThat(creates).hasSize(1);
        assertThat(json.readTree(creates.getFirst().getBodyAsString())).isEqualTo(json.readTree(
                "{\"Id\":\"P2\",\"Name\":\"Package Two\",\"ShortText\":\"short two\",\"Description\":\"long two\",\"Version\":\"2.0.1\"}"));
        var upload = prd.findAll(postRequestedFor(urlEqualTo(COLLECTION)));
        assertThat(upload).hasSize(1);
        assertThat(json.readTree(upload.getFirst().getBodyAsString()).path("PackageId").asString()).isEqualTo("P2");
        assertThat(upload.getFirst().getLoggedDate()).isAfterOrEqualTo(creates.getFirst().getLoggedDate());
        assertThat(response.results().getFirst().status()).isEqualTo(ArtifactStatus.SUCCESS);
        assertThat(output.getAll()).contains("step=PACKAGE_CREATE phase=START", "step=PACKAGE_CREATE phase=END result=OK");
    }

    @Test
    @DisplayName("REQ-604: a missing package that was not approved is NOT_FOUND and its artifacts fail with PACKAGE_NOT_FOUND_IN_TARGET without upload")
    void req604_notFound() {
        var response = run(List.of(new PackageSelection("P1", null), new PackageSelection("P2", null)), List.of(), false);
        assertThat(response.packages()).extracting(TransportPackage::targetPackage)
                .containsExactly(TargetPackageStatus.EXISTING, TargetPackageStatus.NOT_FOUND);
        var c = response.results().get(2);
        assertThat(c.artifactId()).isEqualTo("C");
        assertThat(c.status()).isEqualTo(ArtifactStatus.FAILED);
        assertThat(c.error().code()).isEqualTo("PACKAGE_NOT_FOUND_IN_TARGET");
        assertThat(response.results().subList(0, 2)).allSatisfy(r -> assertThat(r.status()).isEqualTo(ArtifactStatus.SUCCESS));
        prd.verify(0, postRequestedFor(urlEqualTo(PACKAGES)));
        prd.verify(0, postRequestedFor(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo("C"))));
        prd.verify(0, getRequestedFor(urlEqualTo(path("C"))));
    }

    @Test
    @DisplayName("REQ-604: a failed create marks CREATE_FAILED, fails that package's artifacts with a categorical message and continues with other packages")
    void req604_createFailed(CapturedOutput output) {
        prd.stubFor(post(urlEqualTo(PACKAGES)).willReturn(serverError().withBody("dummy-prd-secret Password=hidden-value")));
        var response = run(List.of(new PackageSelection("P2", null), new PackageSelection("P1", null)), List.of("P2"), false);
        assertThat(response.packages()).extracting(TransportPackage::targetPackage)
                .containsExactly(TargetPackageStatus.CREATE_FAILED, TargetPackageStatus.EXISTING);
        var c = response.results().getFirst();
        assertThat(c.status()).isEqualTo(ArtifactStatus.FAILED);
        assertThat(c.error().code()).isEqualTo("PACKAGE_CREATE_FAILED");
        assertThat(c.error().message()).isEqualTo("TARGET: HTTP 500; CPI call failed");
        assertThat(c.error().detail()).isNull();
        assertThat(response.results().subList(1, 3)).extracting(ArtifactResult::status)
                .containsExactly(ArtifactStatus.SUCCESS, ArtifactStatus.SUCCESS);
        prd.verify(0, postRequestedFor(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo("C"))));
        prd.verify(0, deleteRequestedFor(anyUrl()));
        assertThat(output.getAll()).contains("step=PACKAGE_CREATE phase=START", "step=PACKAGE_CREATE phase=END result=FAILED")
                .doesNotContain("dummy-prd-secret", "hidden-value");
    }

    @Test
    @DisplayName("REQ-604: a target check failure marks CHECK_FAILED, fails that package's artifacts with TARGET_CHECK_FAILED and creates nothing")
    void req604_checkFailed() {
        prd.stubFor(get(urlEqualTo(pkg("P2"))).willReturn(serverError()));
        var response = run(List.of(new PackageSelection("P2", null), new PackageSelection("P1", null)), List.of("P2"), false);
        assertThat(response.packages()).extracting(TransportPackage::targetPackage)
                .containsExactly(TargetPackageStatus.CHECK_FAILED, TargetPackageStatus.EXISTING);
        var c = response.results().getFirst();
        assertThat(c.status()).isEqualTo(ArtifactStatus.FAILED);
        assertThat(c.error().code()).isEqualTo("TARGET_CHECK_FAILED");
        assertThat(response.results().subList(1, 3)).extracting(ArtifactResult::status)
                .containsExactly(ArtifactStatus.SUCCESS, ArtifactStatus.SUCCESS);
        prd.verify(0, postRequestedFor(urlEqualTo(PACKAGES)));
        prd.verify(0, postRequestedFor(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo("C"))));
    }

    @Test
    @DisplayName("REQ-604: an artifact failure after CREATED keeps the created package and sends no DELETE")
    void req604_createdThenFailed() {
        prd.stubFor(post(urlEqualTo(COLLECTION)).willReturn(serverError()));
        var response = run(List.of(new PackageSelection("P2", null)), List.of("P2"), false);
        assertThat(response.packages()).extracting(TransportPackage::targetPackage).containsExactly(TargetPackageStatus.CREATED);
        assertThat(response.results().getFirst().error().code()).isEqualTo("UPLOAD_FAILED");
        prd.verify(0, deleteRequestedFor(anyUrl()));
    }

    @Test
    @DisplayName("REQ-604: a package approved for creation that already exists at run time is EXISTING and is not created")
    void req604_raceExisting() {
        var response = run(List.of(new PackageSelection("P1", null)), List.of("P1"), false);
        assertThat(response.packages()).containsExactly(new TransportPackage("P1", "Package One", TargetPackageStatus.EXISTING));
        prd.verify(0, postRequestedFor(urlEqualTo(PACKAGES)));
        assertThat(response.summary()).isEqualTo(new TransportSummary(2, 2, 0));
    }

    private TransportResponse run(List<PackageSelection> packages, List<String> create, boolean dryRun) {
        return service.preflightAndExecute(new TransportRequest(packages, create, dryRun, false, DEV, PRD));
    }

    private static String pkg(String id) { return PACKAGES + "('" + id + "')"; }
    private static String path(String id) { return COLLECTION + "(Id='" + id + "',Version='active')"; }
    private static CpiProperties.Connection connection(WireMockServer server, String env) {
        String base = "http://localhost:" + server.port();
        return new CpiProperties.Connection(base, base + "/token", "dummy-" + env + "-client", "dummy-" + env + "-secret");
    }
    private static byte[] zip(String id) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var out = new ZipOutputStream(bytes)) {
            out.putNextEntry(new ZipEntry("src/main/resources/scenarioflows/integrationflow/" + id + ".iflw"));
            out.write("<definitions/>".getBytes(StandardCharsets.UTF_8));
            out.closeEntry();
        }
        return bytes.toByteArray();
    }
}
