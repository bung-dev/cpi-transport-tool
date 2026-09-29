package com.company.sap.cpitransport.client;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.TransportProperties;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.http.Fault;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;

class CpiHttpExecutorWireMockTests {
    private WireMockServer server;
    private CpiHttpExecutor executor;
    private final List<Duration> waits = new ArrayList<>();

    @BeforeEach
    void setUp() {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        server.start();
        for (String env : List.of("dev", "prd")) {
            server.stubFor(post(urlEqualTo("/" + env + "/oauth/token")).willReturn(okJson(
                    "{\"access_token\":\"dummy-" + env + "-token-0001\",\"expires_in\":3600}")));
            server.stubFor(get(urlEqualTo("/" + env + "/api/v1/"))
                    .withHeader("X-CSRF-Token", equalTo("Fetch"))
                    .willReturn(ok().withHeader("X-CSRF-Token", "dummy-" + env + "-csrf-0001")
                            .withHeader("Set-Cookie", "JSESSIONID=dummy-" + env + "-session-0001; Path=/; HttpOnly")));
        }
        configure(3);
    }

    private void configure(int attempts) {
        var properties = new CpiProperties(connection("dev"), connection("prd"));
        var transport = new TransportProperties("", new TransportProperties.History(null),
                new TransportProperties.Retry(attempts, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(5), Duration.ofSeconds(300)), List.of());
        var provider = new OAuthTokenProvider(properties, transport,
                Clock.fixed(Instant.parse("2026-09-29T00:00:00Z"), ZoneOffset.UTC), waits::add);
        executor = new CpiHttpExecutor(properties, provider, new CsrfTokenStore(), transport, waits::add);
    }

    private CpiProperties.Connection connection(String env) {
        String base = "http://localhost:" + server.port() + "/" + env;
        return new CpiProperties.Connection(base, base + "/oauth/token", "dummy-" + env + "-client",
                "dummy-" + env + "-secret");
    }

    @AfterEach
    void tearDown() { server.stop(); }

    private void call(HttpMethod method) {
        executor.execute(CpiEnvironment.DEV, method, "/api/v1/items",
                method == HttpMethod.GET ? null : "{}".getBytes(StandardCharsets.UTF_8), true);
    }

    private void sequence(HttpMethod method, int... statuses) {
        for (int i = 0; i < statuses.length; i++) {
            server.stubFor(request(method.name(), urlEqualTo("/dev/api/v1/items"))
                    .inScenario("responses").whenScenarioStateIs(i == 0 ? "Started" : "step" + i)
                    .willReturn(aResponse().withStatus(statuses[i]).withHeader("X-CSRF-Token", "Required"))
                    .willSetStateTo("step" + (i + 1)));
        }
    }

    @Test
    @DisplayName("REQ-003 AC-4: Bearer and JSON Accept, binary download excludes Accept")
    void req003_ac4_headersAndDownload() {
        server.stubFor(get(urlEqualTo("/dev/api/v1/items")).willReturn(okJson("{}")));
        server.stubFor(get(urlEqualTo("/dev/api/v1/items/$value")).willReturn(ok().withBody(new byte[]{0, 1, 2})));
        call(HttpMethod.GET);
        assertThat(executor.execute(CpiEnvironment.DEV, HttpMethod.GET, "/api/v1/items/$value", null, true)
                .getBody()).containsExactly(0, 1, 2);
        server.verify(1, getRequestedFor(urlEqualTo("/dev/api/v1/items"))
                .withHeader("Authorization", equalTo("Bearer dummy-dev-token-0001"))
                .withHeader("Accept", equalTo("application/json")));
        server.verify(1, getRequestedFor(urlEqualTo("/dev/api/v1/items/$value"))
                .withHeader("Authorization", equalTo("Bearer dummy-dev-token-0001"))
                .withHeader("Accept", absent()));
        server.verify(0, getRequestedFor(urlEqualTo("/dev/api/v1/")));
        server.verify(1, postRequestedFor(urlEqualTo("/dev/oauth/token")));
    }

    @Test
    @DisplayName("REQ-004 AC-5: resource 404 is not flagged as token-stage failure")
    void req004_ac5_tokenStageFlag() {
        server.stubFor(get(urlEqualTo("/dev/api/v1/items")).willReturn(notFound()));
        assertThatThrownBy(() -> call(HttpMethod.GET)).isInstanceOfSatisfying(CpiCallException.class,
                ex -> assertThat(ex.isTokenStageFailure()).isFalse());
    }

    @Test
    @DisplayName("REQ-004 AC-5: token endpoint 404 is flagged as token-stage failure")
    void req004_ac5_tokenStageFlagOnTokenFailure() {
        server.stubFor(post(urlEqualTo("/dev/oauth/token")).willReturn(notFound()));
        assertThatThrownBy(() -> call(HttpMethod.GET)).isInstanceOfSatisfying(CpiCallException.class,
                ex -> assertThat(ex.isTokenStageFailure()).isTrue());
    }

    @Test
    @DisplayName("REQ-003 AC-1: POST and PUT reuse environment-specific CSRF and cookies")
    void req003_ac1_cacheAndEnvironmentIsolation() {
        for (String env : List.of("dev", "prd")) {
            server.stubFor(any(urlEqualTo("/" + env + "/api/v1/items")).willReturn(ok()));
            for (HttpMethod method : List.of(HttpMethod.POST, HttpMethod.PUT)) {
                executor.execute(CpiEnvironment.valueOf(env.toUpperCase(java.util.Locale.ROOT)), method,
                        "/api/v1/items", "{}".getBytes(StandardCharsets.UTF_8), true);
                server.verify(1, new com.github.tomakehurst.wiremock.matching.RequestPatternBuilder(
                        com.github.tomakehurst.wiremock.http.RequestMethod.fromString(method.name()), urlEqualTo("/" + env + "/api/v1/items"))
                        .withHeader("X-CSRF-Token", equalTo("dummy-" + env + "-csrf-0001"))
                        .withHeader("Cookie", equalTo("JSESSIONID=dummy-" + env + "-session-0001"))
                        .withHeader("Authorization", equalTo("Bearer dummy-" + env + "-token-0001"))
                        .withRequestBody(equalTo("{}")));
            }
            server.verify(1, getRequestedFor(urlEqualTo("/" + env + "/api/v1/"))
                    .withHeader("Accept", equalTo("application/json"))
                    .withHeader("Authorization", equalTo("Bearer dummy-" + env + "-token-0001")));
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {200, 403})
    @DisplayName("REQ-003 AC-2: Required refreshes CSRF once, repeated 403 fails")
    void req003_ac2_refreshOnce(int second) {
        sequence(HttpMethod.POST, 403, second);
        if (second == 200) call(HttpMethod.POST);
        else assertThatThrownBy(() -> call(HttpMethod.POST)).isInstanceOfSatisfying(CpiCallException.class,
                failure -> assertThat(failure.httpStatus()).isEqualTo(403));
        server.verify(2, postRequestedFor(urlEqualTo("/dev/api/v1/items")));
        server.verify(2, getRequestedFor(urlEqualTo("/dev/api/v1/")));
        assertThat(waits).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(ints = {200, 401})
    @DisplayName("REQ-002 AC-5: 401 invalidates OAuth cache once, repeated 401 fails")
    void req002_ac5_refreshOnce(int second) {
        sequence(HttpMethod.GET, 401, second);
        if (second == 200) call(HttpMethod.GET);
        else assertThatThrownBy(() -> call(HttpMethod.GET)).isInstanceOfSatisfying(CpiCallException.class,
                failure -> assertThat(failure.httpStatus()).isEqualTo(401));
        server.verify(2, getRequestedFor(urlEqualTo("/dev/api/v1/items")));
        server.verify(2, postRequestedFor(urlEqualTo("/dev/oauth/token")));
        assertThat(waits).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(ints = {503, 429})
    @DisplayName("REQ-003 AC-3: transient HTTP status retries then succeeds")
    void req003_ac3_transientSuccess(int status) {
        sequence(HttpMethod.GET, status, 200);
        call(HttpMethod.GET);
        server.verify(2, getRequestedFor(urlEqualTo("/dev/api/v1/items")));
        assertThat(waits).containsExactly(Duration.ofSeconds(1));
    }

    @Test
    @DisplayName("REQ-003 AC-3: connection reset retries then succeeds")
    void req003_ac3_ioSuccess() {
        server.stubFor(post(urlEqualTo("/dev/api/v1/items")).inScenario("io").whenScenarioStateIs("Started")
                .willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)).willSetStateTo("ok"));
        server.stubFor(post(urlEqualTo("/dev/api/v1/items")).inScenario("io").whenScenarioStateIs("ok")
                .willReturn(ok()));
        call(HttpMethod.POST);
        server.verify(2, postRequestedFor(urlEqualTo("/dev/api/v1/items")));
        assertThat(waits).containsExactly(Duration.ofSeconds(1));
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 3})
    @DisplayName("REQ-003 AC-3: max attempts includes first request with exponential backoff")
    void req003_ac3_attemptLimit(int attempts) {
        configure(attempts);
        server.stubFor(get(urlEqualTo("/dev/api/v1/items")).willReturn(serverError()));
        assertThatThrownBy(() -> call(HttpMethod.GET)).isInstanceOfSatisfying(CpiCallException.class,
                failure -> assertThat(failure.httpStatus()).isEqualTo(500));
        server.verify(attempts, getRequestedFor(urlEqualTo("/dev/api/v1/items")));
        assertThat(waits).containsExactlyElementsOf(attempts == 1 ? List.of() :
                List.of(Duration.ofSeconds(1), Duration.ofSeconds(2)));
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 404, 403})
    @DisplayName("REQ-003 AC-3: other 4xx fail immediately")
    void req003_ac3_otherClientErrors(int status) {
        server.stubFor(post(urlEqualTo("/dev/api/v1/items")).willReturn(aResponse().withStatus(status)));
        assertThatThrownBy(() -> call(HttpMethod.POST)).isInstanceOfSatisfying(CpiCallException.class,
                failure -> assertThat(failure.httpStatus()).isEqualTo(status));
        server.verify(1, postRequestedFor(urlEqualTo("/dev/api/v1/items")));
        server.verify(1, getRequestedFor(urlEqualTo("/dev/api/v1/")));
        assertThat(waits).isEmpty();
    }

    @Test
    @DisplayName("REQ-003 AC-3: auth and CSRF replays share transient retry budget")
    void req003_ac3_combinedBudget() {
        sequence(HttpMethod.POST, 500, 401, 403, 429, 500);
        assertThatThrownBy(() -> call(HttpMethod.POST)).isInstanceOfSatisfying(CpiCallException.class,
                failure -> assertThat(failure.httpStatus()).isEqualTo(500));
        server.verify(5, postRequestedFor(urlEqualTo("/dev/api/v1/items")));
        server.verify(2, postRequestedFor(urlEqualTo("/dev/oauth/token")));
        server.verify(2, getRequestedFor(urlEqualTo("/dev/api/v1/")));
        assertThat(waits).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2));
    }

    @Test
    @DisplayName("REQ-002 AC-6: errors sanitize secrets before truncating to 200 characters")
    void req002_ac6_safeErrorSummary() {
        String body = "failure dummy-dev-token-0001 dummy-dev-secret dummy-prd-secret "
                + "dummy-dev-csrf-0001 dummy-dev-session-0001\nAuthorization: Bearer dummy-dev-token-0001\n"
                + "Cookie: JSESSIONID=dummy-dev-session-0001\n" + "x".repeat(250);
        server.stubFor(post(urlEqualTo("/dev/api/v1/items")).willReturn(badRequest().withBody(body)));
        assertThatThrownBy(() -> call(HttpMethod.POST)).isInstanceOfSatisfying(CpiCallException.class, failure -> {
            assertThat(failure.getMessage()).startsWith("failure").hasSize(200)
                    .doesNotContain("dummy-", "Bearer", "JSESSIONID");
            assertThat(failure.getCause()).isNull();
        });
    }

    @Test
    @DisplayName("REQ-003 AC-3: interruption stops retries and preserves interrupt flag")
    void req003_ac3_interruption() {
        var properties = new CpiProperties(connection("dev"), connection("prd"));
        var transport = new TransportProperties("", null,
                new TransportProperties.Retry(3, Duration.ofSeconds(1)), null, List.of());
        executor = new CpiHttpExecutor(properties,
                new OAuthTokenProvider(properties, transport, Clock.systemUTC(), waits::add),
                new CsrfTokenStore(), transport, delay -> { throw new InterruptedException(); });
        server.stubFor(get(urlEqualTo("/dev/api/v1/items")).willReturn(serverError()));
        try {
            assertThatThrownBy(() -> call(HttpMethod.GET)).isInstanceOf(CpiCallException.class);
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally { Thread.interrupted(); }
        server.verify(1, getRequestedFor(urlEqualTo("/dev/api/v1/items")));
    }

    @Test
    @DisplayName("REQ-003 AC-3: repeated IO failures stop at max attempts")
    void req003_ac3_ioExhausted() {
        server.stubFor(post(urlEqualTo("/dev/api/v1/items"))
                .willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)));
        assertThatThrownBy(() -> call(HttpMethod.POST)).isInstanceOfSatisfying(CpiCallException.class,
                failure -> {
                    assertThat(failure.httpStatus()).isNull();
                    assertThat(failure.getCause()).isNull();
                });
        server.verify(3, postRequestedFor(urlEqualTo("/dev/api/v1/items")));
        assertThat(waits).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2));
    }

    @Test
    @DisplayName("REQ-002 AC-5: refreshed OAuth token is used on replay")
    void req002_ac5_replayUsesNewToken() {
        server.stubFor(post(urlEqualTo("/dev/oauth/token")).inScenario("oauth")
                .whenScenarioStateIs("Started").willReturn(okJson(
                        "{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}"))
                .willSetStateTo("renewed"));
        server.stubFor(post(urlEqualTo("/dev/oauth/token")).inScenario("oauth")
                .whenScenarioStateIs("renewed").willReturn(okJson(
                        "{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        sequence(HttpMethod.GET, 401, 200);
        call(HttpMethod.GET);
        server.verify(1, getRequestedFor(urlEqualTo("/dev/api/v1/items"))
                .withHeader("Authorization", equalTo("Bearer dummy-prd-token-0001")));
    }

    @Test
    @DisplayName("REQ-003 AC-2: refreshed CSRF token and cookie replace stale pair")
    void req003_ac2_replayUsesNewSession() {
        // AI-NOTE: Both rotating values use the approved dummy table, within one DEV scenario.
        server.stubFor(get(urlEqualTo("/dev/api/v1/")).inScenario("csrf")
                .whenScenarioStateIs("Started").willReturn(ok()
                        .withHeader("X-CSRF-Token", "dummy-dev-csrf-0001")
                        .withHeader("Set-Cookie", "JSESSIONID=dummy-dev-session-0001; Path=/"))
                .willSetStateTo("renewed"));
        server.stubFor(get(urlEqualTo("/dev/api/v1/")).inScenario("csrf")
                .whenScenarioStateIs("renewed").willReturn(ok()
                        .withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")
                        .withHeader("Set-Cookie", "JSESSIONID=dummy-prd-session-0001; Path=/")));
        sequence(HttpMethod.PUT, 403, 200);
        call(HttpMethod.PUT);
        server.verify(1, putRequestedFor(urlEqualTo("/dev/api/v1/items"))
                .withHeader("X-CSRF-Token", equalTo("dummy-prd-csrf-0001"))
                .withHeader("Cookie", equalTo("JSESSIONID=dummy-prd-session-0001")));
    }

    @Test
    @DisplayName("REQ-003 AC-1: missing CSRF token fails before any write")
    void req003_ac1_missingToken() {
        server.stubFor(get(urlEqualTo("/dev/api/v1/")).willReturn(ok()));
        assertThatThrownBy(() -> call(HttpMethod.POST)).isInstanceOf(CpiCallException.class);
        server.verify(0, postRequestedFor(urlEqualTo("/dev/api/v1/items")));
    }
}
