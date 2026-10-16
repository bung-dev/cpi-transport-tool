package com.company.sap.cpitransport.client;

import java.net.URI;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.CpiPackage;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;

@ExtendWith(OutputCaptureExtension.class)
class CpiApiClientPagingWireMockTests {
    private static final String PACKAGES = "/api/v1/IntegrationPackages";
    private static final String TOKEN = "test-dummy-page-token";
    private final JsonMapper json = new JsonMapper();
    @TempDir Path directory;
    private WireMockServer server;
    private CpiApiClient api;

    @BeforeEach void setUp() {
        server = new WireMockServer(wireMockConfig().dynamicPort());
        server.start();
        server.stubFor(post(urlEqualTo("/token")).willReturn(okJson(
                json.writeValueAsString(Map.of("access_token", TOKEN, "expires_in", 3600)))));
        api = client(server.baseUrl());
    }

    private CpiApiClient client(String base) {
        var connection = new CpiProperties.Connection(base, server.baseUrl() + "/token",
                "test-dummy-page-client", "test-dummy-page-secret");
        var properties = new CpiProperties(connection, connection);
        var settings = new TransportProperties("", new TransportProperties.History(directory.resolve("history.jsonl")),
                new TransportProperties.Retry(1, Duration.ZERO),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of());
        Sleeper sleeper = duration -> { throw new AssertionError("Unexpected retry"); };
        var tokens = new OAuthTokenProvider(properties, settings, Clock.systemUTC(), sleeper);
        return new CpiApiClient(new CpiHttpExecutor(properties, tokens, new CsrfTokenStore(), settings, sleeper), json);
    }

    @AfterEach void stop() { if (server != null) server.stop(); }

    private Map<String, Object> item(String id) {
        return Map.of("Id", id, "Name", "한글 공백 \"이름\" & 설명", "Version", "1",
                "Description", "설명 & \"따옴표\"", "__metadata", Map.of("uri", server.baseUrl() + "/unused"),
                "Extra", Map.of("__deferred", Map.of("uri", server.baseUrl() + "/never-follow")));
    }

    private void page(String path, List<?> items, String next) {
        var data = json.createObjectNode();
        data.set("results", json.valueToTree(items));
        if (next != null) data.put("__next", next);
        server.stubFor(get(urlEqualTo(path)).willReturn(okJson(json.writeValueAsString(Map.of("d", data)))));
    }

    private void invalid(Runnable operation) {
        assertThatThrownBy(operation::run).isInstanceOf(CpiCallException.class)
                .hasMessage("Invalid CPI OData response").hasNoCause();
    }

    @ParameterizedTest(name = "REQ-304 AC-1·AC-2·AC-5: relative and absolute links {0}")
    @ValueSource(strings = {"relative", "root", "absolute", "query"})
    @DisplayName("REQ-304 AC-1·AC-2·AC-5: merge pages and preserve raw query and JSON Accept")
    void req304_ac1_links(String kind) {
        String second = PACKAGES + "?$skiptoken=a%2Bb%26c%3D%27%ED%95%9C&$top=2";
        String next = switch (kind) {
            case "relative" -> "IntegrationPackages" + second.substring(PACKAGES.length());
            case "root" -> second;
            case "absolute" -> server.baseUrl() + second;
            default -> second.substring(PACKAGES.length());
        };
        page(PACKAGES, List.of(item("First")), next);
        page(second, List.of(item("Second")), null);
        assertThat(api.listPackages("DEV")).extracting(CpiPackage::id).containsExactly("First", "Second");
        for (String path : List.of(PACKAGES, second)) {
            server.verify(1, getRequestedFor(urlEqualTo(path))
                    .withHeader("Accept", equalTo("application/json"))
                    .withHeader("Authorization", equalTo("Bearer " + TOKEN)));
        }
        server.verify(2, getRequestedFor(anyUrl()));
    }

    @Test @DisplayName("REQ-304 AC-1·AC-5: root links use origin and later links use the current page directory")
    void req304_ac1_basePathAndCurrentPage() {
        api = client(server.baseUrl() + "/tenant/");
        page("/tenant" + PACKAGES, List.of(item("First")), "/pages/second");
        page("/pages/second", List.of(item("Second")), "third?raw=%2F%26");
        page("/pages/third?raw=%2F%26", List.of(item("Third")), null);
        assertThat(api.listPackages("DEV")).extracting(CpiPackage::id).containsExactly("First", "Second", "Third");
        server.verify(3, getRequestedFor(anyUrl()).withHeader("Accept", equalTo("application/json")));
    }

    @Test @DisplayName("REQ-304 AC-1·AC-5: RFC path resolution preserves empty segments and removes dot segments")
    void req304_ac1_rfcPaths() {
        var base = URI.create("https://api.localhost");
        var current = URI.create("https://api.localhost/a/b/list?old=1");
        assertThat(CpiApiClient.nextPage(base, current, "../../../../next?q=%2F").getRawPath()).isEqualTo("/next");
        assertThat(CpiApiClient.nextPage(base, current, "/a//b/./c/../next").getRawPath()).isEqualTo("/a//b/next");
        assertThat(CpiApiClient.nextPage(base, current, "?raw=%2B").toString())
                .isEqualTo("https://api.localhost/a/b/list?raw=%2B");
    }

    @Test @DisplayName("REQ-304 AC-1·AC-5: omitted HTTPS port and explicit 443 are the same origin")
    void req304_ac1_defaultPort() {
        var base = URI.create("https://api.localhost");
        var current = URI.create("https://api.localhost" + PACKAGES);
        assertThat(CpiApiClient.nextPage(base, current, "https://API.localhost:443/next?q=%2B").toString())
                .isEqualTo("https://API.localhost:443/next?q=%2B");
        assertThat(CpiApiClient.nextPage(URI.create("https://api.localhost:443"), current,
                "https://api.localhost/next").toString()).isEqualTo("https://api.localhost/next");
    }

    @ParameterizedTest(name = "REQ-304 AC-1·AC-5 / REQ-305 AC-3: reject unsafe page {0}")
    @ValueSource(strings = {"host", "port", "scheme", "network", "malformed", "opaque", "userinfo", "fragment"})
    @DisplayName("REQ-304 AC-1·AC-5 / REQ-305 AC-3: reject unsafe links without requests or leaked diagnostics")
    void req304_ac1_unsafe(String kind, CapturedOutput output) {
        var other = new WireMockServer(wireMockConfig().dynamicPort());
        other.start();
        try {
            String next = switch (kind) {
                case "host" -> server.baseUrl().replace("localhost", "127.0.0.1") + "/private";
                case "port" -> other.baseUrl() + "/private";
                case "scheme" -> server.baseUrl().replace("http:", "https:") + "/private";
                case "network" -> "//localhost:" + other.port() + "/private";
                case "malformed" -> "/private?bad=%zz";
                case "opaque" -> "http:private";
                case "userinfo" -> "http://test-dummy-user@localhost:" + server.port() + "/private";
                default -> "/private#fragment";
            };
            page(PACKAGES, List.of(), next);
            invalid(() -> api.listPackages("DEV"));
            server.verify(1, getRequestedFor(anyUrl()));
            assertThat(other.getAllServeEvents()).isEmpty();
            assertThat(output.getAll()).doesNotContain(next, TOKEN, "test-dummy-page-secret");
        } finally { other.stop(); }
    }

    @ParameterizedTest(name = "REQ-304 AC-1·AC-5: page limit with continuation {0}")
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-304 AC-1·AC-5: accept 50 pages but never request page 51")
    void req304_ac1_limit(boolean continuation) {
        for (int page = 1; page <= 50; page++) {
            String path = page == 1 ? PACKAGES : PACKAGES + "?page=" + page;
            page(path, List.of(item("Page" + page)), page < 50 || continuation ? "?page=" + (page + 1) : null);
        }
        if (continuation) invalid(() -> api.listPackages("DEV"));
        else assertThat(api.listPackages("DEV")).hasSize(50).last().extracting(CpiPackage::id).isEqualTo("Page50");
        server.verify(50, getRequestedFor(anyUrl()));
        server.verify(0, getRequestedFor(urlEqualTo(PACKAGES + "?page=51")));
    }

    @Test @DisplayName("REQ-304 AC-1·AC-2·AC-5: artifact and configuration collections also merge pages")
    void req304_ac1_otherCollections() {
        String artifacts = "/api/v1/IntegrationPackages('Pkg')/IntegrationDesigntimeArtifacts";
        String configs = "/api/v1/IntegrationDesigntimeArtifacts(Id='Flow',Version='active')/Configurations";
        page(artifacts, List.of(item("Flow")), "?page=2");
        page(artifacts + "?page=2", List.of(item("Other")), null);
        page(configs, List.of(Map.of("ParameterKey", "A", "ParameterValue", "가 & 나", "DataType", "xsd:string")), "?page=2");
        page(configs + "?page=2", List.of(Map.of("ParameterKey", "B", "ParameterValue", "\"값\"", "DataType", "xsd:string")), null);
        assertThat(api.listArtifacts("DEV", "Pkg")).extracting(a -> a.id()).containsExactly("Flow", "Other");
        assertThat(api.getConfigurations("DEV", "Flow")).extracting(c -> c.parameterKey()).containsExactly("A", "B");
        server.verify(4, getRequestedFor(anyUrl()).withHeader("Accept", equalTo("application/json")));
    }

    @ParameterizedTest(name = "REQ-304 AC-2·AC-5: malformed used fields {0}")
    @ValueSource(strings = {"{}", "{\"Id\":1,\"Name\":\"N\",\"Version\":\"1\"}",
            "{\"Id\":\"I\",\"Name\":null,\"Version\":\"1\"}", "{\"Id\":\"I\",\"Name\":\"N\",\"Version\":{}}"})
    @DisplayName("REQ-304 AC-2·AC-5: reject missing or non-string fields on subsequent pages")
    void req304_ac2_fields(String value) {
        page(PACKAGES, List.of(item("First")), "?page=2");
        server.stubFor(get(urlEqualTo(PACKAGES + "?page=2"))
                .willReturn(okJson("{\"d\":{\"results\":[" + value + "]}}")));
        invalid(() -> api.listPackages("DEV"));
    }

    @ParameterizedTest(name = "REQ-304 AC-4·AC-5 / REQ-305 AC-3: non-JSON status {0}")
    @ValueSource(ints = {200, 400, 503})
    @DisplayName("REQ-304 AC-4·AC-5 / REQ-305 AC-3: HTML is absent from exception and logs for successful and failed HTTP")
    void req304_ac4_html(int status, CapturedOutput output) {
        String body = "<html>test-dummy-login-page " + TOKEN + " test-dummy-page-secret</html>";
        server.stubFor(get(urlEqualTo(PACKAGES)).willReturn(aResponse().withStatus(status)
                .withHeader("Content-Type", "text/html").withBody(body)));
        invalid(() -> api.listPackages("DEV"));
        assertThat(output.getAll()).doesNotContain(body, "test-dummy-login-page", TOKEN, "test-dummy-page-secret");
    }

    @ParameterizedTest(name = "REQ-304 AC-4·AC-5: declared non-JSON type {0}")
    @ValueSource(strings = {"text/plain", "application/json"})
    @DisplayName("REQ-304 AC-4·AC-5: invalid declared bodies do not become error summaries")
    void req304_ac4_declaredBody(String type) {
        server.stubFor(get(urlEqualTo(PACKAGES)).willReturn(aResponse().withStatus(400)
                .withHeader("Content-Type", type).withBody("test-dummy-private-non-json")));
        invalid(() -> api.listPackages("DEV"));
    }

    @Test @DisplayName("REQ-304 AC-4·AC-5: HTML without Content-Type never uses the legacy plain-text summary")
    void req304_ac4_untypedHtml() {
        server.stubFor(get(urlEqualTo(PACKAGES)).willReturn(aResponse().withStatus(400)
                .withBody(" \n<html>test-dummy-untyped-login</html>")));
        invalid(() -> api.listPackages("DEV"));
    }
}
