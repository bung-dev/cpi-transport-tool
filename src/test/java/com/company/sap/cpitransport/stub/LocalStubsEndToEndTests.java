package com.company.sap.cpitransport.stub;

import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.model.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static com.github.tomakehurst.wiremock.client.WireMock.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = {com.company.sap.cpitransport.CpiTransportToolApplication.class, LocalStubsEndToEndTests.TimeConfig.class})
class LocalStubsEndToEndTests {
    @TempDir static Path temporary;
    static LocalCpiStubs stubs;
    @LocalServerPort int port;
    static final JsonMapper JSON = new JsonMapper();

    @TestConfiguration(proxyBeanMethods = false)
    static class TimeConfig {
        @Bean @Primary Clock testClock() { return Clock.fixed(Instant.parse("2026-09-29T00:00:00Z"), ZoneOffset.UTC); }
        @Bean @Primary Sleeper testSleeper() { return duration -> {}; }
    }
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) throws Exception {
        registry.add("cpi.transport.read-only", () -> "false");
        stubs = new LocalCpiStubs(temporary.resolve("dev-zips"));
        stubs.start(0, 0);
        for (String env : List.of("dev", "prd")) {
            String base = "http://localhost:" + (env.equals("dev") ? stubs.dev().port() : stubs.prd().port());
            String prefix = "cpi.environments." + env + ".";
            registry.add(prefix + "api-url", () -> base);
            registry.add(prefix + "token-url", () -> base + "/oauth/token");
            registry.add(prefix + "client-id", () -> "dummy-" + env + "-client");
            registry.add(prefix + "client-secret", () -> "dummy-" + env + "-secret");
        }
        // REQ-505: 남은 매핑 설정(없는 파일)은 무시되어야 한다.
        registry.add("cpi.transport.mapping-file", () -> temporary.resolve("missing-mapping.yml").toString());
        registry.add("cpi.transport.history.file", () -> temporary.resolve("history.jsonl").toString());
    }
    @AfterAll static void stop() { if (stubs != null) stubs.stop(); }
    @BeforeEach void reset() { stubs.dev().resetScenarios(); stubs.prd().resetScenarios(); stubs.prd().resetRequests(); }

    private TransportResponse transport(boolean dryRun) throws Exception {
        return transport("{\"packageId\":\"PkgTransportDemo\",\"dryRun\":" + dryRun + "}");
    }
    private TransportResponse transport(String body) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/transport"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return JSON.readValue(response.body(), TransportResponse.class);
    }
    private static final String ORDER = "/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Order_Sync',Version='active')";
    private static final String CUSTOMER = "/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Customer_Push',Version='active')";

    @Test
    @DisplayName("REQ-506, REQ-501, REQ-502, REQ-505: localhost app uploads both fixtures unchanged and copies every source configuration value without reading the target while a leftover mapping-file setting is ignored")
    void req506_realTransportCopiesConfigurations() throws Exception {
        var response = transport(false);
        assertThat(response.summary().failed()).isZero();
        var byId = byId(response);
        var order = byId.get("IF_Order_Sync");
        var customer = byId.get("IF_Customer_Push");
        assertThat(order.action()).isEqualTo(TransportAction.UPDATED);
        assertThat(customer.action()).isEqualTo(TransportAction.CREATED);
        assertThat(order.configurations()).containsExactly(
                new ConfigurationItem("Endpoint", "http://dev-backend.localhost/orders", "xsd:string", ConfigurationStatus.COPIED),
                new ConfigurationItem("BatchSize", "100", "xsd:integer", ConfigurationStatus.COPIED),
                new ConfigurationItem("ApiToken", "", "xsd:string", ConfigurationStatus.SKIPPED_EMPTY));
        assertThat(customer.configurations()).containsExactly(
                new ConfigurationItem("ReceiverUrl", "http://dev-receiver.localhost/customers", "xsd:string", ConfigurationStatus.COPIED),
                new ConfigurationItem("Timeout", "30000", "xsd:integer", ConfigurationStatus.COPIED),
                new ConfigurationItem("ClientPassword", "dummy-dev-pass-XYZ", "xsd:string", ConfigurationStatus.COPIED),
                new ConfigurationItem("LogLevel", "INFO", "xsd:string", ConfigurationStatus.COPIED));
        // REQ-502: 원본 키를 모두 원본 DataType으로 PUT하고, 빈 민감 값은 쓰지 않으며, 대상 구성 값은 읽지 않는다.
        stubs.prd().verify(1, putRequestedFor(urlPathEqualTo(ORDER + "/$links/Configurations('Endpoint')"))
                .withRequestBody(equalToJson("{\"ParameterValue\":\"http://dev-backend.localhost/orders\",\"DataType\":\"xsd:string\"}")));
        stubs.prd().verify(1, putRequestedFor(urlPathEqualTo(CUSTOMER + "/$links/Configurations('Timeout')"))
                .withRequestBody(equalToJson("{\"ParameterValue\":\"30000\",\"DataType\":\"xsd:integer\"}")));
        stubs.prd().verify(1, putRequestedFor(urlPathEqualTo(CUSTOMER + "/$links/Configurations('ClientPassword')"))
                .withRequestBody(equalToJson("{\"ParameterValue\":\"dummy-dev-pass-XYZ\",\"DataType\":\"xsd:string\"}")));
        stubs.prd().verify(0, putRequestedFor(urlPathEqualTo(ORDER + "/$links/Configurations('ApiToken')")));
        stubs.prd().verify(6, putRequestedFor(urlPathMatching(".*/\\$links/Configurations.*")));
        stubs.prd().verify(0, getRequestedFor(urlPathMatching(".*/Configurations")));
        // REQ-501: 업로드 내용은 원본 zip과 바이트 단위로 같다.
        var update = stubs.prd().findAll(putRequestedFor(urlPathEqualTo(ORDER)));
        assertThat(update).hasSize(1);
        assertThat(uploaded(update.getFirst().getBodyAsString())).isEqualTo(Files.readAllBytes(temporary.resolve("dev-zips/IF_Order_Sync.zip")));
        var create = stubs.prd().findAll(postRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts")));
        assertThat(create).hasSize(1);
        assertThat(uploaded(create.getFirst().getBodyAsString())).isEqualTo(Files.readAllBytes(temporary.resolve("dev-zips/IF_Customer_Push.zip")));
        try (var files = Files.list(temporary.resolve("dev-zips"))) {
            assertThat(files.count()).isEqualTo(23);
        }
    }
    @Test
    @DisplayName("REQ-506, REQ-503: preview reads only the source, shows PLANNED and SKIPPED_EMPTY together and sends nothing to the target")
    void req506_previewPlansAndReadsTarget() throws Exception {
        var byId = byId(transport(true));
        var order = byId.get("IF_Order_Sync");
        var customer = byId.get("IF_Customer_Push");
        assertThat(order.action()).isEqualTo(TransportAction.NONE);
        assertThat(order.configurations()).extracting(ConfigurationItem::key, ConfigurationItem::status).containsExactly(
                tuple("Endpoint", ConfigurationStatus.PLANNED), tuple("BatchSize", ConfigurationStatus.PLANNED),
                tuple("ApiToken", ConfigurationStatus.SKIPPED_EMPTY));
        assertThat(customer.configurations()).extracting(ConfigurationItem::key, ConfigurationItem::status).containsExactly(
                tuple("ReceiverUrl", ConfigurationStatus.PLANNED), tuple("Timeout", ConfigurationStatus.PLANNED),
                tuple("ClientPassword", ConfigurationStatus.PLANNED), tuple("LogLevel", ConfigurationStatus.PLANNED));
        assertThat(customer.configurations()).filteredOn(c -> c.key().equals("ClientPassword"))
                .extracting(ConfigurationItem::value).containsExactly("dummy-dev-pass-XYZ");
        assertThat(stubs.prd().getAllServeEvents()).isEmpty();
    }
    @Test
    @DisplayName("REQ-506, REQ-501, REQ-502: fault fixtures keep PUT failure, source read 500 and PUT 401 retry while unparsable bundles now upload unchanged")
    void req506_faultFixtures() throws Exception {
        var byId = byId(transport("{\"packageId\":\"PkgFaultDemo\",\"dryRun\":false,\"artifactIds\":"
                + "[\"IF_Fault_ParamPutFail\",\"IF_Fault_BadXml\",\"IF_Fault_NotZip\",\"IF_Fault_ConfigRead500\",\"IF_Fault_AuthRetry\"]}"));
        var put = byId.get("IF_Fault_ParamPutFail");
        assertThat(put.error().code()).isEqualTo("CONFIGURATION_UPDATE_FAILED");
        assertThat(put.error().message()).contains("ParamA: HTTP 500").doesNotContain("a-dev", "b-dev");
        assertThat(put.configurations()).extracting(ConfigurationItem::key, ConfigurationItem::status).containsExactly(
                tuple("ParamA", ConfigurationStatus.FAILED), tuple("ParamB", ConfigurationStatus.COPIED));
        assertThat(byId.get("IF_Fault_BadXml").status()).isEqualTo(ArtifactStatus.SUCCESS);
        assertThat(byId.get("IF_Fault_NotZip").status()).isEqualTo(ArtifactStatus.SUCCESS);
        var read = byId.get("IF_Fault_ConfigRead500");
        assertThat(read.error().code()).isEqualTo("CONFIGURATION_READ_FAILED");
        assertThat(read.action()).isEqualTo(TransportAction.NONE);
        assertThat(read.configurations()).isEmpty();
        stubs.prd().verify(0, postRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts"))
                .withRequestBody(matchingJsonPath("$.Id", equalTo("IF_Fault_ConfigRead500"))));
        var retry = byId.get("IF_Fault_AuthRetry");
        assertThat(retry.status()).isEqualTo(ArtifactStatus.SUCCESS);
        assertThat(retry.configurations()).extracting(ConfigurationItem::status).containsExactly(ConfigurationStatus.COPIED);
        var notZip = stubs.prd().findAll(postRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts"))
                .withRequestBody(matchingJsonPath("$.Id", equalTo("IF_Fault_NotZip"))));
        assertThat(notZip).hasSize(1);
        assertThat(new String(uploaded(notZip.getFirst().getBodyAsString()), java.nio.charset.StandardCharsets.UTF_8)).isEqualTo("NOT-A-ZIP-FILE");
    }
    private static Map<String, ArtifactResult> byId(TransportResponse response) {
        var byId = new HashMap<String, ArtifactResult>();
        response.results().forEach(result -> byId.put(result.artifactId(), result));
        return byId;
    }
    private static byte[] uploaded(String body) {
        return Base64.getDecoder().decode(JSON.readTree(body).path("ArtifactContent").asString());
    }
    @Test
    @DisplayName("REQ-014 AC-5: dummy authentication and CSRF gates reject missing credentials")
    void req014_ac5_authenticationGates() throws Exception {
        for (boolean dev : List.of(true, false)) {
            String env = dev ? "dev" : "prd";
            String base = "http://localhost:" + (dev ? stubs.dev().port() : stubs.prd().port());
            var client = HttpClient.newHttpClient();
            var uri = URI.create(base + "/api/v1/unknown");
            assertThat(client.send(HttpRequest.newBuilder(uri).GET().build(), HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(401);
            for (boolean csrf : List.of(false, true)) {
                var builder = HttpRequest.newBuilder(uri).header("Authorization", "Bearer dummy-" + env + "-token-0001")
                        .POST(HttpRequest.BodyPublishers.noBody());
                if (csrf) builder.header("X-CSRF-Token", "dummy-" + env + "-csrf-0001");
                assertThat(client.send(builder.build(), HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(403);
            }
        }
    }
}
