package com.company.sap.cpitransport.stub;

import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.tenant.TenantStoreKeySource;
import com.github.tomakehurst.wiremock.WireMockServer;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.security.SecureRandom;
import java.util.*;
import java.util.jar.Manifest;
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
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = {CpiTransportToolApplication.class, RealSampleEndToEndTests.Keys.class})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RealSampleEndToEndTests {
    @TempDir static Path directory;
    @LocalServerPort int port;
    static RealSampleStub source;
    static WireMockServer target;
    static final JsonMapper JSON = new JsonMapper();
    static final String KEY = randomKey();
    private String targetId;

    private static String randomKey() {
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }
    @TestConfiguration(proxyBeanMethods = false)
    static class Keys {
        @Bean @Primary TenantStoreKeySource testKey() { return () -> Optional.of(KEY); }
    }
    @DynamicPropertySource static void configure(DynamicPropertyRegistry properties) throws Exception {
        source = new RealSampleStub(); source.start(0);
        target = new WireMockServer(options().bindAddress("localhost").dynamicPort()); target.start();
        String base = "http://localhost:" + source.dev().port();
        properties.add("cpi.environments.dev.api-url", () -> base);
        properties.add("cpi.environments.dev.token-url", () -> base + "/oauth/token");
        properties.add("cpi.environments.dev.client-id", () -> "dummy-dev-client");
        properties.add("cpi.environments.dev.client-secret", () -> "dummy-dev-secret");
        for (String field : List.of("api-url", "token-url", "client-id", "client-secret"))
            properties.add("cpi.environments.prd." + field, () -> "");
        properties.add("cpi.transport.read-only", () -> "false");
        properties.add("cpi.transport.mapping-file", () -> Path.of("examples/real-transport-mapping.yml").toAbsolutePath().toString());
        properties.add("cpi.transport.history.file", () -> directory.resolve("history.jsonl").toString());
        properties.add("cpi.tenants.store-file", () -> directory.resolve("tenants.enc").toString());
    }
    @AfterAll static void stop() { if (source != null) source.stop(); if (target != null) target.stop(); }

    private HttpResponse<String> postJson(String path, Object body) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(),
                HttpResponse.BodyHandlers.ofString());
    }
    @BeforeEach void register() throws Exception {
        target.resetRequests(); source.dev().resetRequests();
        var registration = postJson("/tenants", Map.of("name", "Sample target " + UUID.randomUUID().toString().substring(0, 8), "serviceKey", Map.of("oauth", Map.of(
                "url", "http://localhost:" + target.port(), "tokenurl", "http://localhost:" + target.port() + "/oauth/token",
                "clientid", "test-dummy-target-client", "clientsecret", "test-dummy-target-secret"))));
        assertThat(registration.statusCode()).isEqualTo(201);
        var tenant = JSON.readTree(registration.body()); targetId = tenant.path("id").asString();
        assertThat(targetId).isNotBlank();
        target.stubFor(post(urlPathEqualTo("/oauth/token")).withBasicAuth("test-dummy-target-client", "test-dummy-target-secret")
                .withRequestBody(equalTo("grant_type=client_credentials"))
                .willReturn(okJson("{\"access_token\":\"test-dummy-target-token\",\"expires_in\":3600}")));
        target.stubFor(any(urlPathMatching("/api/v1/.*")).atPriority(1)
                .withHeader("Authorization", notMatching("Bearer test-dummy-target-token")).willReturn(aResponse().withStatus(401)));
        for (String method : List.of("POST", "PUT")) {
            target.stubFor(request(method, urlPathMatching("/api/v1/.*")).atPriority(2)
                    .withHeader("X-CSRF-Token", notMatching("test-dummy-target-csrf"))
                    .willReturn(aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required")));
            target.stubFor(request(method, urlPathMatching("/api/v1/.*")).atPriority(2)
                    .withCookie("JSESSIONID", notMatching("test-dummy-target-session"))
                    .willReturn(aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required")));
        }
        target.stubFor(get(urlPathEqualTo("/api/v1/")).withHeader("X-CSRF-Token", equalTo("Fetch"))
                .willReturn(ok().withHeader("X-CSRF-Token", "test-dummy-target-csrf")
                        .withHeader("Set-Cookie", "JSESSIONID=test-dummy-target-session; Path=/")));
        target.stubFor(get(urlPathEqualTo("/api/v1/IntegrationPackages('CPITransportRealTest')"))
                .willReturn(okJson("{\"d\":{\"Id\":\"CPITransportRealTest\",\"Name\":\"Sample package\",\"Version\":\"1.0.0\"}}")));
        target.stubFor(get(urlPathEqualTo(RealSampleStub.ARTIFACT)).willReturn(notFound()));
        target.stubFor(post(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts")).willReturn(created()));
        target.stubFor(get(urlPathEqualTo(RealSampleStub.ARTIFACT + "/Configurations"))
                .willReturn(okJson("{\"d\":{\"results\":[{\"ParameterKey\":\"SampleMessage\",\"ParameterValue\":\"DEV_MESSAGE\",\"DataType\":\"xsd:string\"}]}}")));
        target.stubFor(put(urlPathEqualTo(RealSampleStub.ARTIFACT + "/$links/Configurations('SampleMessage')")).willReturn(aResponse().withStatus(202)));
        target.stubFor(post(urlPathEqualTo("/api/v1/DeployIntegrationDesigntimeArtifact"))
                .withQueryParam("Id", equalTo("'CPITT_Sample_Push'")).withQueryParam("Version", equalTo("'active'"))
                .willReturn(aResponse().withStatus(202)));
        target.stubFor(get(urlPathEqualTo("/api/v1/IntegrationRuntimeArtifacts('CPITT_Sample_Push')"))
                .willReturn(okJson("{\"d\":{\"Id\":\"CPITT_Sample_Push\",\"Status\":\"STARTED\"}}")));
    }

    private TransportResponse transport(boolean dryRun) throws Exception {
        var response = postJson("/transport", Map.of("packageId", RealSampleStub.PACKAGE, "sourceTenantId", "DEV",
                "targetTenantId", targetId, "dryRun", dryRun, "deploy", !dryRun));
        assertThat(response.statusCode()).isEqualTo(200);
        return JSON.readValue(response.body(), TransportResponse.class);
    }
    @Test @DisplayName("REQ-306 AC-3: sample dry run plans all three replacements without any registered target request")
    void req306_ac3_dryRun() throws Exception {
        var response = transport(true);
        assertThat(response.summary().failed()).isZero();
        assertThat(response.results()).singleElement().satisfies(result -> {
            assertThat(result.status()).isEqualTo(ArtifactStatus.SUCCESS);
            assertThat(result.replacements()).containsExactlyInAnyOrder(
                    new Replacement(TargetType.HEADER, "SampleHeader", ReplacementStatus.PLANNED, "DEV_HEADER", "TARGET_HEADER", 1),
                    new Replacement(TargetType.PROPERTY, "SampleProperty", ReplacementStatus.PLANNED, "DEV_PROPERTY", "TARGET_PROPERTY", 1),
                    new Replacement(TargetType.EXTERNAL_PARAM, "SampleMessage", ReplacementStatus.PLANNED, "DEV_MESSAGE", "TARGET_MESSAGE", 1));
        });
        assertThat(target.getAllServeEvents()).isEmpty();
    }

    @Test @DisplayName("REQ-306 AC-2·AC-3 / REQ-308 AC-3: registered target mock receives created bundle parameter update and deployment")
    void req306_ac2_createdAndDeployed() throws Exception {
        var response = transport(false);
        assertThat(response.summary().failed()).isZero();
        assertThat(response.sourceTenant()).isEqualTo(new TenantRef("DEV", "DEV"));
        assertThat(response.targetTenant().id()).isEqualTo(targetId);
        assertThat(response.targetTenant().name()).startsWith("Sample target ");
        assertThat(response.results()).singleElement().satisfies(result -> {
            assertThat(result.status()).isEqualTo(ArtifactStatus.SUCCESS);
            assertThat(result.action()).isEqualTo(TransportAction.CREATED);
            assertThat(result.deployStatus()).isEqualTo(DeployStatus.STARTED);
            assertThat(result.replacements()).hasSize(3).allSatisfy(r -> assertThat(r.status()).isEqualTo(ReplacementStatus.APPLIED));
        });
        var uploads = target.findAll(postRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts")));
        assertThat(uploads).hasSize(1);
        var upload = JSON.readTree(uploads.get(0).getBody());
        assertThat(upload.path("Id").asString()).isEqualTo(RealSampleStub.ID);
        assertThat(upload.path("PackageId").asString()).isEqualTo(RealSampleStub.PACKAGE);
        var entries = RealSampleStubTests.entries(Base64.getDecoder().decode(upload.path("ArtifactContent").asString()));
        var document = RealSampleStubTests.parse(entries.get("src/main/resources/scenarioflows/integrationflow/CPITT_Sample_Push.iflw"));
        assertThat(document.getDocumentElement().getTextContent()).contains("TARGET_HEADER", "TARGET_PROPERTY").doesNotContain("DEV_HEADER", "DEV_PROPERTY");
        var original = RealSampleStubTests.entries(source.bundle());
        assertThat(entries.get("META-INF/MANIFEST.MF")).isEqualTo(original.get("META-INF/MANIFEST.MF"));
        var manifest = new Manifest(new ByteArrayInputStream(entries.get("META-INF/MANIFEST.MF")));
        assertThat(manifest.getMainAttributes().getValue("Bundle-SymbolicName")).isEqualTo(RealSampleStub.ID + "; singleton:=true");
        var updates = target.findAll(putRequestedFor(urlPathEqualTo(RealSampleStub.ARTIFACT + "/$links/Configurations('SampleMessage')")));
        assertThat(updates).hasSize(1);
        assertThat(JSON.readTree(updates.get(0).getBody()).path("ParameterValue").asString()).isEqualTo("TARGET_MESSAGE");
        target.verify(1, postRequestedFor(urlPathEqualTo("/api/v1/DeployIntegrationDesigntimeArtifact")));
        target.verify(1, getRequestedFor(urlPathEqualTo("/api/v1/IntegrationRuntimeArtifacts('CPITT_Sample_Push')")));
        target.verify(1, postRequestedFor(urlPathEqualTo("/oauth/token")));
        target.verify(1, getRequestedFor(urlPathEqualTo(RealSampleStub.ARTIFACT)));
        target.verify(1, getRequestedFor(urlPathEqualTo(RealSampleStub.ARTIFACT + "/Configurations")));
        source.dev().verify(1, getRequestedFor(urlPathEqualTo(RealSampleStub.ARTIFACT + "/$value")));
        assertThat(source.dev().getAllServeEvents()).noneMatch(event -> Set.of("POST", "PUT").contains(event.getRequest().getMethod().getName())
                && event.getRequest().getUrl().startsWith("/api/v1/"));
    }
}
