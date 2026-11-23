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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;

/**
 * 탐색용(spike) 테스트: cTMS/Content Agent가 쓰는 Cloud Integration 경로
 * {@code <oauth.url>/api/1.0/transportmodule/Transport}를 기존 CpiHttpExecutor로 부를 수 있는지만 본다.
 * 이 경로의 요청·응답 형식은 SAP가 공개하지 않았다.
 * 스텁의 본문·상태는 가정이며, 실제 테넌트 동작을 증명하지 않는다.
 */
class TransportModuleApiSpikeTests {
    private static final String PATH = "/api/1.0/transportmodule/Transport";
    private WireMockServer server;
    private CpiHttpExecutor executor;
    private final List<Duration> waits = new ArrayList<>();

    @BeforeEach
    void setUp() {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        server.start();
        server.stubFor(post(urlEqualTo("/dev/oauth/token")).willReturn(okJson(
                "{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        server.stubFor(get(urlEqualTo("/dev/api/v1/")).withHeader("X-CSRF-Token", equalTo("Fetch"))
                .willReturn(ok().withHeader("X-CSRF-Token", "dummy-dev-csrf-0001")));
        String base = "http://localhost:" + server.port() + "/dev";
        var connection = new CpiProperties.Connection(base, base + "/oauth/token", "dummy-dev-client", "dummy-dev-secret");
        var properties = new CpiProperties(connection, connection);
        var transport = new TransportProperties(new TransportProperties.History(null),
                new TransportProperties.Retry(1, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(5), Duration.ofSeconds(300)), List.of());
        var provider = new OAuthTokenProvider(properties, transport,
                Clock.fixed(Instant.parse("2026-11-19T00:00:00Z"), ZoneOffset.UTC), waits::add);
        executor = new CpiHttpExecutor(properties, provider, new CsrfTokenStore(), transport, waits::add);
    }

    @AfterEach
    void tearDown() { server.stop(); }

    @Test
    @DisplayName("같은 서비스 키 토큰으로 apiUrl 기준 transportmodule 경로를 GET할 수 있다")
    void getUsesSameBearerAndHost() {
        server.stubFor(get(urlEqualTo("/dev" + PATH)).willReturn(okJson("{}")));
        var response = executor.execute(CpiEnvironment.DEV, HttpMethod.GET, PATH, null, true);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        server.verify(1, getRequestedFor(urlEqualTo("/dev" + PATH))
                .withHeader("Authorization", equalTo("Bearer dummy-dev-token-0001")));
        server.verify(1, postRequestedFor(urlEqualTo("/dev/oauth/token")));
    }

    @Test
    @DisplayName("POST는 /api/v1/에서 CSRF를 먼저 받고 JSON 본문으로만 보낸다(MTAR·multipart 업로드는 현재 실행기로 불가)")
    void postAlwaysJsonWithCsrfFromODataRoot() {
        server.stubFor(post(urlEqualTo("/dev" + PATH)).willReturn(aResponse().withStatus(202)
                .withHeader("Content-Type", "application/json").withBody("{\"processId\":\"dummy-0001\"}")));
        var response = executor.execute(CpiEnvironment.DEV, HttpMethod.POST, PATH,
                "{\"packageId\":\"DummyPackage\"}".getBytes(StandardCharsets.UTF_8), true);
        assertThat(response.getStatusCode().value()).isEqualTo(202);
        server.verify(1, getRequestedFor(urlEqualTo("/dev/api/v1/")));
        server.verify(1, postRequestedFor(urlEqualTo("/dev" + PATH))
                .withHeader("Content-Type", equalTo("application/json"))
                .withHeader("X-CSRF-Token", equalTo("dummy-dev-csrf-0001")));
    }

    @Test
    @DisplayName("바이너리(MTAR 가정) 응답 본문은 그대로 돌려받는다")
    void binaryBodyIsReturnedIntact() {
        byte[] archive = {'P', 'K', 3, 4, 0, 1, 2};
        server.stubFor(get(urlEqualTo("/dev" + PATH + "/$value"))
                .willReturn(ok().withHeader("Content-Type", "application/octet-stream").withBody(archive)));
        var response = executor.execute(CpiEnvironment.DEV, HttpMethod.GET, PATH + "/$value", null, false);
        assertThat(response.getBody()).containsExactly(archive);
    }

    @Test
    @DisplayName("권한 없음(403, 예: WorkspacePackagesTransport 누락 가정)은 재시도 없이 실패로 보고된다")
    void forbiddenIsReportedWithoutRetry() {
        server.stubFor(get(urlEqualTo("/dev" + PATH)).willReturn(aResponse().withStatus(403)
                .withHeader("Content-Type", "application/json").withBody("{\"error\":\"Forbidden\"}")));
        assertThatThrownBy(() -> executor.execute(CpiEnvironment.DEV, HttpMethod.GET, PATH, null, true))
                .isInstanceOfSatisfying(CpiCallException.class, failure -> assertThat(failure.httpStatus()).isEqualTo(403));
        server.verify(1, getRequestedFor(urlEqualTo("/dev" + PATH)));
    }
}
