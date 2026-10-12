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
import tools.jackson.dataformat.yaml.YAMLMapper;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
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
        registry.add("cpi.transport.mapping-file", () -> temporary.resolve("mapping.yml").toString());
        registry.add("cpi.transport.history.file", () -> temporary.resolve("history.jsonl").toString());
    }
    @AfterAll static void stop() { if (stubs != null) stubs.stop(); }
    @BeforeEach void reset() { stubs.dev().resetScenarios(); stubs.prd().resetScenarios(); stubs.prd().resetRequests(); }

    private TransportResponse transport(boolean dryRun) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/transport"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"packageId\":\"PkgTransportDemo\",\"dryRun\":" + dryRun + "}")).build();
        var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return JSON.readValue(response.body(), TransportResponse.class);
    }
    @Test
    @DisplayName("REQ-014 AC-1, AC-2, AC-3: localhost app transports both fixtures with equivalent YAML and JSON examples")
    void req014_ac1_examplesProduceExpectedReplacements() throws Exception {
        var yaml = new YAMLMapper().readTree(Files.readString(Path.of("examples/mapping-example.yml")));
        var json = JSON.readTree(Files.readString(Path.of("examples/mapping-example.json")));
        assertThat(yaml).isEqualTo(json);
        assertThat(json.path("mappings").size()).isEqualTo(12);
        var yamlEntries = new com.company.sap.cpitransport.service.MappingFileLoader(
                new com.company.sap.cpitransport.config.TransportProperties("examples/mapping-example.yml", null, null, null, List.of())).load();
        var jsonEntries = new com.company.sap.cpitransport.service.MappingFileLoader(
                new com.company.sap.cpitransport.config.TransportProperties("examples/mapping-example.json", null, null, null, List.of())).load();
        assertThat(jsonEntries).isEqualTo(yamlEntries);
        List<ArtifactResult> previous = null;
        for (String extension : List.of("yml", "json")) {
            // JSON is a YAML subset; the app reloads this temporary mapping on each request.
            Files.copy(Path.of("examples/mapping-example." + extension), temporary.resolve("mapping.yml"), StandardCopyOption.REPLACE_EXISTING);
            var response = transport(false);
            verifyResults(response, false);
            if (previous != null) assertThat(response.results()).isEqualTo(previous);
            previous = response.results();
        }
        stubs.prd().verify(2, putRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Order_Sync',Version='active')")));
        stubs.prd().verify(2, postRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts")));
        try (var files = Files.list(temporary.resolve("dev-zips"))) {
            assertThat(files.count()).isEqualTo(23);
        }
    }
    @Test
    @DisplayName("REQ-014 AC-3: dry run plans replacements and performs no PRD writes")
    void req014_ac3_dryRun() throws Exception {
        Files.copy(Path.of("examples/mapping-example.yml"), temporary.resolve("mapping.yml"), StandardCopyOption.REPLACE_EXISTING);
        verifyResults(transport(true), true);
        assertThat(stubs.prd().getAllServeEvents()).noneMatch(event ->
                event.getRequest().getUrl().startsWith("/api/v1/")
                        && Set.of("POST", "PUT").contains(event.getRequest().getMethod().getName()));
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
    private void verifyResults(TransportResponse response, boolean dryRun) {
        assertThat(response.summary().failed()).isZero();
        assertThat(response.results()).hasSize(2);
        var byId = new HashMap<String, ArtifactResult>();
        response.results().forEach(result -> byId.put(result.artifactId(), result));
        var order = byId.get("IF_Order_Sync");
        var customer = byId.get("IF_Customer_Push");
        var applied = dryRun ? ReplacementStatus.PLANNED : ReplacementStatus.APPLIED;
        assertThat(order.action()).isEqualTo(dryRun ? TransportAction.NONE : TransportAction.UPDATED);
        assertThat(customer.action()).isEqualTo(dryRun ? TransportAction.NONE : TransportAction.CREATED);
        assertThat(order.replacements()).containsExactlyInAnyOrder(
                new Replacement(TargetType.HEADER, "TargetSystem", applied, "DEV_ERP", "PRD_ERP", 2),
                new Replacement(TargetType.HEADER, "ApiKey", ReplacementStatus.SENSITIVE_SKIPPED, "***", "***", 1),
                new Replacement(TargetType.HEADER, "Filter", applied, "a&b<c>\"d'e", "x&y<z>\"w'v", 1),
                new Replacement(TargetType.PROPERTY, "Endpoint", applied, "http://dev-backend.localhost/orders", "http://prd-backend.localhost/orders", 1),
                new Replacement(TargetType.PROPERTY, "Endpoint", ReplacementStatus.VALUE_MISMATCH, "http://other-backend.localhost/orders", "http://other-backend.localhost/orders", 1),
                new Replacement(TargetType.PROPERTY, "NotExisting", ReplacementStatus.KEY_NOT_FOUND, null, null, 0));
        assertThat(customer.replacements()).containsExactlyInAnyOrder(
                new Replacement(TargetType.PROPERTY, "Region", applied, "KR-DEV", "KR-PRD", 1),
                new Replacement(TargetType.EXTERNAL_PARAM, "ReceiverUrl", applied, "http://dev-receiver.localhost/customers", "http://prd-receiver.localhost/customers", 1),
                new Replacement(TargetType.EXTERNAL_PARAM, "Timeout", ReplacementStatus.VALUE_MISMATCH, "30000", "30000", 1),
                new Replacement(TargetType.EXTERNAL_PARAM, "ClientPassword", ReplacementStatus.SENSITIVE_SKIPPED, "***", "***", 1),
                new Replacement(TargetType.EXTERNAL_PARAM, "MissingParam", ReplacementStatus.KEY_NOT_FOUND, null, null, 0));
        assertThat(order.unmappedKeys()).containsExactlyInAnyOrder(new UnmappedKey(TargetType.HEADER, "TraceId"), new UnmappedKey(TargetType.PROPERTY, "Mode"));
        assertThat(customer.unmappedKeys()).containsExactlyInAnyOrder(new UnmappedKey(TargetType.HEADER, "Channel"), new UnmappedKey(TargetType.EXTERNAL_PARAM, "LogLevel"));
    }
}
