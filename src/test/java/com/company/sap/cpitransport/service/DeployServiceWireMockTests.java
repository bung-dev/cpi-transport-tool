package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.TransportProperties;
import com.github.tomakehurst.wiremock.WireMockServer;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static com.company.sap.cpitransport.model.DeployStatus.*;
import static org.assertj.core.api.Assertions.*;

class DeployServiceWireMockTests {
    private static final String POST = "/api/v1/DeployIntegrationDesigntimeArtifact?Id='IF_Order'&Version='active'";
    private static final String GET = "/api/v1/IntegrationRuntimeArtifacts('IF_Order')";
    private WireMockServer server;
    private DeployService service;
    private final MutableClock clock = new MutableClock();
    private final List<Duration> waits = new ArrayList<>();
    @TempDir Path temporary;

    @BeforeEach
    void setUp() {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        server.start();
        configure(5, 300);
        server.stubFor(post(urlEqualTo("/prd/token")).willReturn(okJson(
                "{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        server.stubFor(get(urlEqualTo("/api/v1/")).willReturn(ok()
                .withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
        server.stubFor(post(urlEqualTo(POST)).willReturn(noContent()));
    }

    private void configure(long interval, long timeout) {
        String base = "http://localhost:" + server.port();
        var properties = new CpiProperties(
                new CpiProperties.Connection(base, base + "/dev/token", "dummy-dev-client", "dummy-dev-secret"),
                new CpiProperties.Connection(base, base + "/prd/token", "dummy-prd-client", "dummy-prd-secret"));
        var transport = new TransportProperties("", new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(interval), Duration.ofSeconds(timeout)), List.of("secret"));
        Sleeper sleeper = duration -> { waits.add(duration); clock.advance(duration); };
        var tokens = new OAuthTokenProvider(properties, transport, clock, sleeper);
        var api = new CpiApiClient(new CpiHttpExecutor(properties, tokens, new CsrfTokenStore(), transport, sleeper),
                JsonMapper.builder().build());
        service = new DeployService(api, transport, clock, sleeper);
    }

    @AfterEach
    void tearDown() { if (server != null) server.stop(); }

    @Test
    @DisplayName("REQ-009 AC-1: two runtime 404s precede STARTED at five second intervals")
    void req009_ac1_notFoundThenStarted() {
        server.stubFor(get(urlEqualTo(GET)).inScenario("poll").whenScenarioStateIs("Started")
                .willReturn(notFound()).willSetStateTo("second"));
        server.stubFor(get(urlEqualTo(GET)).inScenario("poll").whenScenarioStateIs("second")
                .willReturn(notFound()).willSetStateTo("ready"));
        server.stubFor(get(urlEqualTo(GET)).inScenario("poll").whenScenarioStateIs("ready")
                .willReturn(okJson("{\"d\":{\"Status\":\"STARTED\"}}")));
        assertThat(service.deployAndWait("IF_Order")).isEqualTo(STARTED);
        assertThat(waits).containsExactly(Duration.ofSeconds(5), Duration.ofSeconds(5), Duration.ofSeconds(5));
        server.verify(3, getRequestedFor(urlEqualTo(GET)));
        server.verify(1, postRequestedFor(urlEqualTo(POST))
                .withHeader("Authorization", equalTo("Bearer dummy-prd-token-0001")));
        server.verify(0, postRequestedFor(urlEqualTo("/dev/token")));
    }

    @Test
    @DisplayName("REQ-009 AC-2: runtime ERROR ends polling")
    void req009_ac2_error() {
        status("ERROR");
        assertThat(service.deployAndWait("IF_Order")).isEqualTo(ERROR);
        server.verify(1, getRequestedFor(urlEqualTo(GET)));
    }

    @Test
    @DisplayName("REQ-009 AC-1, AC-2: persistent 404 reaches exactly the 300 second deadline")
    void req009_ac1_timeout() {
        server.stubFor(get(urlEqualTo(GET)).willReturn(notFound()));
        assertThat(service.deployAndWait("IF_Order")).isEqualTo(TIMEOUT);
        assertThat(clock.elapsed()).isEqualTo(Duration.ofSeconds(300));
        assertThat(waits).hasSize(60).allMatch(Duration.ofSeconds(5)::equals);
        server.verify(59, getRequestedFor(urlEqualTo(GET)));
    }

    @Test
    @DisplayName("REQ-009 AC-1: changed interval and timeout apply to intermediate states")
    void req009_ac1_customSettings() {
        configure(7, 20);
        status("STARTING");
        assertThat(service.deployAndWait("IF_Order")).isEqualTo(TIMEOUT);
        assertThat(waits).containsExactly(Duration.ofSeconds(7), Duration.ofSeconds(7), Duration.ofSeconds(6));
        assertThat(clock.elapsed()).isEqualTo(Duration.ofSeconds(20));
        server.verify(2, getRequestedFor(urlEqualTo(GET)));
    }

    @Test
    @DisplayName("REQ-009 AC-5: deployment POST exhausted retries returns ERROR without polling")
    void req009_ac5_postFailure() {
        server.stubFor(post(urlEqualTo(POST)).willReturn(serverError()));
        assertThat(service.deployAndWait("IF_Order")).isEqualTo(ERROR);
        server.verify(3, postRequestedFor(urlEqualTo(POST)));
        server.verify(0, getRequestedFor(urlEqualTo(GET)));
        assertThat(waits).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2));
    }

    @Test
    @DisplayName("REQ-009 AC-5: runtime GET exhausted retries returns ERROR")
    void req009_ac5_getFailure() {
        server.stubFor(get(urlEqualTo(GET)).willReturn(serverError()));
        assertThat(service.deployAndWait("IF_Order")).isEqualTo(ERROR);
        server.verify(3, getRequestedFor(urlEqualTo(GET)));
        assertThat(waits).containsExactly(Duration.ofSeconds(5), Duration.ofSeconds(1), Duration.ofSeconds(2));
    }

    @Test
    @DisplayName("REQ-009 AC-1: timeout begins after deployment POST retries finish")
    void req009_ac1_postTimeExcluded() {
        configure(5, 10);
        server.stubFor(post(urlEqualTo(POST)).inScenario("deploy").whenScenarioStateIs("Started")
                .willReturn(serverError()).willSetStateTo("ready"));
        server.stubFor(post(urlEqualTo(POST)).inScenario("deploy").whenScenarioStateIs("ready")
                .willReturn(noContent()));
        server.stubFor(get(urlEqualTo(GET)).willReturn(notFound()));
        assertThat(service.deployAndWait("IF_Order")).isEqualTo(TIMEOUT);
        assertThat(clock.elapsed()).isEqualTo(Duration.ofSeconds(11));
        server.verify(2, postRequestedFor(urlEqualTo(POST)));
        server.verify(1, getRequestedFor(urlEqualTo(GET)));
    }

    private void status(String value) {
        server.stubFor(get(urlEqualTo(GET)).willReturn(okJson("{\"d\":{\"Status\":\"" + value + "\"}}")));
    }

    private static class MutableClock extends Clock {
        private final Instant start = Instant.parse("2026-09-29T00:00:00Z");
        private Instant now = start;
        void advance(Duration duration) { now = now.plus(duration); }
        Duration elapsed() { return Duration.between(start, now); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(now, zone); }
        @Override public Instant instant() { return now; }
    }
}