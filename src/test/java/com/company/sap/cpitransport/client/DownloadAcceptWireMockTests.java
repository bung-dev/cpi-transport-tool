package com.company.sap.cpitransport.client;

import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.TenantRef;
import com.company.sap.cpitransport.model.TransportRequest;
import com.company.sap.cpitransport.model.TransportResponse;
import com.company.sap.cpitransport.service.DeployService;
import com.company.sap.cpitransport.service.ExternalParameterReplacer;
import com.company.sap.cpitransport.service.IflwReplacer;
import com.company.sap.cpitransport.service.MappingFileLoader;
import com.company.sap.cpitransport.service.SensitiveKeyMatcher;
import com.company.sap.cpitransport.service.TransportService;
import com.company.sap.cpitransport.stub.LocalCpiStubs;
import com.company.sap.cpitransport.tenant.EncryptedTenantStore;
import com.company.sap.cpitransport.tenant.TenantRegistry;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.stubbing.ServeEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.assertThat;

// REQ-311: 번들 다운로드(`…/$value`) 요청은 명시적 Accept 값을, 나머지 CPI GET은 application/json을 보낸다.
class DownloadAcceptWireMockTests {
    // AI-NOTE: 이 값은 명세 REQ-311 AC-1이 정한 문자열이다. MediaType 목록 렌더링 결과와 달라질 수 있어 문자열로 고정한다.
    private static final String ZIP_ACCEPT = "application/zip, application/octet-stream, */*";
    private static final String ART = "/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Order',Version='active')";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @TempDir Path temporary;
    private WireMockServer server;
    private CpiHttpExecutor executor;
    private CpiApiClient api;

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
                Clock.fixed(Instant.parse("2026-10-22T00:00:00Z"), ZoneOffset.UTC), sleeper);
        executor = new CpiHttpExecutor(properties, tokens, new CsrfTokenStore(), transport, sleeper);
        api = new CpiApiClient(executor, JSON);
        for (String env : List.of("dev", "prd")) {
            server.stubFor(post(urlEqualTo("/" + env + "/token")).willReturn(okJson(
                    "{\"access_token\":\"dummy-" + env + "-token-0001\",\"expires_in\":3600}")));
        }
        server.stubFor(get(urlEqualTo("/api/v1/")).withHeader("X-CSRF-Token", equalTo("Fetch"))
                .willReturn(ok().withHeader("X-CSRF-Token", "dummy-dev-csrf-0001")
                        .withHeader("Set-Cookie", "JSESSIONID=dummy-dev-session-0001; Path=/")));
    }

    @AfterEach
    void tearDown() { if (server != null) server.stop(); }

    private void stubJson(String path, String json) {
        server.stubFor(get(urlEqualTo(path)).willReturn(okJson(json)));
    }

    private List<ServeEvent> gets(WireMockServer wire) {
        return wire.getAllServeEvents().stream()
                .filter(e -> e.getRequest().getMethod().getName().equals("GET")).toList();
    }

    @Test
    @DisplayName("REQ-311 AC-1·AC-4: bundle download GET sends the exact zip Accept regardless of the acceptJson flag")
    void req311_ac1_ac4_downloadAccept() {
        byte[] zip = {80, 75, 3, 4, 0, -1, -128, 42};
        server.stubFor(get(urlEqualTo(ART + "/$value")).willReturn(ok().withBody(zip)));
        server.stubFor(get(urlEqualTo(ART + "/$value?download=1")).willReturn(ok().withBody(zip)));

        assertThat(api.downloadArtifact(CpiEnvironment.DEV, "IF_Order")).isEqualTo(zip);
        assertThat(executor.execute(CpiEnvironment.DEV, HttpMethod.GET, ART + "/$value", null, true).getBody()).isEqualTo(zip);
        assertThat(executor.execute(CpiEnvironment.DEV, HttpMethod.GET, ART + "/$value", null, false).getBody()).isEqualTo(zip);
        assertThat(executor.execute(CpiEnvironment.DEV, HttpMethod.GET, ART + "/$value?download=1", null, true).getBody()).isEqualTo(zip);

        server.verify(3, getRequestedFor(urlEqualTo(ART + "/$value"))
                .withHeader("Authorization", equalTo("Bearer dummy-dev-token-0001"))
                .withHeader("Accept", equalTo(ZIP_ACCEPT)));
        server.verify(1, getRequestedFor(urlEqualTo(ART + "/$value?download=1"))
                .withHeader("Accept", equalTo(ZIP_ACCEPT)));
        // 같은 값이 두 번 나가지 않고(헤더 1개) JSON Accept가 섞이지 않는다.
        for (ServeEvent event : gets(server)) {
            if (!event.getRequest().getUrl().contains("/$value")) continue;
            assertThat(event.getRequest().getHeaders().getHeader("Accept").values()).containsExactly(ZIP_ACCEPT);
        }
    }

    @Test
    @DisplayName("REQ-311 AC-2·AC-4: JSON reads, next-page and CSRF fetch keep Accept application/json")
    void req311_ac2_ac4_jsonReads() {
        String pkg = "{\"Id\":\"Pkg\",\"Name\":\"Orders\",\"Version\":\"1.0\"}";
        String artifacts = "/api/v1/IntegrationPackages('Pkg')/IntegrationDesigntimeArtifacts";
        stubJson("/api/v1/IntegrationPackages", "{\"d\":{\"results\":[" + pkg + "]}}");
        stubJson("/api/v1/IntegrationPackages('Pkg')", "{\"d\":" + pkg + "}");
        stubJson(artifacts, "{\"d\":{\"results\":[{\"Id\":\"IF_Order\",\"Name\":\"Order\",\"Version\":\"2\"}]}}");
        stubJson(ART, "{\"d\":{\"Id\":\"IF_Order\"}}");
        stubJson(ART + "/Configurations",
                "{\"d\":{\"results\":[{\"ParameterKey\":\"K\",\"ParameterValue\":\"V\",\"DataType\":\"xsd:string\"}]}}");
        stubJson("/api/v1/IntegrationRuntimeArtifacts('IF_Order')", "{\"d\":{\"Id\":\"IF_Order\",\"Status\":\"STARTED\"}}");
        // 첫 페이지가 __next(origin 기준 절대 경로)를 돌려주는 목록
        stubJson("/api/v1/IntegrationPackages?$top=1",
                "{\"d\":{\"results\":[" + pkg + "],\"__next\":\"/api/v1/IntegrationPackages?$skiptoken=1\"}}");
        stubJson("/api/v1/IntegrationPackages?$skiptoken=1", "{\"d\":{\"results\":[" + pkg + "]}}");
        server.stubFor(post(urlEqualTo("/api/v1/IntegrationDesigntimeArtifacts")).willReturn(created()));

        assertThat(api.listPackages(CpiEnvironment.DEV)).hasSize(1);
        assertThat(api.getPackage(CpiEnvironment.DEV, "Pkg")).isPresent();
        assertThat(api.listArtifacts(CpiEnvironment.DEV, "Pkg")).hasSize(1);
        assertThat(api.artifactExists(CpiEnvironment.DEV, "IF_Order")).isTrue();
        assertThat(api.getConfigurations(CpiEnvironment.DEV, "IF_Order")).hasSize(1);
        assertThat(api.getRuntimeStatus(CpiEnvironment.DEV, "IF_Order")).contains("STARTED");
        executor.executePage("DEV", "/api/v1/IntegrationPackages?$top=1");
        executor.executePage("DEV", "/api/v1/IntegrationPackages?$skiptoken=1");
        // 쓰기 요청이 CSRF 확인 GET(`/api/v1/`)을 일으킨다.
        api.createArtifact(CpiEnvironment.DEV, "Order", "IF_Order", "Pkg", "AAAA");

        var reads = gets(server).stream().filter(e -> e.getRequest().getUrl().startsWith("/api/v1")).toList();
        assertThat(reads).hasSize(9);
        assertThat(reads).anySatisfy(e -> assertThat(e.getRequest().getUrl()).isEqualTo("/api/v1/"));
        assertThat(reads).anySatisfy(e -> assertThat(e.getRequest().getUrl()).contains("$skiptoken"));
        assertThat(reads).allSatisfy(e -> assertThat(e.getRequest().getHeaders().getHeader("Accept").values())
                .containsExactly("application/json"));
    }

    @Test
    @DisplayName("REQ-311 AC-2·AC-4: ErrorInformation read (executeOnce) keeps the header it had before this change")
    void req311_ac2_ac4_errorInformationUnchanged() {
        server.stubFor(get(urlEqualTo("/api/v1/IntegrationRuntimeArtifacts('IF_Order')/ErrorInformation/$value"))
                .willReturn(okJson("{\"parameter\":[],\"message\":{\"messageText\":\"x\"}}")));
        var once = api.getDeployErrorInformation("DEV", "IF_Order");
        assertThat(once.status()).isEqualTo(200);
        var event = gets(server).stream()
                .filter(e -> e.getRequest().getUrl().endsWith("/ErrorInformation/$value")).findFirst().orElseThrow();
        // 변경 전 관찰값: JDK HttpClient + RestClient.exchange는 Accept를 붙이지 않는다(코드 수정 전에 한 번 실행해 확인).
        assertThat(event.getRequest().containsHeader("Accept")).isFalse();
    }

    private static final class FixedClock extends Clock {
        private Instant now = Instant.parse("2026-10-22T00:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
        void advance(Duration duration) { now = now.plus(duration); }
    }

    @Test
    @DisplayName("REQ-311 AC-1·AC-2·AC-4: preview and real transport send Accept on every CPI GET, zip only for $value")
    void req311_ac1_ac2_ac4_fullTransportFlows() throws Exception {
        try (var stubs = new StubsHandle(temporary.resolve("bundles"))) {
            var flow = new Flow(stubs.stubs, temporary);
            try {
                flow.transport(true);
                flow.transport(false);
                assertAcceptOnAllGets(stubs.stubs.dev(), true);
                assertAcceptOnAllGets(stubs.stubs.prd(), false);
            } finally {
                flow.close();
            }
        }
    }

    // 원본(DEV)에는 미리보기·실제 이관 모두 $value 읽기가 있고, 대상(PRD)에는 읽기 GET만 있다.
    private void assertAcceptOnAllGets(WireMockServer wire, boolean expectDownloads) {
        var reads = gets(wire).stream().filter(e -> !e.getRequest().getUrl().contains("/ErrorInformation/")).toList();
        assertThat(reads).isNotEmpty();
        boolean[] seenDownload = {false};
        for (ServeEvent event : reads) {
            var accept = event.getRequest().getHeaders().getHeader("Accept");
            assertThat(accept.isPresent()).as("Accept present: %s", event.getRequest().getUrl()).isTrue();
            String path = event.getRequest().getUrl().split("\\?", 2)[0];
            if (path.endsWith("/$value")) {
                seenDownload[0] = true;
                assertThat(accept.values()).as(path).containsExactly(ZIP_ACCEPT);
            } else {
                assertThat(accept.values()).as(path).containsExactly("application/json");
            }
        }
        assertThat(seenDownload[0]).isEqualTo(expectDownloads);
    }

    private static final class StubsHandle implements AutoCloseable {
        final LocalCpiStubs stubs;
        StubsHandle(Path bundles) throws Exception { stubs = new LocalCpiStubs(bundles); stubs.start(0, 0); }
        @Override public void close() { stubs.stop(); }
    }

    // 등록 테넌트 2개로 TransportService를 실제 코드 경로(실행기·API 클라이언트·서비스)로 실행한다.
    private static final class Flow {
        final AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        final TransportService service;
        final String sourceId, targetId;

        Flow(LocalCpiStubs stubs, Path directory) throws Exception {
            var json = new JsonMapper();
            var clock = new FixedClock();
            var settings = new TransportProperties("examples/mapping-example.json",
                    new TransportProperties.History(directory.resolve("flow-history.jsonl")),
                    new TransportProperties.Retry(1, Duration.ZERO),
                    new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(5)),
                    List.of("password", "secret", "apikey"));
            var empty = new CpiProperties.Connection("", "", "", "");
            byte[] bytes = new byte[32];
            new SecureRandom().nextBytes(bytes);
            String key = Base64.getEncoder().encodeToString(bytes);
            var tenants = new TenantRegistry(new CpiProperties(empty, empty),
                    new EncryptedTenantStore(directory.resolve("flow-tenants.enc"), () -> Optional.of(key), json), clock, context);
            sourceId = tenants.register(body(json, "Preview source", "dev", stubs.dev().baseUrl())).id();
            targetId = tenants.register(body(json, "Preview target", "prd", stubs.prd().baseUrl())).id();
            var tokens = new OAuthTokenProvider(tenants, settings, clock, clock::advance);
            var csrf = new CsrfTokenStore();
            context.registerBean("tokens", OAuthTokenProvider.class, () -> tokens);
            context.registerBean("csrf", CsrfTokenStore.class, () -> csrf);
            context.refresh();
            var http = new CpiHttpExecutor(tenants, tokens, csrf, settings, clock::advance);
            var client = new CpiApiClient(http, json);
            var sensitive = new SensitiveKeyMatcher(settings);
            service = new TransportService(client, new IflwReplacer(sensitive), new ExternalParameterReplacer(client, sensitive),
                    new DeployService(client, settings, clock, clock::advance), new MappingFileLoader(settings), clock);
        }

        private static JsonNode body(JsonMapper json, String name, String env, String base) {
            var body = json.createObjectNode();
            body.put("name", name);
            var oauth = body.putObject("serviceKey").putObject("oauth");
            oauth.put("url", base);
            oauth.put("tokenurl", base + "/oauth/token");
            oauth.put("clientid", "dummy-" + env + "-client");
            oauth.put("clientsecret", "dummy-" + env + "-secret");
            return body;
        }

        TransportResponse transport(boolean dryRun) {
            var response = service.preflightAndExecute(new TransportRequest("PkgTransportDemo",
                    List.of("IF_Order_Sync", "IF_Customer_Push"), dryRun, true,
                    new TenantRef(sourceId, "Preview source"), new TenantRef(targetId, "Preview target")));
            assertThat(response.summary().failed()).isZero();
            return response;
        }

        void close() { context.close(); }
    }
}
