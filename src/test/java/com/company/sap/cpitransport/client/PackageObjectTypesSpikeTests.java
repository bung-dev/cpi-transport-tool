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
 * 탐색용(spike) 테스트: 패키지 안 iFlow 외 오브젝트(스크립트 컬렉션, 밸류 매핑, 메시지 매핑)와 패키지 통째 내려받기·가져오기를
 * 기존 CpiHttpExecutor로 부를 수 있는지 본다. 경로·본문 모양은 SAP 도움말(Integration Content)과 공개 도구(FlashPipe)를 따랐고
 * 값은 더미다. 실제 테넌트 동작을 증명하지 않는다(docs/research/package-object-types.md 참고).
 */
class PackageObjectTypesSpikeTests {
    private static final String ROOT = "/cpi/api/v1";
    private WireMockServer server;
    private CpiHttpExecutor executor;
    private final List<Duration> waits = new ArrayList<>();

    @BeforeEach
    void setUp() {
        server = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost"));
        server.start();
        server.stubFor(post(urlEqualTo("/oauth/token")).willReturn(okJson(
                "{\"access_token\":\"dummy-cpi-token-0001\",\"expires_in\":3600}")));
        server.stubFor(get(urlEqualTo(ROOT + "/")).withHeader("X-CSRF-Token", equalTo("Fetch"))
                .willReturn(ok().withHeader("X-CSRF-Token", "dummy-csrf-0001")));
        String base = "http://localhost:" + server.port();
        var connection = new CpiProperties.Connection(base + "/cpi", base + "/oauth/token",
                "dummy-client", "dummy-secret");
        var properties = new CpiProperties(connection, connection);
        var transport = new TransportProperties(new TransportProperties.History(null),
                new TransportProperties.Retry(1, Duration.ofSeconds(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(5), Duration.ofSeconds(300)), List.of());
        var provider = new OAuthTokenProvider(properties, transport,
                Clock.fixed(Instant.parse("2026-11-20T00:00:00Z"), ZoneOffset.UTC), waits::add);
        executor = new CpiHttpExecutor(properties, provider, new CsrfTokenStore(), transport, waits::add);
    }

    @AfterEach
    void tearDown() { server.stop(); }

    @Test
    @DisplayName("종류별 목록 조회(패키지 탐색 경로)는 기존 페이지 조회로 된다")
    void listOtherTypesThroughPackageNavigation() {
        for (String type : List.of("ScriptCollection", "ValueMapping", "MessageMapping")) {
            server.stubFor(get(urlEqualTo(ROOT + "/IntegrationPackages('DummyPkg')/" + type + "DesigntimeArtifacts"))
                    .willReturn(okJson("{\"d\":{\"results\":[{\"Id\":\"Dummy" + type
                            + "\",\"Name\":\"Dummy\",\"Version\":\"1.0.0\",\"PackageId\":\"DummyPkg\"}]}}")));
            var page = executor.executePage("DEV",
                    ROOT + "/IntegrationPackages('DummyPkg')/" + type + "DesigntimeArtifacts");
            assertThat(new String(page.getBody(), StandardCharsets.UTF_8)).contains("\"Id\":\"Dummy" + type + "\"");
        }
        server.verify(3, getRequestedFor(urlMatching(ROOT + "/IntegrationPackages\\('DummyPkg'\\)/.*"))
                .withHeader("Authorization", equalTo("Bearer dummy-cpi-token-0001")));
    }

    @Test
    @DisplayName("종류별 내려받기($value)는 iFlow와 같은 Accept로 바이너리를 그대로 받는다")
    void downloadOtherTypesAsZip() {
        byte[] zip = {'P', 'K', 3, 4, 7, 7};
        String path = ROOT + "/ScriptCollectionDesigntimeArtifacts(Id='DummyScripts',Version='active')/$value";
        server.stubFor(get(urlEqualTo(path)).willReturn(ok()
                .withHeader("Content-Type", "application/zip").withBody(zip)));
        var response = executor.execute("DEV", HttpMethod.GET, path.substring("/cpi".length()), null, false);
        assertThat(response.getBody()).containsExactly(zip);
        server.verify(getRequestedFor(urlEqualTo(path))
                .withHeader("Accept", equalTo("application/zip, application/octet-stream, */*")));
    }

    @Test
    @DisplayName("종류별 생성(POST, base64 본문)과 배포 함수 호출(POST)은 CSRF를 받아 그대로 된다")
    void createAndDeployOtherTypes() {
        server.stubFor(post(urlEqualTo(ROOT + "/ScriptCollectionDesigntimeArtifacts"))
                .withHeader("X-CSRF-Token", equalTo("dummy-csrf-0001"))
                .withHeader("Content-Type", containing("application/json"))
                .willReturn(aResponse().withStatus(201).withHeader("Content-Type", "application/json")
                        .withBody("{\"d\":{\"Id\":\"DummyScripts\",\"Version\":\"1.0.0\"}}")));
        server.stubFor(post(urlEqualTo(ROOT
                + "/DeployScriptCollectionDesigntimeArtifact?Id='DummyScripts'&Version='active'"))
                .withHeader("X-CSRF-Token", equalTo("dummy-csrf-0001"))
                .willReturn(aResponse().withStatus(202).withBody("dummy-task-0001")));
        String body = "{\"Name\":\"DummyScripts\",\"Id\":\"DummyScripts\",\"PackageId\":\"DummyPkg\","
                + "\"ArtifactContent\":\"UEsDBAcH\"}";

        executor.execute("DEV", HttpMethod.POST, "/api/v1/ScriptCollectionDesigntimeArtifacts",
                body.getBytes(StandardCharsets.UTF_8), true);
        var deploy = executor.execute("DEV", HttpMethod.POST,
                "/api/v1/DeployScriptCollectionDesigntimeArtifact?Id='DummyScripts'&Version='active'", null, true);

        assertThat(deploy.getStatusCode().value()).isEqualTo(202);
        server.verify(postRequestedFor(urlEqualTo(ROOT + "/ScriptCollectionDesigntimeArtifacts"))
                .withRequestBody(equalToJson(body)));
        server.verify(1, getRequestedFor(urlEqualTo(ROOT + "/")));
    }

    @Test
    @DisplayName("DELETE는 실행기가 CSRF 토큰을 붙이지 않아 실패한다(밸류 매핑 갱신 = 삭제 후 생성에 필요)")
    void deleteFailsBecauseExecutorSendsNoCsrfToken() {
        String path = ROOT + "/ValueMappingDesigntimeArtifacts(Id='DummyVm',Version='active')";
        server.stubFor(delete(urlEqualTo(path)).willReturn(aResponse().withStatus(403)
                .withHeader("X-CSRF-Token", "Required")));
        server.stubFor(delete(urlEqualTo(path)).withHeader("X-CSRF-Token", equalTo("dummy-csrf-0001"))
                .atPriority(1).willReturn(aResponse().withStatus(200)));

        assertThatThrownBy(() -> executor.execute("DEV", HttpMethod.DELETE, path.substring("/cpi".length()), null, true))
                .isInstanceOfSatisfying(CpiCallException.class, failure -> assertThat(failure.httpStatus()).isEqualTo(403));
        server.verify(1, deleteRequestedFor(urlEqualTo(path)).withoutHeader("X-CSRF-Token"));
        server.verify(0, getRequestedFor(urlEqualTo(ROOT + "/")));
    }

    @Test
    @DisplayName("밸류 매핑 $batch는 multipart/mixed인데 실행기는 본문을 항상 application/json으로 보낸다")
    void valueMappingBatchNeedsMultipartMixed() {
        server.stubFor(post(urlEqualTo(ROOT + "/$batch")).withHeader("Content-Type", containing("multipart/mixed"))
                .willReturn(aResponse().withStatus(202)));
        server.stubFor(post(urlEqualTo(ROOT + "/$batch")).withHeader("Content-Type", containing("application/json"))
                .atPriority(1).willReturn(aResponse().withStatus(400).withHeader("Content-Type", "application/json")
                        .withBody("{\"error\":\"multipart expected\"}")));
        String batch = "--batch\r\nContent-Type: application/http\r\n\r\nGET ValueMappingDesigntimeArtifacts HTTP/1.1\r\n\r\n--batch--";

        assertThatThrownBy(() -> executor.execute("DEV", HttpMethod.POST, "/api/v1/$batch",
                batch.getBytes(StandardCharsets.UTF_8), true))
                .isInstanceOfSatisfying(CpiCallException.class, failure -> assertThat(failure.httpStatus()).isEqualTo(400));
    }

    @Test
    @DisplayName("패키지 통째 내려받기($value)와 가져오기(POST PackageContent, Overwrite)는 기존 실행기로 된다")
    void wholePackageDownloadAndImport() {
        byte[] packageZip = {'P', 'K', 3, 4, 1, 2, 3};
        server.stubFor(get(urlEqualTo(ROOT + "/IntegrationPackages('DummyPkg')/$value"))
                .willReturn(ok().withHeader("Content-Type", "application/zip").withBody(packageZip)));
        server.stubFor(post(urlEqualTo(ROOT + "/IntegrationPackages?Overwrite=true"))
                .withHeader("X-CSRF-Token", equalTo("dummy-csrf-0001"))
                .willReturn(aResponse().withStatus(201).withHeader("Content-Type", "application/json")
                        .withBody("{\"d\":{\"Id\":\"DummyPkg\"}}")));

        byte[] downloaded = executor.execute("DEV", HttpMethod.GET, "/api/v1/IntegrationPackages('DummyPkg')/$value",
                null, false).getBody();
        String body = "{\"PackageContent\":\"" + java.util.Base64.getEncoder().encodeToString(downloaded) + "\"}";
        executor.execute("DEV", HttpMethod.POST, "/api/v1/IntegrationPackages?Overwrite=true",
                body.getBytes(StandardCharsets.UTF_8), true);

        assertThat(downloaded).containsExactly(packageZip);
        server.verify(postRequestedFor(urlEqualTo(ROOT + "/IntegrationPackages?Overwrite=true"))
                .withRequestBody(equalToJson("{\"PackageContent\":\"UEsDBAECAw==\"}")));
    }
}
