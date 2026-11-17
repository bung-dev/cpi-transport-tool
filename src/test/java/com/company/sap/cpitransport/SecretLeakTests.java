package com.company.sap.cpitransport;

import com.company.sap.cpitransport.stub.LocalCpiStubs;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.model.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.dataformat.yaml.YAMLMapper;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static com.github.tomakehurst.wiremock.client.WireMock.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = {com.company.sap.cpitransport.CpiTransportToolApplication.class, SecretLeakTests.TimeConfig.class})
@ExtendWith(OutputCaptureExtension.class)
class SecretLeakTests {
    @TempDir static Path temporary;
    static LocalCpiStubs stubs;
    @LocalServerPort int port;
    static final JsonMapper JSON = new JsonMapper();

    @TestConfiguration(proxyBeanMethods = false)
    static class TimeConfig {
        @Bean @Primary Clock testClock() { return Clock.fixed(Instant.parse("2026-09-29T00:00:00Z"), ZoneOffset.UTC); }
        @Bean @Primary Sleeper testSleeper() { return duration -> {}; }
    }
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) throws Exception {
        registry.add("cpi.transport.read-only", () -> "false");
        stubs = new LocalCpiStubs(temporary.resolve("dev-zips"));
        stubs.start(0, 0);
        for (String env : List.of("dev", "prd")) {
            String base = "http://localhost:" + (env.equals("dev") ? stubs.dev().port() : stubs.prd().port());
            String prefix = "cpi.environments." + env + ".";
            registry.add(prefix + "api-url", () -> base);
            registry.add(prefix + "token-url", () -> base + "/oauth/token");
            registry.add(prefix + "client-id", () -> "dummy-" + env + "-client");
            registry.add(prefix + "client-secret", () -> "dummy-" + env + "-secret");
        }
        registry.add("cpi.transport.history.file", () -> temporary.resolve("history.jsonl").toString());
    }
    private ch.qos.logback.core.FileAppender<ch.qos.logback.classic.spi.ILoggingEvent> fileLog;
    private ch.qos.logback.classic.Logger rootLogger;

    @BeforeEach void captureFile() {
        var context = (ch.qos.logback.classic.LoggerContext) org.slf4j.LoggerFactory.getILoggerFactory();
        var encoder = new ch.qos.logback.classic.encoder.PatternLayoutEncoder();
        encoder.setContext(context);
        encoder.setPattern("%level transportId=%X{transportId} artifactId=%X{artifactId} %msg%n");
        encoder.start();
        fileLog = new ch.qos.logback.core.FileAppender<>();
        fileLog.setContext(context);
        fileLog.setFile(temporary.resolve("application.log").toString());
        fileLog.setEncoder(encoder);
        fileLog.start();
        rootLogger = context.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        rootLogger.addAppender(fileLog);
    }

    @AfterEach void closeFile() {
        rootLogger.detachAppender(fileLog);
        fileLog.stop();
    }

    @AfterAll static void stop() { if (stubs != null) stubs.stop(); }

    @org.springframework.beans.factory.annotation.Autowired
    com.company.sap.cpitransport.service.TransportService service;

    @Test
    @DisplayName("REQ-013 AC-3: artifact MDC is present and caller context is restored after failure")
    void req013_ac3_mdcRestored() throws Exception {
        org.slf4j.MDC.put("transportId", "caller");
        org.slf4j.MDC.put("artifactId", "caller-artifact");
        try {
            var request = new TransportRequest("PkgTransportDemo", List.of("missing"), true, false);
            var response = service.execute(request, List.of());
            assertThat(response.summary().failed()).isEqualTo(1);
            assertThat(org.slf4j.MDC.get("transportId")).isEqualTo("caller");
            assertThat(org.slf4j.MDC.get("artifactId")).isEqualTo("caller-artifact");
            assertThat(Files.readString(temporary.resolve("application.log"))).contains(
                    "INFO transportId=" + response.transportId() + " artifactId=missing transportId=" + response.transportId());
        } finally {
            org.slf4j.MDC.clear();
        }
    }

    // 자격증명·토큰과 번들 안 값은 어떤 출력에도 나오지 않는다.
    private static final String[] SECRETS = {
            "dummy-dev-secret", "dummy-prd-secret", "dummy-dev-token-0001", "dummy-prd-token-0001",
            "dummy-dev-apikey-123", "dummy-prd-apikey-456", "dummy-prd-pass-UVW"
    };
    // REQ-505: 구성 값의 값(민감 키 포함)은 응답·이력에는 평문으로 남지만 로그에는 남지 않는다.
    private static final String[] CONFIGURATION_VALUES = {
            "dummy-dev-pass-XYZ", "http://dev-receiver.localhost/customers", "http://dev-backend.localhost/orders"
    };

    private String transport(boolean dryRun, String packageId, List<String> ids) throws Exception {
        var body = JSON.writeValueAsString(Map.of("packageId", packageId, "artifactIds", ids,
                "dryRun", dryRun, "deploy", true));
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/transport"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return response.body();
    }

    private void noLeaks(CapturedOutput output, String response) throws Exception {
        assertThat(output.getAll()).doesNotContain(SECRETS).doesNotContain(CONFIGURATION_VALUES);
        assertThat(Files.readString(temporary.resolve("application.log"))).doesNotContain(SECRETS).doesNotContain(CONFIGURATION_VALUES);
        assertThat(response).doesNotContain(SECRETS);
        assertThat(Files.readString(temporary.resolve("history.jsonl"))).doesNotContain(SECRETS);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    @DisplayName("REQ-002 AC-6, REQ-504, REQ-505, REQ-013 AC-3: credentials stay out of every output, configuration values stay out of logs but are plain in response and history, and every step is logged")
    void req505_allOutputChannels(boolean dryRun, CapturedOutput output) throws Exception {
        String body = transport(dryRun, "PkgTransportDemo", List.of("IF_Order_Sync", "IF_Customer_Push"));
        var response = JSON.readValue(body, TransportResponse.class);
        assertThat(response.summary().succeeded()).isEqualTo(2);
        var customer = response.results().stream().filter(r -> r.artifactId().equals("IF_Customer_Push")).findFirst().orElseThrow();
        assertThat(customer.configurations()).filteredOn(c -> c.key().equals("ClientPassword"))
                .extracting(ConfigurationItem::value).containsExactly("dummy-dev-pass-XYZ");
        assertThat(body).contains("dummy-dev-pass-XYZ");
        assertThat(Files.readString(temporary.resolve("history.jsonl"))).contains("dummy-dev-pass-XYZ");
        for (var artifact : response.results()) {
            String prefix = "transportId=" + response.transportId() + " artifactId=" + artifact.artifactId();
            for (String step : List.of("DOWNLOAD", "UPLOAD", "PARAMETER_COPY", "DEPLOY")) {
                assertThat(output.getOut()).contains(prefix + " step=" + step + " phase=START");
                String result = dryRun && Set.of("UPLOAD", "DEPLOY").contains(step) ? "SKIPPED_DRY_RUN" : "OK";
                assertThat(output.getOut()).contains(prefix + " step=" + step + " phase=END result=" + result);
            }
        }
        assertThat(output.getOut()).doesNotContain("step=REPLACE ", "step=PARAMETER_REPLACE");
        noLeaks(output, body);
    }

    @Test
    @DisplayName("REQ-013 AC-3, REQ-002 AC-6, REQ-505: failed stages log categorical results without echoed secrets or configuration values and continue")
    void req013_ac3_failedStages(CapturedOutput output) throws Exception {
        String download = "/api/v1/IntegrationDesigntimeArtifacts(Id='IF_Fault_Download500',Version='active')/$value";
        stubs.dev().stubFor(get(urlEqualTo(download)).atPriority(1)
                .willReturn(aResponse().withStatus(500).withBody(String.join(" ", SECRETS))));
        var ids = List.of("IF_Fault_Download500", "IF_Fault_UploadFail", "IF_Fault_ParamPutFail", "IF_Fault_DeployError", "IF_Fault_A");
        String body = transport(false, "PkgFaultDemo", ids);
        var response = JSON.readValue(body, TransportResponse.class);
        assertThat(response.summary().failed()).isEqualTo(4);
        assertThat(response.summary().succeeded()).isEqualTo(1);
        for (int i = 0; i < 4; i++) {
            String step = List.of("DOWNLOAD", "UPLOAD", "PARAMETER_COPY", "DEPLOY").get(i);
            assertThat(output.getOut()).contains("transportId=" + response.transportId() + " artifactId=" + ids.get(i)
                    + " step=" + step + " phase=END result=FAILED");
        }
        assertThat(output.getAll()).doesNotContain("a-dev", "b-dev");
        noLeaks(output, body);
    }
}
