package com.company.sap.cpitransport.service;

import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;
import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.controller.*;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.stub.LocalCpiStubs;
import com.company.sap.cpitransport.tenant.*;
import com.github.tomakehurst.wiremock.client.BasicCredentials;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class TenantTransportWireMockTests {
    @TempDir Path directory;
    private final JsonMapper json = new JsonMapper();
    private LocalCpiStubs stubs;
    private AnnotationConfigApplicationContext context;
    private TenantRegistry tenants;
    private TransportService service;
    private CpiHttpExecutor http;
    private String sourceId, targetId;
    private final AdvancingClock clock = new AdvancingClock();

    static class AdvancingClock extends Clock {
        Instant now = Instant.parse("2026-10-07T00:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
        void advance(Duration duration) { now = now.plus(duration); }
    }

    @BeforeEach void setUp() throws Exception {
        stubs = new LocalCpiStubs(directory.resolve("bundles")); stubs.start(0, 0);
        context = new AnnotationConfigApplicationContext();
        var settings = new TransportProperties("examples/mapping-example.json", new TransportProperties.History(directory.resolve("history.jsonl")),
                new TransportProperties.Retry(1, Duration.ZERO), new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(5)),
                List.of("password", "secret", "apikey"));
        var empty = new CpiProperties.Connection("", "", "", "");
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        String key = Base64.getEncoder().encodeToString(bytes);
        tenants = new TenantRegistry(new CpiProperties(empty, empty), new EncryptedTenantStore(directory.resolve("tenants.enc"), () -> Optional.of(key), json), clock, context);
        sourceId = tenants.register(body("Registered source", "dev", stubs.dev().baseUrl())).id();
        targetId = tenants.register(body("Registered target", "prd", stubs.prd().baseUrl())).id();
        var tokens = new OAuthTokenProvider(tenants, settings, clock, clock::advance);
        var csrf = new CsrfTokenStore();
        context.registerBean("tokens", OAuthTokenProvider.class, () -> tokens);
        context.registerBean("csrf", CsrfTokenStore.class, () -> csrf);
        context.refresh();
        http = new CpiHttpExecutor(tenants, tokens, csrf, settings, clock::advance);
        var api = new CpiApiClient(http, json);
        var sensitive = new SensitiveKeyMatcher(settings);
        service = new TransportService(api, new IflwReplacer(sensitive), new ExternalParameterReplacer(api, sensitive),
                new DeployService(api, settings, clock, clock::advance), new MappingFileLoader(settings), clock);
    }
    @AfterEach void stop() { if (context != null) context.close(); if (stubs != null) stubs.stop(); }

    private JsonNode body(String name, String env, String base) {
        var body = json.createObjectNode(); body.put("name", name);
        var oauth = body.putObject("serviceKey").putObject("oauth");
        oauth.put("url", base); oauth.put("tokenurl", base + "/oauth/token");
        oauth.put("clientid", "dummy-" + env + "-client"); oauth.put("clientsecret", "dummy-" + env + "-secret");
        return body;
    }
    private TransportResponse transport(boolean dryRun) {
        return service.preflightAndExecute(new TransportRequest("PkgTransportDemo", List.of("IF_Order_Sync", "IF_Customer_Push"), dryRun, true,
                new TenantRef(sourceId, "Registered source"), new TenantRef(targetId, "Registered target")));
    }
    private void success(TransportResponse response) {
        assertThat(response.summary().failed()).isZero();
        assertThat(response.results()).hasSize(2).allSatisfy(r -> assertThat(r.deployStatus()).isEqualTo(DeployStatus.STARTED));
        assertThat(response.results()).extracting(ArtifactResult::action).contains(TransportAction.CREATED, TransportAction.UPDATED);
        assertThat(response.results().stream().flatMap(r -> r.replacements().stream())).anyMatch(r -> r.targetType() == TargetType.EXTERNAL_PARAM && r.status() == ReplacementStatus.APPLIED);
    }

    @Test @DisplayName("REQ-308 AC-3·AC-7: registered-only tenants route downloads, upload, parameters, deployment and runtime with separate caches")
    void req308_ac3_registeredTransport() {
        assertThat(tenants.find("DEV")).isEmpty(); assertThat(tenants.find("PRD")).isEmpty();
        var response = transport(false);
        success(response);
        stubs.dev().verify(1, postRequestedFor(urlEqualTo("/oauth/token")));
        stubs.prd().verify(1, postRequestedFor(urlEqualTo("/oauth/token")));
        stubs.prd().verify(1, getRequestedFor(urlEqualTo("/api/v1/")).withHeader("X-CSRF-Token", equalTo("Fetch")));
        stubs.dev().verify(1, getRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Customer_Push',Version='active')/$value")));
        stubs.prd().verify(1, postRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts")));
        stubs.prd().verify(1, putRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Order_Sync',Version='active')")));
        stubs.prd().verify(getRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Customer_Push',Version='active')/Configurations")));
        stubs.prd().verify(1, putRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Customer_Push',Version='active')/$links/Configurations('ReceiverUrl')"))
                .withRequestBody(equalToJson("{\"ParameterValue\":\"http://prd-receiver.localhost/customers\",\"DataType\":\"xsd:string\"}")));
        stubs.prd().verify(0, putRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Customer_Push',Version='active')/$links/Configurations('Timeout')")));
        assertThat(response.results().stream().flatMap(r -> r.replacements().stream()))
                .filteredOn(r -> r.targetType() == TargetType.EXTERNAL_PARAM && r.key().equals("Timeout"))
                .singleElement().satisfies(r -> {
                    assertThat(r.status()).isEqualTo(ReplacementStatus.VALUE_MISMATCH);
                    assertThat(r.before()).isEqualTo("30000");
                    assertThat(r.after()).isEqualTo("30000");
                });
        stubs.prd().verify(2, postRequestedFor(urlPathEqualTo("/api/v1/DeployIntegrationDesigntimeArtifact")));
        stubs.prd().verify(getRequestedFor(urlPathEqualTo("/api/v1/IntegrationRuntimeArtifacts('IF_Customer_Push')")));
        assertThat(stubs.dev().getAllServeEvents()).noneMatch(e -> e.getRequest().getMethod().getName().equals("PUT"));
        assertThat(stubs.prd().getAllServeEvents()).noneMatch(e -> e.getRequest().getUrl().endsWith("/$value"));
        // Populate a source CSRF session too, proving the target cache does not satisfy it.
        stubs.dev().stubFor(post(urlEqualTo("/api/v1/cache-probe")).willReturn(ok()));
        http.execute(sourceId, HttpMethod.POST, "/api/v1/cache-probe", null, true);
        stubs.dev().verify(1, getRequestedFor(urlEqualTo("/api/v1/")).withHeader("X-CSRF-Token", equalTo("Fetch")));
        stubs.dev().verify(1, postRequestedFor(urlEqualTo("/oauth/token")));
    }

    @Test @DisplayName("REQ-308 AC-1, AC-3, AC-7: registered dry run reads source configurations and never contacts target")
    void req308_ac1_registeredDryRun() {
        var response = transport(true);
        assertThat(response.summary().failed()).isZero();
        assertThat(response.results()).hasSize(2).allSatisfy(r -> {
            assertThat(r.action()).isEqualTo(TransportAction.NONE);
            assertThat(r.deployStatus()).isEqualTo(DeployStatus.SKIPPED_DRY_RUN);
        });
        assertThat(response.results().stream().flatMap(r -> r.replacements().stream()))
                .anyMatch(r -> r.targetType() == TargetType.EXTERNAL_PARAM && r.status() == ReplacementStatus.PLANNED);
        stubs.dev().verify(getRequestedFor(urlPathEqualTo("/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Customer_Push',Version='active')/Configurations")));
        assertThat(stubs.prd().getAllServeEvents()).isEmpty();
    }

    @Test @DisplayName("REQ-301 AC-4 / REQ-308 AC-3·AC-7: service-key PUT invalidates only that tenant OAuth and CSRF sessions")
    void req301_ac4_keyUpdate() throws Exception {
        success(transport(false));
        stubs.dev().stubFor(post(urlEqualTo("/api/v1/cache-probe")).willReturn(ok()));
        http.execute(sourceId, HttpMethod.POST, "/api/v1/cache-probe", null, true);
        stubs.dev().resetRequests(); stubs.prd().resetRequests(); stubs.prd().resetScenarios();
        stubs.prd().stubFor(post(urlEqualTo("/oauth/token")).atPriority(3).withBasicAuth("test-dummy-new-client", "test-dummy-new-secret")
                .willReturn(okJson("{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        var update = (tools.jackson.databind.node.ObjectNode) body("Registered target", "prd", stubs.prd().baseUrl());
        var oauth = (tools.jackson.databind.node.ObjectNode) update.path("serviceKey").path("oauth");
        oauth.put("clientid", "test-dummy-new-client"); oauth.put("clientsecret", "test-dummy-new-secret");
        var mvc = MockMvcBuilders.standaloneSetup(new TenantController(tenants, json)).setControllerAdvice(new ApiExceptionHandler()).build();
        mvc.perform(put("/tenants/" + targetId).contentType("application/json").content(json.writeValueAsString(update))).andExpect(status().isOk());
        success(transport(false));
        http.execute(sourceId, HttpMethod.POST, "/api/v1/cache-probe", null, true);
        stubs.prd().verify(1, postRequestedFor(urlEqualTo("/oauth/token")).withBasicAuth(new BasicCredentials("test-dummy-new-client", "test-dummy-new-secret")));
        stubs.prd().verify(1, getRequestedFor(urlEqualTo("/api/v1/")).withHeader("X-CSRF-Token", equalTo("Fetch")));
        stubs.dev().verify(0, postRequestedFor(urlEqualTo("/oauth/token")));
        stubs.dev().verify(0, getRequestedFor(urlEqualTo("/api/v1/")).withHeader("X-CSRF-Token", equalTo("Fetch")));
        tenants.delete(targetId);
        assertThatThrownByMissingTenant();
    }
    private void assertThatThrownByMissingTenant() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> http.execute(targetId, HttpMethod.GET, "/api/v1/", null, true))
                .isInstanceOf(ErrorResponse.ApiException.class);
    }
}
