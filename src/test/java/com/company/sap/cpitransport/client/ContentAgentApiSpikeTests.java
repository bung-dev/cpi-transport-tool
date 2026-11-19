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
 * 탐색용(spike) 테스트: SAP Content Agent Service 공개 API(Business Accelerator Hub "contentagentapi" 1.0.1)를
 * 기존 CpiHttpExecutor로 부를 수 있는지 본다. 경로·본문 모양은 Hub OpenAPI 명세를 따랐고 값은 더미다.
 * CAS 호스트(content-agent-engine.cfapps.<region>)를 "테넌트 연결"처럼 등록했다고 가정한다.
 * 실제 서비스 동작을 증명하지 않는다(docs/research/content-agent-api.md 참고).
 */
class ContentAgentApiSpikeTests {
    private WireMockServer server;
    private CpiHttpExecutor executor;
    private final List<Duration> waits = new ArrayList<>();

    @BeforeEach
    void setUp() {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        server.start();
        server.stubFor(post(urlEqualTo("/uaa/oauth/token")).willReturn(okJson(
                "{\"access_token\":\"dummy-cas-token-0001\",\"expires_in\":3600}")));
        String base = "http://localhost:" + server.port();
        var connection = new CpiProperties.Connection(base + "/cas", base + "/uaa/oauth/token",
                "dummy-cas-client", "dummy-cas-secret");
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
    @DisplayName("조회 계열(GET)은 그대로 된다: 상태 조회와 내보낸 파일 다운로드")
    void readOperationsWork() {
        server.stubFor(get(urlEqualTo("/cas/v1/operations/dummy-activity-0001")).willReturn(okJson(
                "{\"activityId\":\"dummy-activity-0001\",\"operationType\":\"Export\",\"state\":\"FINISHED\",\"progress\":100}")));
        server.stubFor(get(urlEqualTo("/cas/v1/operations/dummy-activity-0001/config")).willReturn(okJson(
                "{\"activityID\":\"dummy-activity-0001\",\"fileID\":\"dummy-file-0001\"}")));
        byte[] mtar = {'P', 'K', 3, 4, 9, 9};
        server.stubFor(get(urlEqualTo("/cas/v1/operations/dummy-activity-0001/file/dummy-file-0001"))
                .willReturn(ok().withHeader("Content-Type", "application/octet-stream").withBody(mtar)));

        var status = executor.execute(CpiEnvironment.DEV, HttpMethod.GET, "/v1/operations/dummy-activity-0001", null, true);
        assertThat(new String(status.getBody(), StandardCharsets.UTF_8)).contains("\"state\":\"FINISHED\"");
        executor.execute(CpiEnvironment.DEV, HttpMethod.GET, "/v1/operations/dummy-activity-0001/config", null, true);
        var file = executor.execute(CpiEnvironment.DEV, HttpMethod.GET,
                "/v1/operations/dummy-activity-0001/file/dummy-file-0001", null, false);
        assertThat(file.getBody()).containsExactly(mtar);
        server.verify(3, anyRequestedFor(urlMatching("/cas/v1/operations/.*"))
                .withHeader("Authorization", equalTo("Bearer dummy-cas-token-0001")));
    }

    @Test
    @DisplayName("내보내기 POST는 현재 실행기로 실패한다: 쓰기 전에 CPI OData 루트(/api/v1/)에서 CSRF를 받으려 하기 때문")
    void exportPostFailsBecauseCsrfIsFetchedFromODataRoot() {
        server.stubFor(post(urlEqualTo("/cas/v1/contentResources/export")).willReturn(okJson(
                "{\"activityId\":\"dummy-activity-0001\",\"state\":\"INITIAL\"}")));
        server.stubFor(get(urlEqualTo("/cas/api/v1/")).willReturn(notFound()));
        String body = """
                {"id":"dummy-export-0001","exportMode":"Download","exportType":"Content","exportMediaType":"MTAR",
                 "contentResources":[{"resourceID":"dummy-guid","type":"CloudIntegration","subType":"IntegrationPackage",
                   "id":"DummyPackage","components":[{"id":"DummyFlow","type":"iflow","isExportable":true}]}]}
                """;
        assertThatThrownBy(() -> executor.execute(CpiEnvironment.DEV, HttpMethod.POST, "/v1/contentResources/export",
                body.getBytes(StandardCharsets.UTF_8), true))
                .isInstanceOfSatisfying(CpiCallException.class, failure -> assertThat(failure.httpStatus()).isEqualTo(404));
        server.verify(0, postRequestedFor(urlEqualTo("/cas/v1/contentResources/export")));
    }

    @Test
    @DisplayName("가져오기 V2의 파일 업로드는 multipart인데 실행기는 본문을 항상 application/json으로 보낸다")
    void importUploadNeedsMultipartWhichExecutorCannotSend() {
        server.stubFor(get(urlEqualTo("/cas/api/v1/")).willReturn(ok().withHeader("X-CSRF-Token", "dummy-csrf")));
        server.stubFor(post(urlEqualTo("/cas/v2/files/upload"))
                .withHeader("Content-Type", containing("multipart/form-data"))
                .willReturn(aResponse().withStatus(201).withHeader("Content-Type", "application/json")
                        .withBody("{\"fileId\":\"dummy-file-0002\",\"fileName\":\"dummy.mtar\"}")));
        server.stubFor(post(urlEqualTo("/cas/v2/files/upload"))
                .withHeader("Content-Type", containing("application/json")).atPriority(1)
                .willReturn(aResponse().withStatus(400).withHeader("Content-Type", "application/json")
                        .withBody("{\"error\":\"multipart expected\"}")));
        assertThatThrownBy(() -> executor.execute(CpiEnvironment.DEV, HttpMethod.POST, "/v2/files/upload",
                new byte[]{'P', 'K', 3, 4}, true))
                .isInstanceOfSatisfying(CpiCallException.class, failure -> assertThat(failure.httpStatus()).isEqualTo(400));
    }
}
