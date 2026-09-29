package com.company.sap.cpitransport.client;

import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.CpiProperties.Environment;
import com.company.sap.cpitransport.config.TransportProperties;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.http.Fault;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;
import static org.assertj.core.api.Assertions.*;

@ExtendWith(OutputCaptureExtension.class)
class OAuthTokenProviderWireMockTests {
    private WireMockServer server;
    private MutableClock clock;
    private List<Duration> delays;
    private OAuthTokenProvider provider;

    @BeforeEach
    void setUp() {
        server = new WireMockServer(options().dynamicPort().bindAddress("localhost"));
        server.start();
        clock = new MutableClock();
        delays = new ArrayList<>();
        provider = provider(3, delays::add);
        success("dev", 3600);
        success("prd", 3600);
    }

    @AfterEach
    void tearDown() {
        server.stop();
    }

    private OAuthTokenProvider provider(int attempts, Sleeper sleeper) {
        var properties = new CpiProperties(connection("dev"), connection("prd"));
        var transport = new TransportProperties("", null,
                new TransportProperties.Retry(attempts, Duration.ofSeconds(1)), null, List.of());
        return new OAuthTokenProvider(properties, transport, clock, sleeper);
    }

    private CpiProperties.Connection connection(String env) {
        String base = "http://localhost:" + server.port();
        return new CpiProperties.Connection(base, base + "/" + env + "/oauth/token",
                "dummy-" + env + "-client", "dummy-" + env + "-secret");
    }

    private void success(String env, long seconds) {
        server.stubFor(post(urlEqualTo("/" + env + "/oauth/token"))
                .willReturn(okJson("{\"access_token\":\"dummy-" + env
                        + "-token-0001\",\"expires_in\":" + seconds + "}")));
    }

    private void count(String env, int count) {
        server.verify(count, postRequestedFor(urlEqualTo("/" + env + "/oauth/token")));
    }

    @Test
    @DisplayName("REQ-002 AC-3: token request uses form body and HTTP Basic")
    void req002_ac3_requestFormat() {
        assertThat(provider.getToken(Environment.DEV)).isEqualTo("dummy-dev-token-0001");
        server.verify(1, postRequestedFor(urlEqualTo("/dev/oauth/token"))
                .withHeader("Content-Type", containing("application/x-www-form-urlencoded"))
                .withBasicAuth(new com.github.tomakehurst.wiremock.client.BasicCredentials("dummy-dev-client", "dummy-dev-secret"))
                .withRequestBody(equalTo("grant_type=client_credentials")));
    }

    @Test
    @DisplayName("REQ-002 AC-4: consecutive calls reuse cached token")
    void req002_ac4_reuse() {
        provider.getToken(Environment.DEV);
        provider.getToken(Environment.DEV);
        count("dev", 1);
    }

    @Test
    @DisplayName("REQ-002 AC-4: refresh immediately at the sixty second boundary")
    void req002_ac4_refreshBoundary() {
        provider.getToken(Environment.DEV);
        clock.now = clock.now.plusSeconds(3540).minusNanos(1);
        provider.getToken(Environment.DEV);
        count("dev", 1);
        clock.now = clock.now.plusNanos(1);
        provider.getToken(Environment.DEV);
        count("dev", 2);
        clock.now = clock.now.plusNanos(1);
        provider.getToken(Environment.DEV);
        count("dev", 2);
    }

    @Test
    @DisplayName("REQ-002 AC-5: invalidation forces token reissue")
    void req002_ac5_invalidate() {
        provider.getToken(Environment.DEV);
        provider.invalidate(Environment.DEV);
        provider.getToken(Environment.DEV);
        count("dev", 2);
    }

    @Test
    @DisplayName("REQ-002 AC-4: environment caches and invalidation are isolated")
    void req002_ac4_environmentIsolation() {
        assertThat(provider.getToken(Environment.DEV)).isEqualTo("dummy-dev-token-0001");
        assertThat(provider.getToken(Environment.PRD)).isEqualTo("dummy-prd-token-0001");
        provider.invalidate(Environment.DEV);
        provider.getToken(Environment.DEV);
        provider.getToken(Environment.PRD);
        count("dev", 2);
        count("prd", 1);
    }

    @Test
    @DisplayName("REQ-002 AC-4: concurrent callers issue one token per environment")
    void req002_ac4_concurrentRequests() throws Exception {
        try (var pool = Executors.newFixedThreadPool(12)) {
            var start = new CountDownLatch(1);
            List<Future<String>> results = new ArrayList<>();
            for (int i = 0; i < 12; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return provider.getToken(Environment.DEV);
                }));
            }
            start.countDown();
            for (var result : results) {
                assertThat(result.get(10, TimeUnit.SECONDS)).isEqualTo("dummy-dev-token-0001");
            }
        }
        count("dev", 1);
    }

    @Test
    @DisplayName("REQ-002 AC-4: short lived tokens are not reused")
    void req002_ac4_shortLifetime() {
        success("dev", 60);
        provider.getToken(Environment.DEV);
        provider.getToken(Environment.DEV);
        count("dev", 2);
    }

    @Test
    @DisplayName("REQ-002 AC-3: transient HTTP failures use bounded exponential backoff")
    void req002_ac3_retryHttpFailures() {
        for (int status : new int[]{500, 503, 429}) {
            server.resetRequests();
            delays.clear();
            server.stubFor(post(urlEqualTo("/dev/oauth/token")).willReturn(aResponse().withStatus(status)));
            assertThatThrownBy(() -> provider.getToken(Environment.DEV))
                    .isInstanceOf(OAuthTokenProvider.TokenRequestException.class);
            count("dev", 3);
            assertThat(delays).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2));
        }
        success("dev", 3600);
        assertThat(provider.getToken(Environment.DEV)).isEqualTo("dummy-dev-token-0001");
        count("dev", 4);
    }

    @Test
    @DisplayName("REQ-002 AC-3: retry recovers from transient failure")
    void req002_ac3_retryRecovery() {
        server.stubFor(post(urlEqualTo("/dev/oauth/token")).inScenario("retry")
                .whenScenarioStateIs("Started").willSetStateTo("ready")
                .willReturn(aResponse().withStatus(503)));
        server.stubFor(post(urlEqualTo("/dev/oauth/token")).inScenario("retry")
                .whenScenarioStateIs("ready")
                .willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        provider.getToken(Environment.DEV);
        count("dev", 2);
        assertThat(delays).containsExactly(Duration.ofSeconds(1));
    }

    @Test
    @DisplayName("REQ-002 AC-3: IO failures are retried without leaking their cause")
    void req002_ac3_retryIo() {
        server.stubFor(post(urlEqualTo("/dev/oauth/token"))
                .willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)));
        assertThatThrownBy(() -> provider.getToken(Environment.DEV))
                .isInstanceOf(OAuthTokenProvider.TokenRequestException.class).hasNoCause();
        count("dev", 3);
        assertThat(delays).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2));
    }

    @Test
    @DisplayName("REQ-002 AC-3: non retryable status and single attempt do not wait")
    void req002_ac3_noRetry() {
        for (int status : new int[]{400, 401, 403, 404}) {
            server.resetRequests();
            server.stubFor(post(urlEqualTo("/dev/oauth/token")).willReturn(aResponse().withStatus(status)));
            assertThatThrownBy(() -> provider.getToken(Environment.DEV))
                    .isInstanceOf(OAuthTokenProvider.TokenRequestException.class);
            count("dev", 1);
        }
        server.resetRequests();
        server.stubFor(post(urlEqualTo("/dev/oauth/token")).willReturn(aResponse().withStatus(500)));
        assertThatThrownBy(() -> provider(1, delays::add).getToken(Environment.DEV))
                .isInstanceOf(OAuthTokenProvider.TokenRequestException.class);
        count("dev", 1);
        assertThat(delays).isEmpty();
    }

    @Test
    @DisplayName("REQ-002 AC-6: logs and exception chains do not expose credentials or response bodies")
    void req002_ac6_redaction(CapturedOutput output) {
        provider.getToken(Environment.DEV);
        provider.getToken(Environment.PRD);
        provider.invalidate(Environment.DEV);
        for (String body : List.of("dummy-dev-secret dummy-dev-token-0001", "{}",
                "{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":-1}")) {
            server.stubFor(post(urlEqualTo("/dev/oauth/token")).willReturn(okJson(body)));
            assertThatThrownBy(() -> provider.getToken(Environment.DEV))
                    .isInstanceOf(OAuthTokenProvider.TokenRequestException.class)
                    .hasMessage("Token request failed (HTTP status: unavailable)").hasNoCause();
        }
        server.stubFor(post(urlEqualTo("/dev/oauth/token")).willReturn(aResponse().withStatus(401)
                .withBody("dummy-dev-secret dummy-dev-token-0001")));
        assertThatThrownBy(() -> provider.getToken(Environment.DEV))
                .hasMessage("Token request failed (HTTP status: 401)").hasNoCause();
        assertThat(new AccessToken("dummy-dev-token-0001", clock.instant()).toString())
                .isEqualTo("AccessToken[redacted]");
        assertThat(output.getAll()).doesNotContain("dummy-dev-secret", "dummy-prd-secret",
                "dummy-dev-token-0001", "dummy-prd-token-0001",
                Base64.getEncoder().encodeToString("dummy-dev-client:dummy-dev-secret".getBytes(java.nio.charset.StandardCharsets.ISO_8859_1)));
    }

    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-09-29T00:00:00Z");
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(now, zone); }
        @Override public Instant instant() { return now; }
    }
}