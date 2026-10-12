package com.company.sap.cpitransport.service;

import java.time.*;
import java.util.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.model.TenantStatusResponse.Check;
import com.company.sap.cpitransport.tenant.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.test.system.*;
import tools.jackson.databind.ObjectMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;
import static org.assertj.core.api.Assertions.*;

@ExtendWith(OutputCaptureExtension.class)
class TenantStatusWireMockTests {
    WireMockServer server;
    TenantStatusService service;
    MutableClock clock;
    final ObjectMapper json = new ObjectMapper();
    @BeforeEach void setup() {
        server = new WireMockServer(options().dynamicPort().bindAddress("localhost")); server.start();
        clock = new MutableClock();
        service = service(Duration.ofSeconds(2));
        token(200, "{\"access_token\":\"test-dummy-token\",\"expires_in\":3600}", 0);
        read(200, "{\"d\":{\"results\":[]}}", 0);
    }
    @AfterEach void stop() { service.close(); server.stop(); }
    TenantStatusService service(Duration limit) {
        var connection = new CpiProperties.Connection(server.baseUrl() + "/api/v1",
                server.baseUrl() + "/oauth/token", "test-dummy-client", "test-dummy-secret");
        return new TenantStatusService(TenantRegistry.initial(new CpiProperties(connection, connection)),
                new ReadOnlyProperties(true), clock, json, limit);
    }
    void token(int status, String body, int delay) {
        server.stubFor(post(urlEqualTo("/oauth/token")).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json").withBody(body).withFixedDelay(delay)));
    }
    void read(int status, String body, int delay) {
        server.stubFor(get(urlEqualTo("/api/v1/IntegrationPackages?$top=1"))
                .willReturn(aResponse().withStatus(status).withBody(body).withFixedDelay(delay)));
    }
    Check check() { return service.status("DEV", true).tenants().getFirst().check(); }
    @ParameterizedTest(name = "REQ-303 AC-1·AC-5: token status {0}")
    @CsvSource({"401", "500"})
    @DisplayName("REQ-303 AC-1·AC-5: token HTTP failures")
    void req303_ac1_tokenStatus(int status) {
        token(status, "test-dummy-secret", 0); assertThat(check()).isEqualTo(Check.TOKEN_FAILED);
        server.verify(1, postRequestedFor(urlEqualTo("/oauth/token")));
        server.verify(0, getRequestedFor(urlMatching(".*")));
    }
    @Test @DisplayName("REQ-303 AC-1·AC-5: malformed token responses")
    void req303_ac1_tokenShape() {
        for (String body : List.of("not-json", "{}", "{\"access_token\":\"\",\"expires_in\":1}",
                "{\"access_token\":\"test-dummy-token\",\"expires_in\":0}",
                "{\"access_token\":\"test-dummy-token\",\"expires_in\":\"3600\"}")) {
            token(200, body, 0); assertThat(check()).isEqualTo(Check.TOKEN_FAILED);
        }
    }
    @ParameterizedTest(name = "REQ-303 AC-1·AC-5: read status {0}")
    @CsvSource({"401,API_FORBIDDEN", "403,API_FORBIDDEN", "500,ERROR", "404,ERROR", "200,OK"})
    @DisplayName("REQ-303 AC-1·AC-5: read classifications")
    void req303_ac1_readStatus(int status, Check expected) {
        read(status, "{\"d\":{\"results\":[]}}", 0); assertThat(check()).isEqualTo(expected);
    }
    @Test @DisplayName("REQ-303 AC-1·AC-5: invalid read shapes")
    void req303_ac1_readShape() {
        for (String body : List.of("<html>test-dummy-secret</html>", "{}", "{\"d\":{\"results\":{}}}")) {
            read(200, body, 0); assertThat(check()).isEqualTo(Check.ERROR);
        }
    }
    @Test @DisplayName("REQ-303 AC-1·AC-5 / REQ-305 AC-3: safe response fields and output")
    void req303_ac1_safe(CapturedOutput output) {
        var response = service.status(null, false);
        var body = json.readTree(json.writeValueAsString(response));
        Set<String> fields = new HashSet<>(); body.path("tenants").get(0).propertyNames().forEach(fields::add);
        assertThat(fields).containsExactlyInAnyOrder("id", "name", "source", "apiHost", "check");
        assertThat(body.path("readOnly").asBoolean()).isTrue();
        assertThat(json.writeValueAsString(response)).doesNotContain("test-dummy-client", "test-dummy-secret",
                "test-dummy-token", "/api/v1", "/oauth/token");
        token(500, "test-dummy-secret", 0); check(); read(200, "test-dummy-token", 0);
        token(200, "{\"access_token\":\"test-dummy-token\",\"expires_in\":3600}", 0); check();
        assertThat(output.getAll()).doesNotContain("test-dummy-client", "test-dummy-secret", "test-dummy-token");
    }
    @Test @DisplayName("REQ-303 AC-2·AC-5: exactly one token and one read per selected tenant")
    void req303_ac2_requests() {
        assertThat(service.status("DEV", false).tenants()).hasSize(1);
        server.verify(1, postRequestedFor(urlEqualTo("/oauth/token"))
                .withBasicAuth(new com.github.tomakehurst.wiremock.client.BasicCredentials("test-dummy-client", "test-dummy-secret"))
                .withRequestBody(equalTo("grant_type=client_credentials")));
        server.verify(1, getRequestedFor(urlEqualTo("/api/v1/IntegrationPackages?$top=1"))
                .withHeader("Authorization", equalTo("Bearer test-dummy-token"))
                .withHeader("Accept", equalTo("application/json")));
        server.verify(0, anyRequestedFor(anyUrl()).withHeader("X-CSRF-Token", equalTo("Fetch")));
        assertThat(server.getAllServeEvents()).hasSize(2);
    }
    @Test @DisplayName("REQ-303 AC-3·AC-5: cache expiry refresh and invalidation")
    void req303_ac3_cache() {
        service.status("DEV", false); service.status("DEV", false);
        clock.now = clock.now.plusSeconds(59); service.status("DEV", false);
        server.verify(1, postRequestedFor(anyUrl()));
        clock.now = clock.now.plusSeconds(1); service.status("DEV", false);
        service.status("DEV", true); server.verify(3, postRequestedFor(anyUrl()));
        service.changed(new TenantChangedEvent("DEV")); service.status("DEV", false);
        server.verify(4, postRequestedFor(anyUrl()));
    }
    @Test @DisplayName("REQ-303 AC-3·AC-5: parallel checks and total two-request deadline")
    void req303_ac3_deadline() {
        service.close(); service = service(Duration.ofMillis(900));
        token(200, "{\"access_token\":\"test-dummy-token\",\"expires_in\":3600}", 300);
        read(200, "{\"d\":{\"results\":[]}}", 300);
        long start = System.nanoTime();
        assertThat(service.status(null, true).tenants()).allMatch(t -> t.check() == Check.OK);
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofMillis(1100));
        token(200, "{\"access_token\":\"test-dummy-token\",\"expires_in\":3600}", 600);
        read(200, "{\"d\":{\"results\":[]}}", 600);
        assertThat(check()).isEqualTo(Check.UNREACHABLE);
    }
    @Test @DisplayName("REQ-303 AC-1·AC-5: connection refused and empty registry")
    void req303_ac1_unreachableEmpty() {
        server.stop(); assertThat(check()).isEqualTo(Check.UNREACHABLE);
        var empty = new TenantStatusService(TenantRegistry.initial(new CpiProperties(new CpiProperties.Connection("", "", "", ""), new CpiProperties.Connection("", "", "", ""))),
                new ReadOnlyProperties(true), clock, json);
        try { assertThat(empty.status(null, false).tenants()).isEmpty(); } finally { empty.close(); }
    }
    @Test @DisplayName("REQ-303 AC-3·AC-5: concurrent callers share one in-flight check")
    void req303_ac3_concurrent() {
        token(200, "{\"access_token\":\"test-dummy-token\",\"expires_in\":3600}", 100);
        try (var callers = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var requests = java.util.stream.IntStream.range(0, 8).mapToObj(i ->
                    java.util.concurrent.CompletableFuture.supplyAsync(() -> service.status("DEV", false), callers)).toList();
            requests.forEach(request -> assertThat(request.join().tenants().getFirst().check()).isEqualTo(Check.OK));
        }
        server.verify(1, postRequestedFor(anyUrl())); server.verify(1, getRequestedFor(anyUrl()));
    }
    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-07T00:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
    }
}
