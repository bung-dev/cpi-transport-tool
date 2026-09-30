package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static com.company.sap.cpitransport.model.ReplacementStatus.*;
import static com.company.sap.cpitransport.model.TargetType.*;
import static org.assertj.core.api.Assertions.*;

@ExtendWith(OutputCaptureExtension.class)
class ExternalParameterReplacerWireMockTests {
    private static final String ART = "/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Order',Version='active')";
    private WireMockServer server;
    private ExternalParameterReplacer replacer;
    private final List<Duration> waits = new ArrayList<>();
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
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(5), Duration.ofSeconds(300)),
                List.of("password", "secret", "token"));
        Sleeper sleeper = waits::add;
        var tokens = new OAuthTokenProvider(properties, transport,
                Clock.fixed(Instant.parse("2026-09-29T00:00:00Z"), ZoneOffset.UTC), sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(properties, tokens, new CsrfTokenStore(), transport, sleeper),
                JsonMapper.builder().build());
        replacer = new ExternalParameterReplacer(api, new SensitiveKeyMatcher(transport));
        for (String env : List.of("dev", "prd")) {
            server.stubFor(post(urlEqualTo("/" + env + "/token")).willReturn(okJson(
                    "{\"access_token\":\"dummy-" + env + "-token-0001\",\"expires_in\":3600}")));
        }
        server.stubFor(get(urlEqualTo("/api/v1/")).withHeader("X-CSRF-Token", equalTo("Fetch"))
                .willReturn(ok().withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
    }

    @AfterEach
    void tearDown() { if (server != null) server.stop(); }

    @Test
    @DisplayName("REQ-008 AC-1: exact matches preserve queried DataType and filter mappings")
    void req008_ac1_apply() {
        configurations("Endpoint", "dev", "xsd:anyURI");
        server.stubFor(put(urlEqualTo(path("Endpoint"))).willReturn(noContent()));
        var result = replacer.process("IF_Order", List.of(mapping("Endpoint", "dev", "prd"),
                new MappingEntry("Other", EXTERNAL_PARAM, "Endpoint", "dev", "wrong"),
                new MappingEntry("IF_Order", HEADER, "Endpoint", "dev", "wrong")), false);
        assertThat(result.replacements()).containsExactly(replacement("Endpoint", APPLIED, "dev", "prd", 1));
        assertThat(result.error()).isNull();
        assertThat(result.unmappedKeys()).isEmpty();
        server.verify(1, putRequestedFor(urlEqualTo(path("Endpoint")))
                .withRequestBody(equalToJson("{\"ParameterValue\":\"prd\",\"DataType\":\"xsd:anyURI\"}"))
                .withHeader("Authorization", equalTo("Bearer dummy-prd-token-0001")));
        server.verify(getRequestedFor(urlEqualTo(ART + "/Configurations"))
                .withHeader("Authorization", equalTo("Bearer dummy-prd-token-0001")));
        server.verify(0, postRequestedFor(urlEqualTo("/dev/token")));
    }

    @Test
    @DisplayName("REQ-008 AC-2: mismatched and missing keys never send PUT")
    void req008_ac2_skip() {
        configurations("Endpoint", "DEV ", "xsd:string");
        var result = replacer.process("IF_Order",
                List.of(mapping("Endpoint", "dev", "prd"), mapping("Missing", "dev", "prd")), false);
        assertThat(result.replacements()).containsExactly(
                replacement("Endpoint", VALUE_MISMATCH, "DEV ", "DEV ", 1),
                replacement("Missing", KEY_NOT_FOUND, null, null, 0));
        assertThat(result.error()).isNull();
        noWrites();
    }

    @Test
    @DisplayName("REQ-008 AC-3: unmapped keys include only names in results and logs")
    void req008_ac3_unmapped(CapturedOutput output) {
        configurations("Unmapped", "unmapped-current-value", "xsd:string");
        var result = replacer.process("IF_Order",
                List.of(new MappingEntry("Other", EXTERNAL_PARAM, "Unmapped", "dev", "prd")), false);
        assertThat(result.unmappedKeys()).containsExactly(new UnmappedKey(EXTERNAL_PARAM, "Unmapped"));
        assertThat(result.replacements()).isEmpty();
        assertThat(output.getAll()).contains("Unmapped externalParam key: Unmapped")
                .doesNotContain("unmapped-current-value");
        noWrites();
    }

    @Test
    @DisplayName("REQ-008 AC-4: exhausted PUT retries retain failure and continue other keys")
    void req008_ac4_continueAfterFailure(CapturedOutput output) {
        configurations("Broken", "dev", "xsd:string", "Good", "dev", "xsd:int");
        server.stubFor(put(urlEqualTo(path("Broken"))).willReturn(serverError().withBody("private-response-body")));
        server.stubFor(put(urlEqualTo(path("Good"))).willReturn(noContent()));
        var result = replacer.process("IF_Order",
                List.of(mapping("Broken", "dev", "prd"), mapping("Good", "dev", "42")), false);
        assertThat(result.replacements()).containsExactly(replacement("Broken", FAILED, "dev", "prd", 1),
                replacement("Good", APPLIED, "dev", "42", 1));
        assertThat(result.error().code()).isEqualTo("CONFIGURATION_UPDATE_FAILED");
        assertThat(result.error().message()).isEqualTo("Broken: HTTP 500");
        assertThat(output.getAll()).doesNotContain("private-response-body");
        server.verify(3, putRequestedFor(urlEqualTo(path("Broken"))));
        server.verify(1, putRequestedFor(urlEqualTo(path("Good")))
                .withRequestBody(equalToJson("{\"ParameterValue\":\"42\",\"DataType\":\"xsd:int\"}")));
        assertThat(waits).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2));
    }

    @Test
    @DisplayName("REQ-012 AC-2, AC-4: sensitive present missing and unmapped values remain masked")
    void req012_ac2_sensitive(CapturedOutput output) {
        configurations("PASSWORD", "dummy-dev-secret", "xsd:string", "UnmappedToken", "dummy-dev-token-0001", "xsd:string");
        var result = replacer.process("IF_Order", List.of(
                mapping("PASSWORD", "dummy-dev-secret", "dummy-prd-secret"),
                mapping("MissingSecret", "dummy-dev-secret", "dummy-prd-secret")), false);
        assertThat(result.replacements()).containsExactly(
                replacement("PASSWORD", SENSITIVE_SKIPPED, "***", "***", 1),
                replacement("MissingSecret", SENSITIVE_SKIPPED, "***", "***", 0));
        assertThat(result.unmappedKeys()).containsExactly(new UnmappedKey(EXTERNAL_PARAM, "UnmappedToken"));
        String serialized = JsonMapper.builder().build().writeValueAsString(result);
        assertThat(serialized + output.getAll()).doesNotContain("dummy-dev-secret", "dummy-prd-secret", "dummy-dev-token-0001");
        noWrites();
    }

    @Test
    @DisplayName("REQ-010 AC-3: dry run queries DEV only and plans without CSRF or writes")
    void req010_ac3_dryRun() {
        configurations("Endpoint", "dev", "xsd:string");
        var result = replacer.process("IF_Order", List.of(mapping("Endpoint", "dev", "prd")), true);
        assertThat(result.replacements()).containsExactly(replacement("Endpoint", PLANNED, "dev", "prd", 1));
        assertThat(result.error()).isNull();
        server.verify(getRequestedFor(urlEqualTo(ART + "/Configurations"))
                .withHeader("Authorization", equalTo("Bearer dummy-dev-token-0001")));
        server.verify(0, postRequestedFor(urlEqualTo("/prd/token")));
        assertThat(server.getAllServeEvents()).hasSize(2);
        noWrites();
    }

    private void configurations(String... triples) {
        var rows = new ArrayList<Map<String, String>>();
        for (int i = 0; i < triples.length; i += 3) {
            rows.add(Map.of("ParameterKey", triples[i], "ParameterValue", triples[i + 1], "DataType", triples[i + 2]));
        }
        server.stubFor(get(urlEqualTo(ART + "/Configurations")).willReturn(okJson(
                JsonMapper.builder().build().writeValueAsString(Map.of("d", Map.of("results", rows))))));
    }

    private void noWrites() {
        server.verify(0, putRequestedFor(anyUrl()));
        server.verify(0, deleteRequestedFor(anyUrl()));
        server.verify(0, getRequestedFor(urlEqualTo("/api/v1/")));
    }

    private static String path(String key) { return ART + "/$links/Configurations('" + key + "')"; }
    private static MappingEntry mapping(String key, String dev, String prd) {
        return new MappingEntry("IF_Order", EXTERNAL_PARAM, key, dev, prd);
    }
    private static Replacement replacement(String key, ReplacementStatus status, String before, String after, int count) {
        return new Replacement(EXTERNAL_PARAM, key, status, before, after, count);
    }
}