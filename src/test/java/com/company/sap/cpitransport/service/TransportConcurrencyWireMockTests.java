package com.company.sap.cpitransport.service;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.company.sap.cpitransport.client.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.model.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.stubbing.Scenario;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.Supplier;
import java.util.zip.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.*;

/**
 * 20261119-transport-speedup S2: REQ-703 미리보기 iFlow 동시 처리, REQ-704 실제 이관 iFlow 동시 처리.
 * iFlow 하나의 처리 구간(내려받기 시작 ~ 미리보기는 원본 구성 값 읽기 끝, 실제 이관은 업로드 끝)을 세어
 * 동시에 진행 중인 iFlow 수를 잰다. 내려받기마다 잠깐 지연을 넣어 겹침이 생기게 한다.
 */
@Timeout(60)
class TransportConcurrencyWireMockTests {
    private static final String PACKAGES = "/api/v1/IntegrationPackages";
    private static final String COLLECTION = "/api/v1/IntegrationDesigntimeArtifacts";
    private static final TenantRef DEV = new TenantRef("DEV", "DEV");
    private static final TenantRef PRD = new TenantRef("PRD", "PRD");
    private static final List<String> P1 = List.of("A1", "A2", "A3", "A4", "A5");
    private static final List<String> P2 = List.of("B1", "B2", "B3");
    private WireMockServer dev, prd;
    private CountingApi api;
    private TransportProperties settings;
    private final AtomicReference<ConcurrencySettings> concurrency = new AtomicReference<>(new ConcurrencySettings(4, 4));
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-19T00:00:00Z"), ZoneOffset.UTC);
    private final JsonMapper json = JsonMapper.builder().build();
    @TempDir Path temporary;

    /** Counts iFlows in flight and records the order downloads start. */
    static class CountingApi extends CpiApiClient {
        final AtomicInteger inFlight = new AtomicInteger();
        final AtomicInteger maxInFlight = new AtomicInteger();
        final List<String> downloadOrder = Collections.synchronizedList(new ArrayList<>());
        final Map<String, Long> delays = new ConcurrentHashMap<>();
        volatile Runnable onFirstDownload = () -> {};
        private final AtomicBoolean first = new AtomicBoolean(true);
        private final Set<String> open = ConcurrentHashMap.newKeySet();

        CountingApi(CpiHttpExecutor http, JsonMapper json) { super(http, json); }

        private void enter(String id) {
            if (open.add(id)) maxInFlight.accumulateAndGet(inFlight.incrementAndGet(), Math::max);
        }
        private void leave(String id) {
            if (open.remove(id)) inFlight.decrementAndGet();
        }
        @Override public byte[] downloadArtifact(String environment, String id) {
            enter(id);
            downloadOrder.add(id);
            if (first.compareAndSet(true, false)) onFirstDownload.run();
            try {
                Thread.sleep(delays.getOrDefault(id, 150L));
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            try {
                return super.downloadArtifact(environment, id);
            } catch (RuntimeException failure) {
                leave(id);
                throw failure;
            }
        }
        @Override public List<CpiConfiguration> getConfigurations(String environment, String id) {
            try {
                return super.getConfigurations(environment, id);
            } finally {
                if (environment.equals("DEV") && previewMode) leave(id);
            }
        }
        @Override public void createArtifact(String environment, String name, String id, String packageId, String base64) {
            try { super.createArtifact(environment, name, id, packageId, base64); } finally { leave(id); }
        }
        @Override public void updateArtifact(String environment, String id, String name, String base64) {
            try { super.updateArtifact(environment, id, name, base64); } finally { leave(id); }
        }
        volatile boolean previewMode;
    }

    @BeforeEach
    void setUp() throws Exception {
        dev = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost").containerThreads(40));
        prd = new WireMockServer(wireMockConfig().dynamicPort().bindAddress("localhost").containerThreads(40));
        dev.start();
        prd.start();
        settings = new TransportProperties(new TransportProperties.History(temporary.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofMillis(1)),
                new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)), List.of("password"));
        var connections = new CpiProperties(connection(dev, "dev"), connection(prd, "prd"));
        Sleeper sleeper = duration -> {};
        var tokens = new OAuthTokenProvider(connections, settings, clock, sleeper);
        api = new CountingApi(new CpiHttpExecutor(connections, tokens, new CsrfTokenStore(), settings, sleeper), json);
        dev.stubFor(post(urlEqualTo("/token")).willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(post(urlEqualTo("/token")).willReturn(okJson("{\"access_token\":\"dummy-prd-token-0001\",\"expires_in\":3600}")));
        prd.stubFor(get(urlEqualTo("/api/v1/")).willReturn(ok().withHeader("X-CSRF-Token", "dummy-prd-csrf-0001")));
        packageMetadata(dev, "P1"); packageMetadata(dev, "P2");
        artifacts("P1", P1); artifacts("P2", P2);
        // P1 exists in the target, P2 is created when approved.
        packageMetadata(prd, "P1");
        prd.stubFor(get(urlEqualTo(pkg("P2"))).willReturn(notFound()));
        prd.stubFor(post(urlEqualTo(PACKAGES)).willReturn(created()));
        prd.stubFor(post(urlEqualTo(COLLECTION)).willReturn(created()));
        for (String id : all()) {
            dev.stubFor(get(urlEqualTo(path(id) + "/$value")).willReturn(ok().withBody(zip(id))));
            dev.stubFor(get(urlEqualTo(path(id) + "/Configurations")).willReturn(okJson(
                    "{\"d\":{\"results\":[{\"ParameterKey\":\"Key\",\"ParameterValue\":\"" + id + "\",\"DataType\":\"xsd:string\"}]}}")));
            prd.stubFor(get(urlEqualTo(path(id))).willReturn(notFound()));
        }
    }

    @AfterEach void tearDown() { if (dev != null) dev.stop(); if (prd != null) prd.stop(); }

    private TransportService service() {
        Supplier<ConcurrencySettings> current = concurrency::get;
        return new TransportService(api, new ConfigurationCopier(api, new SensitiveKeyMatcher(settings)),
                new DeployService(api, settings, clock, duration -> {}), clock, current);
    }

    private TransportResponse run(boolean dryRun) {
        api.previewMode = dryRun;
        return service().preflightAndExecute(new TransportRequest(
                List.of(new PackageSelection("P1", null), new PackageSelection("P2", null)), List.of("P2"), dryRun, false, DEV, PRD));
    }

    // ---- REQ-703 미리보기 ----

    @ParameterizedTest(name = "{displayName} [P={0}]")
    @ValueSource(ints = {2, 3})
    @DisplayName("REQ-703: preview processes up to P iFlows at once, never more, keeps request order and sends nothing to the target")
    void req703_previewLimit(int limit) {
        concurrency.set(new ConcurrencySettings(limit, 8));
        var response = run(true);
        assertThat(api.maxInFlight.get()).isEqualTo(limit);
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactlyElementsOf(all());
        assertThat(response.results()).extracting(ArtifactResult::packageId)
                .containsExactly("P1", "P1", "P1", "P1", "P1", "P2", "P2", "P2");
        assertThat(response.results()).allSatisfy(r -> {
            assertThat(r.status()).isEqualTo(ArtifactStatus.SUCCESS);
            assertThat(r.configurations()).singleElement().satisfies(c -> {
                assertThat(c.value()).isEqualTo(r.artifactId());
                assertThat(c.status()).isEqualTo(ConfigurationStatus.PLANNED);
            });
        });
        assertThat(response.summary()).isEqualTo(new TransportSummary(8, 8, 0));
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    @Test
    @DisplayName("REQ-703: preview keeps request order when earlier iFlows finish last")
    void req703_previewOrder() {
        concurrency.set(new ConcurrencySettings(4, 1));
        api.delays.put("A1", 600L);
        api.delays.put("A2", 400L);
        var response = run(true);
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactlyElementsOf(all());
        assertThat(api.maxInFlight.get()).isGreaterThan(1);
    }

    @Test
    @DisplayName("REQ-703: P=1 processes iFlows one at a time in request order")
    void req703_previewSequential() {
        concurrency.set(new ConcurrencySettings(1, 8));
        var response = run(true);
        assertThat(api.maxInFlight.get()).isEqualTo(1);
        assertThat(api.downloadOrder).containsExactlyElementsOf(all());
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactlyElementsOf(all());
    }

    @Test
    @DisplayName("REQ-703: a failing iFlow does not stop the others and 429 is retried per iFlow")
    void req703_previewIsolationAndRetry() {
        concurrency.set(new ConcurrencySettings(4, 1));
        dev.stubFor(get(urlEqualTo(path("A2") + "/$value")).willReturn(serverError()));
        dev.stubFor(get(urlEqualTo(path("B1") + "/$value")).inScenario("b1").whenScenarioStateIs(Scenario.STARTED)
                .willSetStateTo("retried").willReturn(aResponse().withStatus(429)));
        dev.stubFor(get(urlEqualTo(path("B1") + "/$value")).inScenario("b1").whenScenarioStateIs("retried")
                .willReturn(ok().withBody(zipUnchecked("B1"))));
        dev.stubFor(get(urlEqualTo(path("A4") + "/Configurations")).willReturn(serverError()));
        var response = run(true);
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactlyElementsOf(all());
        var byId = byId(response);
        assertThat(byId.get("A2").error().code()).isEqualTo("DOWNLOAD_FAILED");
        assertThat(byId.get("A4").error().code()).isEqualTo("CONFIGURATION_READ_FAILED");
        assertThat(byId.get("B1").status()).isEqualTo(ArtifactStatus.SUCCESS);
        assertThat(response.summary()).isEqualTo(new TransportSummary(8, 6, 2));
        dev.verify(3, getRequestedFor(urlEqualTo(path("A2") + "/$value")));
        dev.verify(2, getRequestedFor(urlEqualTo(path("B1") + "/$value")));
        assertThat(prd.getAllServeEvents()).isEmpty();
    }

    // ---- REQ-704 실제 이관 ----

    @ParameterizedTest(name = "{displayName} [T={0}]")
    @ValueSource(ints = {2, 3})
    @DisplayName("REQ-704: real transport creates packages first, then processes up to T iFlows at once across packages in request order")
    void req704_transportLimit(int limit) {
        concurrency.set(new ConcurrencySettings(8, limit));
        var response = run(false);
        assertThat(api.maxInFlight.get()).isEqualTo(limit);
        assertThat(response.packages()).extracting(TransportPackage::packageId, TransportPackage::targetPackage).containsExactly(
                tuple("P1", TargetPackageStatus.EXISTING), tuple("P2", TargetPackageStatus.CREATED));
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactlyElementsOf(all());
        assertThat(response.results()).allSatisfy(r -> {
            assertThat(r.status()).isEqualTo(ArtifactStatus.SUCCESS);
            assertThat(r.action()).isEqualTo(TransportAction.CREATED);
            assertThat(r.configurations()).extracting(ConfigurationItem::status).containsExactly(ConfigurationStatus.BUNDLED);
        });
        assertThat(response.summary()).isEqualTo(new TransportSummary(8, 8, 0));
        // The package is created once, before any iFlow upload, and each package is checked once.
        prd.verify(1, postRequestedFor(urlEqualTo(PACKAGES)));
        prd.verify(1, getRequestedFor(urlEqualTo(pkg("P1"))));
        prd.verify(1, getRequestedFor(urlEqualTo(pkg("P2"))));
        var events = new ArrayList<>(prd.getAllServeEvents());
        events.sort(Comparator.comparing(e -> e.getRequest().getLoggedDate()));
        var urls = events.stream().map(e -> e.getRequest().getMethod().getName() + " " + e.getRequest().getUrl()).toList();
        int created = urls.indexOf("POST " + PACKAGES);
        assertThat(created).isNotNegative();
        assertThat(urls.indexOf("GET " + pkg("P1"))).isLessThan(urls.indexOf("GET " + pkg("P2")));
        assertThat(urls.subList(0, created)).noneMatch(u -> u.equals("POST " + COLLECTION));
        var uploads = prd.findAll(postRequestedFor(urlEqualTo(COLLECTION)));
        assertThat(uploads).extracting(r -> json.readTree(r.getBodyAsString()).path("Id").asString())
                .containsExactlyInAnyOrderElementsOf(all());
        assertThat(uploads).allSatisfy(r -> {
            var body = json.readTree(r.getBodyAsString());
            assertThat(body.path("PackageId").asString()).isEqualTo(body.path("Id").asString().startsWith("A") ? "P1" : "P2");
        });
    }

    @Test
    @DisplayName("REQ-704: T=1 processes iFlows one at a time in request order")
    void req704_transportSequential() {
        concurrency.set(new ConcurrencySettings(8, 1));
        var response = run(false);
        assertThat(api.maxInFlight.get()).isEqualTo(1);
        assertThat(api.downloadOrder).containsExactlyElementsOf(all());
        assertThat(response.summary()).isEqualTo(new TransportSummary(8, 8, 0));
    }

    @Test
    @DisplayName("REQ-704: preview and real transport each use their own setting")
    void req704_separateSettings() {
        concurrency.set(new ConcurrencySettings(1, 3));
        run(true);
        assertThat(api.maxInFlight.get()).isEqualTo(1);
        api.maxInFlight.set(0);
        run(false);
        assertThat(api.maxInFlight.get()).isEqualTo(3);
    }

    @ParameterizedTest(name = "{displayName} [{0}]")
    @ValueSource(strings = {"CREATE_FAILED", "NOT_FOUND", "CHECK_FAILED"})
    @DisplayName("REQ-704: iFlows of a package whose target package is unusable fail with that package error and nothing is written for them")
    void req704_packageError(String state) {
        concurrency.set(new ConcurrencySettings(8, 4));
        String code = switch (state) {
            case "CREATE_FAILED" -> {
                // 400 is not retried, so the single create request stays countable.
                prd.stubFor(post(urlEqualTo(PACKAGES)).willReturn(badRequest()));
                yield "PACKAGE_CREATE_FAILED";
            }
            case "NOT_FOUND" -> "PACKAGE_NOT_FOUND_IN_TARGET";
            default -> {
                prd.stubFor(get(urlEqualTo(pkg("P2"))).willReturn(serverError()));
                yield "TARGET_CHECK_FAILED";
            }
        };
        api.previewMode = false;
        var response = service().preflightAndExecute(new TransportRequest(
                List.of(new PackageSelection("P1", null), new PackageSelection("P2", null)),
                state.equals("NOT_FOUND") ? List.of() : List.of("P2"), false, false, DEV, PRD));
        assertThat(response.packages().get(1).targetPackage()).isEqualTo(TargetPackageStatus.valueOf(state));
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactlyElementsOf(all());
        assertThat(response.results().subList(0, 5)).allSatisfy(r -> assertThat(r.status()).isEqualTo(ArtifactStatus.SUCCESS));
        assertThat(response.results().subList(5, 8)).allSatisfy(r -> {
            assertThat(r.status()).isEqualTo(ArtifactStatus.FAILED);
            assertThat(r.error().code()).isEqualTo(code);
            assertThat(r.action()).isEqualTo(TransportAction.NONE);
        });
        assertThat(response.summary()).isEqualTo(new TransportSummary(8, 5, 3));
        for (String id : P2) {
            prd.verify(0, postRequestedFor(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo(id))));
            prd.verify(0, getRequestedFor(urlEqualTo(path(id))));
        }
        prd.verify(state.equals("NOT_FOUND") || state.equals("CHECK_FAILED") ? 0 : 1, postRequestedFor(urlEqualTo(PACKAGES)));
    }

    @Test
    @DisplayName("REQ-704: a failing iFlow does not stop the others during concurrent real transport")
    void req704_isolation() {
        concurrency.set(new ConcurrencySettings(8, 4));
        prd.stubFor(post(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo("A3"))).willReturn(serverError()));
        dev.stubFor(get(urlEqualTo(path("B2") + "/$value")).willReturn(serverError()));
        var response = run(false);
        assertThat(response.results()).extracting(ArtifactResult::artifactId).containsExactlyElementsOf(all());
        var byId = byId(response);
        assertThat(byId.get("A3").error().code()).isEqualTo("UPLOAD_FAILED");
        assertThat(byId.get("B2").error().code()).isEqualTo("DOWNLOAD_FAILED");
        assertThat(response.summary()).isEqualTo(new TransportSummary(8, 6, 2));
    }

    @Test
    @DisplayName("REQ-704: CSRF 403 and token 401 during concurrent uploads are each retried once per request")
    void req704_authRetries() {
        concurrency.set(new ConcurrencySettings(8, 4));
        for (String id : List.of("A1", "A2", "A3")) {
            prd.stubFor(post(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo(id)))
                    .inScenario("csrf-" + id).whenScenarioStateIs(Scenario.STARTED).willSetStateTo("done")
                    .willReturn(aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required")));
            prd.stubFor(post(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo(id)))
                    .inScenario("csrf-" + id).whenScenarioStateIs("done").willReturn(created()));
        }
        for (String id : List.of("A4", "B1", "B2")) {
            prd.stubFor(post(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo(id)))
                    .inScenario("auth-" + id).whenScenarioStateIs(Scenario.STARTED).willSetStateTo("done")
                    .willReturn(aResponse().withStatus(401)));
            prd.stubFor(post(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo(id)))
                    .inScenario("auth-" + id).whenScenarioStateIs("done").willReturn(created()));
        }
        var response = run(false);
        assertThat(response.summary()).isEqualTo(new TransportSummary(8, 8, 0));
        for (String id : List.of("A1", "A2", "A3", "A4", "B1", "B2"))
            prd.verify(2, postRequestedFor(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo(id))));
        for (String id : List.of("A5", "B3"))
            prd.verify(1, postRequestedFor(urlEqualTo(COLLECTION)).withRequestBody(matchingJsonPath("$.Id", equalTo(id))));
    }

    @Test
    @DisplayName("REQ-704: every step log line of an iFlow carries that iFlow's transportId, packageId and artifactId in MDC")
    void req704_logContext() {
        concurrency.set(new ConcurrencySettings(8, 4));
        var logger = (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(TransportService.class);
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        TransportResponse response;
        try {
            response = run(false);
        } finally {
            logger.detachAppender(appender);
        }
        var steps = appender.list.stream().filter(e -> e.getFormattedMessage().contains(" artifactId=")
                && e.getFormattedMessage().contains(" step=")).toList();
        assertThat(steps).isNotEmpty();
        for (String id : all()) {
            var mine = steps.stream().filter(e -> e.getFormattedMessage().contains("artifactId=" + id + " ")).toList();
            assertThat(mine).as(id).hasSizeGreaterThanOrEqualTo(6);
            assertThat(mine).allSatisfy(e -> {
                assertThat(e.getMDCPropertyMap()).containsEntry("transportId", response.transportId())
                        .containsEntry("artifactId", id)
                        .containsEntry("packageId", id.startsWith("A") ? "P1" : "P2");
            });
        }
    }

    @Test
    @DisplayName("REQ-705: a running transport keeps the concurrency read when it started")
    void req705_settingsFixedAtStart() {
        concurrency.set(new ConcurrencySettings(8, 3));
        api.onFirstDownload = () -> concurrency.set(new ConcurrencySettings(1, 1));
        run(false);
        assertThat(api.maxInFlight.get()).isEqualTo(3);
    }

    // ---- helpers ----

    private static List<String> all() {
        var ids = new ArrayList<>(P1);
        ids.addAll(P2);
        return ids;
    }
    private static Map<String, ArtifactResult> byId(TransportResponse response) {
        var map = new HashMap<String, ArtifactResult>();
        response.results().forEach(r -> map.put(r.artifactId(), r));
        return map;
    }
    private void packageMetadata(WireMockServer server, String id) {
        server.stubFor(get(urlEqualTo(pkg(id))).willReturn(okJson(
                "{\"d\":{\"Id\":\"" + id + "\",\"Name\":\"Package " + id + "\",\"Version\":\"1.0.0\"}}")));
    }
    private void artifacts(String packageId, List<String> ids) {
        dev.stubFor(get(urlEqualTo(pkg(packageId) + "/IntegrationDesigntimeArtifacts")).willReturn(okJson("{\"d\":{\"results\":["
                + String.join(",", ids.stream().map(id -> "{\"Id\":\"" + id + "\",\"Name\":\"Name " + id + "\",\"Version\":\"1.0\"}").toList())
                + "]}}")));
    }
    private static String pkg(String id) { return PACKAGES + "('" + id + "')"; }
    private static String path(String id) { return COLLECTION + "(Id='" + id + "',Version='active')"; }
    private static CpiProperties.Connection connection(WireMockServer server, String env) {
        String base = "http://localhost:" + server.port();
        return new CpiProperties.Connection(base, base + "/token", "dummy-" + env + "-client", "dummy-" + env + "-secret");
    }
    private static byte[] zipUnchecked(String id) {
        try { return zip(id); } catch (Exception failure) { throw new IllegalStateException(failure); }
    }
    private static byte[] zip(String id) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var out = new ZipOutputStream(bytes)) {
            out.putNextEntry(new ZipEntry("src/main/resources/scenarioflows/integrationflow/" + id + ".iflw"));
            out.write("<definitions/>".getBytes(StandardCharsets.UTF_8));
            out.closeEntry();
        }
        return bytes.toByteArray();
    }
}
