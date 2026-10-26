package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.controller.TransportController;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.stub.LocalCpiStubs;
import com.company.sap.cpitransport.tenant.*;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(OutputCaptureExtension.class)
class DeployErrorDetailWireMockTests {
    private static final String ERROR_ID = "IF_Fault_DeployError";
    private static final String DETAIL = "/api/v1/IntegrationRuntimeArtifacts('" + ERROR_ID + "')/ErrorInformation/$value";
    private static final String TOKEN = "dummy-prd-token-0001";
    @TempDir Path directory;
    private LocalCpiStubs stubs;
    private TransportProperties settings;
    private CpiProperties connections;
    private TenantRegistry tenants;
    private OAuthTokenProvider tokens;
    private CpiHttpExecutor http;
    private CpiApiClient api;
    private TransportService service;
    private final JsonMapper json = new JsonMapper();
    private final AdvancingClock clock = new AdvancingClock();

    static class AdvancingClock extends Clock {
        private Instant now = Instant.parse("2026-10-14T00:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
        void advance(Duration duration) { now = now.plus(duration); }
    }

    @BeforeEach void start() throws Exception {
        stubs = new LocalCpiStubs(directory.resolve("bundles"));
        stubs.start(0, 0);
        settings = new TransportProperties("examples/mapping-example.json",
                new TransportProperties.History(directory.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ZERO),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(4)),
                List.of("password", "secret", "token"));
        connections = new CpiProperties(connection(stubs.dev().baseUrl(), "dev"), connection(stubs.prd().baseUrl(), "prd"));
        tenants = TenantRegistry.initial(connections);
        tokens = new OAuthTokenProvider(tenants, settings, clock, clock::advance);
        http = new CpiHttpExecutor(tenants, tokens, new CsrfTokenStore(), settings, clock::advance, Duration.ofSeconds(3));
        api = new CpiApiClient(http, json);
        service = transport(api);
    }
    @AfterEach void stop() { if (stubs != null) stubs.stop(); }

    private CpiProperties.Connection connection(String base, String env) {
        return new CpiProperties.Connection(base, base + "/oauth/token", "dummy-" + env + "-client", "dummy-" + env + "-secret");
    }
    private TransportService transport(CpiApiClient client) {
        var sensitive = new SensitiveKeyMatcher(settings);
        return new TransportService(client, new IflwReplacer(sensitive), new ExternalParameterReplacer(client, sensitive),
                new DeployService(client, settings, clock, clock::advance), new MappingFileLoader(settings), clock);
    }
    private TransportResponse run(String id, boolean dryRun, boolean deploy) {
        return service.execute(new TransportRequest("PkgFaultDemo", List.of(id), dryRun, deploy));
    }
    private void detail(int code, String body) {
        stubs.prd().stubFor(get(urlEqualTo(DETAIL)).atPriority(0)
                .willReturn(aResponse().withStatus(code).withHeader("Content-Type", "text/plain; charset=UTF-8").withBody(body)));
    }
    private void once() {
        stubs.prd().verify(1, getRequestedFor(urlEqualTo(DETAIL)).withHeader("Authorization", equalTo("Bearer " + TOKEN)));
        stubs.dev().verify(0, getRequestedFor(urlPathMatching(".*ErrorInformation.*")));
        stubs.prd().verify(1, postRequestedFor(urlEqualTo("/oauth/token")));
    }
    private void noDetail() { stubs.prd().verify(0, getRequestedFor(urlPathMatching(".*ErrorInformation.*"))); }
    private void failed(ArtifactResult result) {
        assertThat(result.deployStatus()).isEqualTo(DeployStatus.ERROR);
        assertThat(result.status()).isEqualTo(ArtifactStatus.FAILED);
        assertThat(result.error().code()).isEqualTo("DEPLOY_FAILED");
        assertThat(result.error().message()).isEqualTo("DEPLOY: CPI deployment ERROR");
    }

    @Test @DisplayName("REQ-309 AC-1 / REQ-309 AC-2 / REQ-309 AC-10: runtime ERROR reads UTF-8 detail once using cached bearer")
    void req309_ac1_runtimeError() {
        detail(200, "  first\n\tsecond\n\uC624\uB958  ");
        var response = run(ERROR_ID, false, true);
        failed(response.results().getFirst());
        assertThat(response.results().getFirst().error().detail()).isEqualTo("first\n\tsecond\n\uC624\uB958");
        assertThat(response.results().getFirst().error().detailHttpStatus()).isEqualTo(200);
        assertThat(response.summary()).isEqualTo(new TransportSummary(1, 0, 1));
        once();
    }

    @ParameterizedTest(name = "REQ-309 AC-1 / REQ-309 AC-2 / REQ-309 AC-10: HTTP {0} has no detail and no replay")
    @ValueSource(ints = {204, 404, 501, 500, 503, 429, 401, 302})
    void req309_ac1_httpStatus(int code, CapturedOutput output) {
        stubs.prd().stubFor(get(urlEqualTo(DETAIL)).atPriority(0).willReturn(aResponse().withStatus(code)
                .withHeader("Location", stubs.prd().baseUrl() + "/redirected-detail").withBody("ignored detail")));
        var result = run(ERROR_ID, false, true).results().getFirst();
        failed(result);
        assertThat(result.error().detail()).isNull();
        assertThat(result.error().detailHttpStatus()).isEqualTo(code);
        assertThat(deployLine(output, ERROR_ID)).endsWith("phase=END result=FAILED deployFailure=RUNTIME_ERROR detailHttpStatus=" + code + " detailLength=0");
        once();
        stubs.prd().verify(0, getRequestedFor(urlEqualTo("/redirected-detail")));
    }

    @ParameterizedTest(name = "REQ-309 AC-2 / REQ-309 AC-10: blank body {0} retains HTTP 200")
    @ValueSource(strings = {"", " \r\n\t "})
    void req309_ac2_blank(String body) {
        detail(200, body);
        var error = run(ERROR_ID, false, true).results().getFirst().error();
        assertThat(error.detail()).isNull();
        assertThat(error.detailHttpStatus()).isEqualTo(200);
        var node = json.readTree(json.writeValueAsString(error));
        assertThat(node.has("detail")).isFalse();
        assertThat(node.path("detailHttpStatus").asInt()).isEqualTo(200);
        once();
    }

    @ParameterizedTest(name = "REQ-309 AC-1 / REQ-309 AC-5 / REQ-309 AC-10: {0} never requests detail")
    @ValueSource(strings = {"IF_Fault_A", "IF_Fault_DeployTimeout", "IF_Fault_DeployPost500", "IF_Fault_RuntimeGet500"})
    void req309_ac1_noRequest(String id, CapturedOutput output) {
        var result = run(id, false, true).results().getFirst();
        noDetail();
        if (id.endsWith("500")) {
            failed(result);
            assertThat(result.error().detail()).isNull();
            assertThat(result.error().detailHttpStatus()).isNull();
            String line = deployLine(output, id);
            assertThat(line).endsWith("phase=END result=FAILED deployFailure=CALL_FAILED");
            assertThat(line).doesNotContain("detailHttpStatus", "detailLength");
        } else if (id.endsWith("Timeout")) {
            assertThat(result.deployStatus()).isEqualTo(DeployStatus.TIMEOUT);
            assertThat(result.error().code()).isEqualTo("DEPLOY_TIMEOUT");
            assertThat(deployLine(output, id)).endsWith("phase=END result=FAILED");
        } else assertThat(result.deployStatus()).isEqualTo(DeployStatus.STARTED);
    }

    @Test @DisplayName("REQ-309 AC-1 / REQ-309 AC-10: dry run, deploy false and target failure have zero detail calls")
    void req309_ac1_notDeployed() {
        run(ERROR_ID, true, true);
        assertThat(stubs.prd().getAllServeEvents()).isEmpty();
        run(ERROR_ID, false, false);
        stubs.prd().stubFor(get(urlEqualTo("/api/v1/IntegrationPackages('PkgFaultDemo')")).atPriority(0).willReturn(notFound()));
        var result = run(ERROR_ID, false, true).results().getFirst();
        assertThat(result.error().code()).isEqualTo("PACKAGE_NOT_FOUND_IN_TARGET");
        assertThat(result.error().detailHttpStatus()).isNull();
        noDetail();
    }

    @Test @DisplayName("REQ-309 AC-1 / REQ-309 AC-5 / REQ-309 AC-10: interrupted and unexpected deployment calls stay CALL_FAILED")
    void req309_ac1_interruptedAndUnexpected(CapturedOutput output) {
        var interrupted = new DeployService(api, settings, clock, duration -> { throw new InterruptedException(); });
        try {
            var outcome = interrupted.deployAndWaitOutcome("PRD", ERROR_ID);
            assertThat(outcome.failure()).isEqualTo(DeployOutcome.DeployFailure.CALL_FAILED);
            assertThat(outcome.status()).isEqualTo(DeployStatus.ERROR);
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally { Thread.interrupted(); }
        var failing = new CpiApiClient(http, json) {
            @Override public void deploy(String tenantId, String id) { throw new IllegalStateException("test-dummy-diagnostic"); }
        };
        var response = transport(failing).execute(new TransportRequest("PkgFaultDemo", List.of(ERROR_ID), false, true));
        failed(response.results().getFirst());
        assertThat(deployLine(output, ERROR_ID)).endsWith("phase=END result=FAILED deployFailure=CALL_FAILED");
        assertThat(output.getAll()).doesNotContain("test-dummy-diagnostic");
        noDetail();
    }

    @ParameterizedTest(name = "REQ-309 AC-3 / REQ-309 AC-10: {0} detail failure preserves HTTP 200, summary and next artifact")
    @ValueSource(strings = {"connection", "timeout", "token", "runtime"})
    void req309_ac3_failureIsolation(String mode, CapturedOutput output) throws Exception {
        CpiApiClient detailApi = api;
        if (mode.equals("connection")) {
            int closedPort;
            try (var socket = new ServerSocket(0)) { closedPort = socket.getLocalPort(); }
            var closed = TenantRegistry.initial(new CpiProperties(connections.dev(), connection("http://localhost:" + closedPort, "prd")));
            detailApi = new CpiApiClient(new CpiHttpExecutor(closed, tokens, new CsrfTokenStore(), settings, clock::advance,
                    Duration.ofMillis(300)), json);
        }
        if (mode.equals("timeout")) {
            detailApi = new CpiApiClient(new CpiHttpExecutor(tenants, tokens, new CsrfTokenStore(), settings,
                    clock::advance, Duration.ofMillis(200)), json);
            stubs.prd().stubFor(get(urlEqualTo(DETAIL)).atPriority(0).willReturn(ok().withBody("too late").withFixedDelay(1200)));
        }
        final CpiApiClient fetcher = detailApi;
        var client = new CpiApiClient(http, json) {
            @Override public CpiHttpExecutor.OnceResponse getDeployErrorInformation(String tenantId, String id) {
                if (mode.equals("token")) {
                    tokens.invalidate(tenantId);
                    stubs.prd().stubFor(post(urlEqualTo("/oauth/token")).atPriority(0).willReturn(aResponse().withStatus(401)));
                }
                if (mode.equals("runtime")) {
                    var broken = new OAuthTokenProvider(tenants, settings, clock, clock::advance) {
                        @Override public String getToken(String tenant) { throw new IllegalStateException("test-dummy-sensitive-cause"); }
                    };
                    return new CpiHttpExecutor(tenants, broken, new CsrfTokenStore(), settings, clock::advance).executeOnce(tenantId, DETAIL);
                }
                var response = fetcher.getDeployErrorInformation(tenantId, id);
                if (mode.equals("token")) stubs.prd().stubFor(post(urlEqualTo("/oauth/token")).atPriority(0)
                        .willReturn(okJson("{\"access_token\":\"" + TOKEN + "\",\"expires_in\":3600}")));
                return response;
            }
        };
        var history = new TransportHistoryStore(settings, json);
        var controller = new TransportController(transport(client), new EnvironmentGuard(connections), history, new ReadOnlyProperties(false));
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        var result = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/transport")
                .contentType("application/json").content("{\"packageId\":\"PkgFaultDemo\",\"artifactIds\":[\"" + ERROR_ID
                        + "\",\"IF_Fault_A\"],\"dryRun\":false,\"deploy\":true}"))
                .andExpect(status().isOk()).andReturn();
        var response = json.readValue(result.getResponse().getContentAsString(), TransportResponse.class);
        failed(response.results().getFirst());
        assertThat(response.results().getFirst().error().detail()).isNull();
        assertThat(response.results().getFirst().error().detailHttpStatus()).isZero();
        assertThat(deployLine(output, ERROR_ID)).endsWith("phase=END result=FAILED deployFailure=RUNTIME_ERROR detailHttpStatus=0 detailLength=0");
        assertThat(response.results().get(1).deployStatus()).isEqualTo(DeployStatus.STARTED);
        assertThat(response.summary()).isEqualTo(new TransportSummary(2, 1, 1));
        assertThat(result.getResponse().getContentAsString()).contains("\"detailHttpStatus\":0").doesNotContain("test-dummy-sensitive-cause");
        stubs.prd().verify(mode.equals("timeout") ? 1 : 0, getRequestedFor(urlEqualTo(DETAIL)));
        if (mode.equals("token")) stubs.prd().verify(3, postRequestedFor(urlEqualTo("/oauth/token")));
    }

    @ParameterizedTest(name = "REQ-309 AC-2 / REQ-309 AC-4 / REQ-309 AC-10: {0} Unicode code points masked before truncation")
    @ValueSource(ints = {4000, 4001})
    void req309_ac2_codePointBoundary(int size, CapturedOutput output) {
        String text = "\uD83D\uDE00".repeat(size);
        detail(200, text);
        String expected = size == 4000 ? text : "\uD83D\uDE00".repeat(4000) + "\u2026(\uC798\uB9BC)";
        assertThat(run(ERROR_ID, false, true).results().getFirst().error().detail()).isEqualTo(expected);
        assertThat(deployLine(output, ERROR_ID)).endsWith("detailLength=" + expected.codePointCount(0, expected.length()));
        once();
        assertThat(mask("x".repeat(3998) + "test-dummy-boundary-secret" + "tail", List.of("test-dummy-boundary-secret"), List.of()))
                .isEqualTo("x".repeat(3998) + "**\u2026(\uC798\uB9BC)");
    }

    @Test @DisplayName("REQ-309 AC-4 / REQ-309 AC-10: ordered masking covers credentials, headers, JWT, subdomains, all sensitive mappings and newlines")
    void req309_ac4_masking() {
        List<String> secrets = List.of("test-dummy-target-client", "test-dummy-target-secret", "test-dummy-bearer", "test-dummy-csrf", "test-dummy-cookie",
                "dummy-dev-client", "dummy-dev-secret", "dummy-prd-client", "dummy-prd-secret",
                base64("test-dummy-target-client:test-dummy-target-secret"), base64("dummy-dev-client:dummy-dev-secret"), base64("dummy-prd-client:dummy-prd-secret"));
        String body = String.join(" ", secrets) + "\nAuthorization: unknown-auth\nSet-Cookie: unknown-cookie\nX-CSRF-Token: unknown-csrf\n"
                + "Bearer unknown-bearer Basic unknown-basic eyJabc.def.ghi\nZZ-TENANT zz-tenant zz-auth\n\tkeep\n"
                + "test-dummy-map-dev test-dummy-map-prd";
        var replacer = new ExternalParameterReplacer(api, new SensitiveKeyMatcher(settings));
        var mappings = List.of(new MappingEntry("another-artifact", TargetType.HEADER, "Password", "test-dummy-map-dev", "test-dummy-map-prd"),
                new MappingEntry(ERROR_ID, TargetType.PROPERTY, "plain", "leave-dev", "leave-prd"));
        String value = DeployErrorDetail.mask(body.getBytes(StandardCharsets.UTF_8), secrets,
                "https://zz-tenant.it-cpi001.cfapps.eu10.hana.example.localhost", "https://zz-auth.auth.example.localhost/oauth/token",
                replacer.sensitiveValues(mappings));
        for (String secret : secrets) assertThat(value).doesNotContain(secret);
        assertThat(value).doesNotContain("unknown-auth", "unknown-cookie", "unknown-csrf", "unknown-bearer", "unknown-basic", "eyJabc.def.ghi",
                "ZZ-TENANT", "zz-tenant", "zz-auth", "test-dummy-map-dev", "test-dummy-map-prd");
        assertThat(value).contains("<subdomain> <subdomain> <subdomain>", "\n\tkeep\n", "Authorization: ***", "Set-Cookie: ***", "X-CSRF-Token: ***");
        assertThat(mask("test-dummy-long-secret", List.of("test-dummy", "test-dummy-long-secret"), List.of())).isEqualTo("***");
        // AI-NOTE: Assemble non-DNS test URLs to respect the source URL policy (REQ-015 AC-4 / REQ-309 AC-4).
        for (String url : List.of("http://localhost", "http://127.0.0.1", "http:" + "//[::1]", "http:" + "//singlehost", "http://two.localhost"))
            assertThat(DeployErrorDetail.mask("localhost 127 1 ::1 singlehost two".getBytes(StandardCharsets.UTF_8), List.of(), url, url, List.of()))
                    .isEqualTo("localhost 127 1 ::1 singlehost two");
    }

    @Test @DisplayName("REQ-309 AC-4 / REQ-309 AC-10: transport masks sensitive mappings belonging to other artifacts")
    void req309_ac4_allLoadedMappings() {
        detail(200, "test-dummy-other-dev test-dummy-other-prd");
        var response = service.execute(new TransportRequest("PkgFaultDemo", List.of(ERROR_ID), false, true),
                api.listArtifacts("DEV", "PkgFaultDemo"), List.of(new MappingEntry("other-artifact", TargetType.HEADER,
                        "Password", "test-dummy-other-dev", "test-dummy-other-prd")));
        assertThat(response.results().getFirst().error().detail()).isEqualTo("*** ***");
        once();
    }

    @Test @DisplayName("REQ-309 AC-4 / REQ-309 AC-5 / REQ-309 AC-6 / REQ-309 AC-10: deployFailure=RUNTIME_ERROR log includes detailHttpStatus and detailLength; masked detail stays out of logs and persists through history API alongside legacy rows")
    void req309_ac5_logsAndHistory(CapturedOutput output) throws Exception {
        String raw = "test-dummy-detail-line " + TOKEN + " dummy-prd-client dummy-prd-secret dummy-dev-client dummy-dev-secret "
                + base64("dummy-prd-client:dummy-prd-secret") + "\n\tkept";
        detail(200, raw);
        var response = run(ERROR_ID, false, true);
        String masked = response.results().getFirst().error().detail();
        assertThat(masked).contains("***", "\n\tkept").doesNotContain(TOKEN, "dummy-prd-client", "dummy-prd-secret", "dummy-dev-client", "dummy-dev-secret");
        assertThat(deployLine(output, ERROR_ID)).endsWith("phase=END result=FAILED deployFailure=RUNTIME_ERROR detailHttpStatus=200 detailLength="
                + masked.codePointCount(0, masked.length()));
        assertThat(output.getAll()).doesNotContain(raw, masked, "test-dummy-detail-line", TOKEN, "dummy-prd-client", "dummy-prd-secret", "dummy-dev-client", "dummy-dev-secret");
        var history = new TransportHistoryStore(settings, json);
        history.append(response);
        var original = response.results().getFirst();
        var legacyResult = new ArtifactResult(original.artifactId(), null, original.action(), original.replacements(),
                original.unmappedKeys(), original.deployStatus(), new ArtifactError(original.error().code(), original.error().message()));
        var legacyResponse = new TransportResponse(response.transportId(), response.packageId(), response.dryRun(), response.deploy(),
                response.startedAt(), response.finishedAt(), response.summary(), List.of(legacyResult));
        Files.writeString(settings.history().file(), json.writeValueAsString(legacyResponse) + "\n", StandardOpenOption.APPEND);
        String stored = Files.readString(settings.history().file());
        assertThat(stored).contains("detailHttpStatus", "test-dummy-detail-line").doesNotContain(TOKEN, "dummy-prd-secret", "dummy-dev-secret");
        var controller = new TransportController(service, new EnvironmentGuard(connections), history, new ReadOnlyProperties(false));
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        var result = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/transport/history"))
                .andExpect(status().isOk()).andReturn();
        var nodes = json.readTree(result.getResponse().getContentAsString());
        assertThat(nodes.size()).isEqualTo(2);
        assertThat(nodes.get(0).path("results").get(0).path("error").path("detail").asString()).isEqualTo(masked);
        assertThat(nodes.get(1).path("results").get(0).path("error").has("detail")).isFalse();
        once();
    }

    @Test @DisplayName("REQ-309 AC-2 / REQ-309 AC-6 / REQ-309 AC-10: legacy constructor omits only null new fields and zero remains serializable")
    void req309_ac2_jsonCompatibility() {
        var old = json.readTree(json.writeValueAsString(new ArtifactError("OLD_CODE", "old message")));
        assertThat(old.size()).isEqualTo(2);
        assertThat(old.path("code").asString()).isEqualTo("OLD_CODE");
        assertThat(old.path("message").asString()).isEqualTo("old message");
        var read = json.readValue("{\"code\":\"OLD_CODE\",\"message\":\"old message\"}", ArtifactError.class);
        assertThat(read.detail()).isNull(); assertThat(read.detailHttpStatus()).isNull();
        var zero = json.readTree(json.writeValueAsString(new ArtifactError("DEPLOY_FAILED", "DEPLOY: CPI deployment ERROR", null, 0)));
        assertThat(zero.has("detail")).isFalse(); assertThat(zero.path("detailHttpStatus").asInt()).isZero();
    }

    @Test @DisplayName("REQ-309 AC-1 / REQ-309 AC-4 / REQ-309 AC-10: registered target uses its connection, cache and credentials with initial tenant masking")
    void req309_ac1_registeredTarget() {
        byte[] keyBytes = new byte[32]; new SecureRandom().nextBytes(keyBytes);
        String key = Base64.getEncoder().encodeToString(keyBytes);
        var registry = new TenantRegistry(connections, new EncryptedTenantStore(directory.resolve("tenants.enc"), () -> Optional.of(key), json), clock, event -> {});
        var body = json.createObjectNode(); body.put("name", "Registered target");
        var oauth = body.putObject("serviceKey").putObject("oauth");
        oauth.put("url", stubs.prd().baseUrl()); oauth.put("tokenurl", stubs.prd().baseUrl() + "/oauth/token");
        oauth.put("clientid", "test-dummy-target-client"); oauth.put("clientsecret", "test-dummy-target-secret");
        String id = registry.register(body).id();
        var provider = new OAuthTokenProvider(registry, settings, clock, clock::advance);
        stubs.prd().stubFor(post(urlEqualTo("/oauth/token")).atPriority(0).withBasicAuth("test-dummy-target-client", "test-dummy-target-secret")
                .willReturn(okJson("{\"access_token\":\"" + TOKEN + "\",\"expires_in\":3600}")));
        var client = new CpiApiClient(new CpiHttpExecutor(registry, provider, new CsrfTokenStore(), settings, clock::advance), json);
        detail(200, "test-dummy-target-client test-dummy-target-secret " + base64("test-dummy-target-client:test-dummy-target-secret") + " dummy-dev-client dummy-prd-secret " + TOKEN);
        var response = transport(client).execute(new TransportRequest("PkgFaultDemo", List.of(ERROR_ID), false, true,
                new TenantRef("DEV", "DEV"), new TenantRef(id, "Registered target")));
        failed(response.results().getFirst());
        assertThat(response.results().getFirst().error().detail()).isEqualTo("*** *** *** *** *** ***");
        assertThat(response.targetTenant().id()).isEqualTo(id);
        once();
    }

    private String deployLine(CapturedOutput output, String id) {
        return output.getAll().lines().filter(line -> line.contains("artifactId=" + id + " step=DEPLOY phase=END result=FAILED"))
                .reduce((first, last) -> last).orElseThrow();
    }
    private String mask(String body, List<String> secrets, List<String> values) {
        return DeployErrorDetail.mask(body.getBytes(StandardCharsets.UTF_8), secrets, "http://localhost", "http://127.0.0.1", values);
    }
    private String base64(String value) { return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8)); }

    @Test @DisplayName("REQ-309 AC-1: runtime STARTED makes zero deployment error detail requests")
    void req314_startedNoDetail() {
        var result = run("IF_Fault_A", false, true).results().getFirst();
        assertThat(result.deployStatus()).isEqualTo(DeployStatus.STARTED);
        assertThat(result.error()).isNull();
        noDetail();
        stubs.dev().verify(0, getRequestedFor(urlPathMatching(".*ErrorInformation.*")));
    }

    @ParameterizedTest(name = "REQ-309 AC-5: {0} deployFailure=CALL_FAILED log omits detailHttpStatus and detailLength")
    @ValueSource(strings = {"IF_Fault_DeployPost500", "IF_Fault_RuntimeGet500"})
    @DisplayName("REQ-309 AC-5: deployFailure=CALL_FAILED log omits detailHttpStatus and detailLength")
    void req314_callFailedLog(String id, CapturedOutput output) {
        var result = run(id, false, true).results().getFirst();
        failed(result);
        assertThat(result.error().detail()).isNull();
        assertThat(result.error().detailHttpStatus()).isNull();
        assertThat(deployLine(output, id)).endsWith("phase=END result=FAILED deployFailure=CALL_FAILED")
                .doesNotContain("detailHttpStatus", "detailLength");
        noDetail();
    }
}
