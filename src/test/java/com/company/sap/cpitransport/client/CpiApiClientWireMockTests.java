package com.company.sap.cpitransport.client;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.CpiPackage;
import com.company.sap.cpitransport.model.CpiArtifact;
import com.company.sap.cpitransport.model.CpiConfiguration;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;
import static com.company.sap.cpitransport.client.CpiEnvironment.*;

class CpiApiClientWireMockTests {
    private static final String ART = "/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Order',Version='active')";
    private WireMockServer server;
    private CpiApiClient api;
    @TempDir Path temporary;

    @BeforeEach
    void setUp() {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        server.start();
        String base = "http://localhost:" + server.port();
        var properties = new CpiProperties(
                new CpiProperties.Connection(base, base + "/dev/token", "dummy-dev-client", "dummy-dev-secret"),
                new CpiProperties.Connection(base, base + "/prd/token", "dummy-prd-client", "dummy-prd-secret"));
        var transport = new TransportProperties("", new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(1, Duration.ZERO),
                new TransportProperties.Deploy(Duration.ofSeconds(5), Duration.ofSeconds(300)), List.of());
        Sleeper sleeper = duration -> { throw new AssertionError("Unexpected wait"); };
        var tokens = new OAuthTokenProvider(properties, transport,
                Clock.fixed(Instant.parse("2026-09-29T00:00:00Z"), ZoneOffset.UTC), sleeper);
        api = new CpiApiClient(new CpiHttpExecutor(properties, tokens, new CsrfTokenStore(), transport, sleeper),
                JsonMapper.builder().build());
        for (String env : List.of("dev", "prd")) {
            server.stubFor(post(urlEqualTo("/" + env + "/token")).willReturn(okJson(
                    "{\"access_token\":\"dummy-" + env + "-token-0001\",\"expires_in\":3600}")));
            server.stubFor(get(urlEqualTo("/api/v1/"))
                    .withHeader("Authorization", equalTo("Bearer dummy-" + env + "-token-0001"))
                    .withHeader("X-CSRF-Token", equalTo("Fetch"))
                    .willReturn(ok().withHeader("X-CSRF-Token", "dummy-" + env + "-csrf-0001")
                            .withHeader("Set-Cookie", "JSESSIONID=dummy-" + env + "-session-0001; Path=/")));
        }
    }

    @AfterEach
    void tearDown() { if (server != null) server.stop(); }

    @Test
    @DisplayName("REQ-004 AC-1: package list and single OData parsing")
    void req004_ac1_packages() {
        String value = "{\"Id\":\"Pkg\",\"Name\":\"Orders\",\"Version\":\"1.0\",\"__metadata\":{}}";
        stubGet("/api/v1/IntegrationPackages", "{\"d\":{\"results\":[" + value + "]}}");
        stubGet("/api/v1/IntegrationPackages('Pkg')", "{\"d\":" + value + "}");
        var expected = new CpiPackage("Pkg", "Orders", "1.0");
        assertThat(api.listPackages(DEV)).containsExactly(expected);
        assertThat(api.getPackage(PRD, "Pkg")).contains(expected);
        verifyGet("/api/v1/IntegrationPackages", "dev");
        verifyGet("/api/v1/IntegrationPackages('Pkg')", "prd");
    }

    @Test
    @DisplayName("REQ-004 AC-2: artifact list parses names and versions")
    void req004_ac2_artifacts() {
        String path = "/api/v1/IntegrationPackages('Pkg')/IntegrationDesigntimeArtifacts";
        stubGet(path, "{\"d\":{\"results\":[{\"Id\":\"IF_Order\",\"Name\":\"Order\",\"Version\":\"2\"}]}}");
        assertThat(api.listArtifacts(DEV, "Pkg")).containsExactly(new CpiArtifact("IF_Order", "Order", "2"));
        verifyGet(path, "dev");
    }

    @Test
    @DisplayName("REQ-005 AC-4: existence and binary download preserve bytes")
    void req005_ac4_download() {
        stubGet(ART, "{\"d\":{\"Id\":\"IF_Order\"}}");
        byte[] zip = {80, 75, 3, 4, 0, -1, -128, 42};
        server.stubFor(get(urlEqualTo(ART + "/$value")).willReturn(ok().withBody(zip)));
        assertThat(api.artifactExists(PRD, "IF_Order")).isTrue();
        assertThat(api.downloadArtifact(DEV, "IF_Order")).isEqualTo(zip);
        verifyGet(ART, "prd");
        server.verify(getRequestedFor(urlEqualTo(ART + "/$value"))
                .withHeader("Authorization", equalTo("Bearer dummy-dev-token-0001"))
                .withHeader("Accept", absent()));
    }

    @Test
    @DisplayName("REQ-005 AC-4: create and update send exact JSON payloads")
    void req005_ac4_upload() {
        String base64 = Base64.getEncoder().encodeToString(new byte[]{80, 75, 0, -1});
        String create = "/api/v1/IntegrationDesigntimeArtifacts";
        server.stubFor(post(urlEqualTo(create)).willReturn(aResponse().withStatus(201)));
        server.stubFor(put(urlEqualTo(ART)).willReturn(aResponse().withStatus(204)));
        api.createArtifact(PRD, "Order", "IF_Order", "Pkg", base64);
        api.updateArtifact(PRD, "IF_Order", "Order", base64);
        server.verify(postRequestedFor(urlEqualTo(create)).withRequestBody(equalToJson(
                "{\"Name\":\"Order\",\"Id\":\"IF_Order\",\"PackageId\":\"Pkg\",\"ArtifactContent\":\"" + base64 + "\"}"))
                .withHeader("Content-Type", containing("application/json"))
                .withHeader("X-CSRF-Token", equalTo("dummy-prd-csrf-0001"))
                .withHeader("Cookie", equalTo("JSESSIONID=dummy-prd-session-0001")));
        server.verify(putRequestedFor(urlEqualTo(ART)).withRequestBody(equalToJson(
                "{\"Name\":\"Order\",\"ArtifactContent\":\"" + base64 + "\"}")));
    }

    @Test
    @DisplayName("REQ-008 AC-1: configuration GET and PUT preserve value and DataType")
    void req008_ac1_configurations() {
        stubGet(ART + "/Configurations", "{\"d\":{\"results\":[{\"ParameterKey\":\"Endpoint\","
                + "\"ParameterValue\":\"http://dev.localhost/orders\",\"DataType\":\"xsd:string\"}]}}");
        assertThat(api.getConfigurations(PRD, "IF_Order")).containsExactly(
                new CpiConfiguration("Endpoint", "http://dev.localhost/orders", "xsd:string"));
        String path = ART + "/$links/Configurations('Endpoint')";
        server.stubFor(put(urlEqualTo(path)).willReturn(aResponse().withStatus(204)));
        api.updateConfiguration(PRD, "IF_Order", "Endpoint", "http://prd.localhost/orders", "xsd:string");
        verifyGet(ART + "/Configurations", "prd");
        server.verify(putRequestedFor(urlEqualTo(path)).withRequestBody(equalToJson(
                "{\"ParameterValue\":\"http://prd.localhost/orders\",\"DataType\":\"xsd:string\"}")));
    }

    @Test
    @DisplayName("REQ-008 AC-1: configuration keys escape OData quotes and URI delimiters")
    void req008_ac1_encodedKey() {
        String path = ART + "/$links/Configurations('a%27%27%2F%3F%23%25%20%ED%82%A4')";
        server.stubFor(put(urlEqualTo(path)).willReturn(aResponse().withStatus(204)));
        api.updateConfiguration(PRD, "IF_Order", "a'/?#% \uD0A4", "value", "xsd:string");
        server.verify(putRequestedFor(urlEqualTo(path)).withRequestBody(equalToJson(
                "{\"ParameterValue\":\"value\",\"DataType\":\"xsd:string\"}")));
    }

    @Test
    @DisplayName("REQ-009 AC-1: deployment query and runtime status")
    void req009_ac1_deploy() {
        String deploy = "/api/v1/DeployIntegrationDesigntimeArtifact?Id='IF_Order'&Version='active'";
        String runtime = "/api/v1/IntegrationRuntimeArtifacts('IF_Order')";
        server.stubFor(post(urlEqualTo(deploy)).willReturn(aResponse().withStatus(202)));
        stubGet(runtime, "{\"d\":{\"Status\":\"STARTED\"}}");
        api.deploy(PRD, "IF_Order");
        assertThat(api.getRuntimeStatus(PRD, "IF_Order")).contains("STARTED");
        server.verify(postRequestedFor(urlEqualTo(deploy)));
        assertThat(server.findAll(postRequestedFor(urlEqualTo(deploy))).getFirst().getBody()).isEmpty();
        verifyGet(runtime, "prd");
    }

    @Test
    @DisplayName("REQ-005 AC-5: resource 404 maps to empty package, absent artifact and pending runtime")
    void req005_ac5_resource404() {
        assertThat(api.getPackage(PRD, "Missing")).isEmpty();
        assertThat(api.artifactExists(PRD, "Missing")).isFalse();
        assertThat(api.getRuntimeStatus(PRD, "Missing")).isEmpty();
        verifyGet("/api/v1/IntegrationPackages('Missing')", "prd");
        verifyGet("/api/v1/IntegrationDesigntimeArtifacts(Id='Missing',Version='active')", "prd");
        verifyGet("/api/v1/IntegrationRuntimeArtifacts('Missing')", "prd");
    }

    @Test
    @DisplayName("REQ-004 AC-3: missing package differs from empty artifact collection")
    void req004_ac3_missingPackage() {
        assertThatThrownBy(() -> api.listArtifacts(DEV, "Missing"))
                .isInstanceOfSatisfying(CpiCallException.class, ex -> assertThat(ex.httpStatus()).isEqualTo(404));
        stubGet("/api/v1/IntegrationPackages('Empty')/IntegrationDesigntimeArtifacts", "{\"d\":{\"results\":[]}}");
        assertThat(api.listArtifacts(DEV, "Empty")).isEmpty();
    }

    @Test
    @DisplayName("REQ-004 AC-5: token 404 is never converted into missing resource")
    void req004_ac5_token404() {
        server.stubFor(post(urlEqualTo("/prd/token")).willReturn(notFound()));
        assertThatThrownBy(() -> api.getPackage(PRD, "Pkg")).isInstanceOf(CpiCallException.class);
        assertThatThrownBy(() -> api.artifactExists(PRD, "IF_Order")).isInstanceOf(CpiCallException.class);
        assertThatThrownBy(() -> api.getRuntimeStatus(PRD, "IF_Order")).isInstanceOf(CpiCallException.class);
        server.verify(0, getRequestedFor(urlMatching("/api/v1/.*")));
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 403, 500})
    @DisplayName("REQ-005 AC-5: non-404 failures propagate")
    void req005_ac5_otherFailures(int status) {
        server.stubFor(get(urlMatching("/api/v1/.*")).willReturn(aResponse().withStatus(status)));
        assertThatThrownBy(() -> api.getPackage(PRD, "Pkg"))
                .isInstanceOfSatisfying(CpiCallException.class, ex -> assertThat(ex.httpStatus()).isEqualTo(status));
        assertThatThrownBy(() -> api.artifactExists(PRD, "IF_Order")).isInstanceOf(CpiCallException.class);
        assertThatThrownBy(() -> api.getRuntimeStatus(PRD, "IF_Order")).isInstanceOf(CpiCallException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"not-json", "{}", "{\"d\":{}}", "{\"d\":{\"results\":[{}]}}"})
    @DisplayName("REQ-004 AC-1: malformed responses fail with sanitized diagnostics")
    void req004_ac1_malformed(String body) {
        stubGet("/api/v1/IntegrationPackages", body);
        assertThatThrownBy(() -> api.listPackages(DEV)).isInstanceOf(CpiCallException.class)
                .hasMessage("Invalid CPI OData response").hasNoCause();
    }

    @Test
    @DisplayName("REQ-004 AC-4: unsafe identifiers rejected before HTTP calls")
    void req004_ac4_rejectIdentifiers() {
        String bad = "bad'id";
        assertThatThrownBy(() -> api.getPackage(DEV, bad)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> api.listArtifacts(DEV, bad)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> api.artifactExists(PRD, bad)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> api.downloadArtifact(DEV, bad)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> api.createArtifact(PRD, "Name", bad, "Pkg", "UEs="))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> api.createArtifact(PRD, "Name", "IF_Order", bad, "UEs="))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> api.updateArtifact(PRD, bad, "Name", "UEs="))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> api.getConfigurations(PRD, bad)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> api.updateConfiguration(PRD, bad, "Key", "Value", "Type"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> api.deploy(PRD, bad)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> api.getRuntimeStatus(PRD, bad)).isInstanceOf(IllegalArgumentException.class);
        assertThat(server.getAllServeEvents()).isEmpty();
    }

    private void stubGet(String path, String body) {
        server.stubFor(get(urlEqualTo(path)).willReturn(okJson(body)));
    }

    private void verifyGet(String path, String environment) {
        server.verify(getRequestedFor(urlEqualTo(path))
                .withHeader("Authorization", equalTo("Bearer dummy-" + environment + "-token-0001"))
                .withHeader("Accept", equalTo("application/json")));
    }
}
