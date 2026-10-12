package com.company.sap.cpitransport.stub;

import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.jar.Manifest;
import java.util.regex.Pattern;
import java.util.zip.ZipInputStream;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.TargetType;
import com.company.sap.cpitransport.service.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.assertThat;

class RealSampleStubTests {
    private RealSampleStub stub;
    private final HttpClient client = HttpClient.newHttpClient();
    private final JsonMapper json = new JsonMapper();
    private static final String IFLW = "src/main/resources/scenarioflows/integrationflow/CPITT_Sample_Push.iflw";

    @BeforeEach void start() throws Exception { stub = new RealSampleStub(); stub.start(0); }
    @AfterEach void stop() { if (stub != null) stub.stop(); }
    private HttpResponse<byte[]> get(String path, String bearer, boolean fetch) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + stub.dev().port() + path))
                .header("Authorization", "Bearer " + bearer);
        if (fetch) request.header("X-CSRF-Token", "Fetch");
        return client.send(request.GET().build(), HttpResponse.BodyHandlers.ofByteArray());
    }
    private HttpResponse<byte[]> get(String path) throws Exception { return get(path, "dummy-dev-token-0001", false); }
    static Map<String, byte[]> entries(byte[] bytes) throws IOException {
        var entries = new LinkedHashMap<String, byte[]>();
        try (var zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            java.util.zip.ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                assertThat(entries.put(entry.getName(), zip.readAllBytes())).isNull();
            }
        }
        return entries;
    }
    static org.w3c.dom.Document parse(byte[] bytes) throws Exception {
        var factory = javax.xml.parsers.DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature(javax.xml.XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        factory.setExpandEntityReferences(false);
        factory.setXIncludeAware(false);
        return factory.newDocumentBuilder().parse(new ByteArrayInputStream(bytes));
    }
    static String text(Map<String, byte[]> entries, String path) { return new String(entries.get(path), StandardCharsets.UTF_8); }

    @Test @DisplayName("REQ-306 AC-1: DEV lists one package and artifact and preserves dummy auth CSRF and unknown routes")
    void req306_ac1_contract() throws Exception {
        var token = HttpRequest.newBuilder(URI.create("http://localhost:" + stub.dev().port() + "/oauth/token"))
                .header("Authorization", "Basic " + Base64.getEncoder().encodeToString("dummy-dev-client:dummy-dev-secret".getBytes(StandardCharsets.UTF_8)))
                .POST(HttpRequest.BodyPublishers.ofString("grant_type=client_credentials")).build();
        var response = client.send(token, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(json.readTree(response.body()).path("access_token").asString()).isEqualTo("dummy-dev-token-0001");
        var badToken = HttpRequest.newBuilder(token.uri()).POST(HttpRequest.BodyPublishers.ofString("grant_type=client_credentials")).build();
        assertThat(client.send(badToken, HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(401);
        String packages = RealSampleStub.ROOT + "IntegrationPackages";
        assertThat(json.readTree(get(packages).body()).path("d").path("results").size()).isEqualTo(1);
        assertThat(json.readTree(get(packages).body()).path("d").path("results").get(0).path("Id").asString()).isEqualTo(RealSampleStub.PACKAGE);
        assertThat(json.readTree(get(packages + "('CPITransportRealTest')").body()).path("d").path("Id").asString()).isEqualTo(RealSampleStub.PACKAGE);
        var artifacts = json.readTree(get(packages + "('CPITransportRealTest')/IntegrationDesigntimeArtifacts").body()).path("d").path("results");
        assertThat(artifacts.size()).isEqualTo(1);
        assertThat(artifacts.get(0).path("Id").asString()).isEqualTo(RealSampleStub.ID);
        var manifest = new Manifest(new ByteArrayInputStream(entries(stub.bundle()).get("META-INF/MANIFEST.MF")));
        assertThat(artifacts.get(0).path("Version").asString()).isEqualTo(manifest.getMainAttributes().getValue("Bundle-Version"));
        assertThat(get(packages, "wrong", false).statusCode()).isEqualTo(401);
        var csrf = get(RealSampleStub.ROOT, "dummy-dev-token-0001", true);
        assertThat(csrf.statusCode()).isEqualTo(200);
        assertThat(csrf.headers().firstValue("X-CSRF-Token")).contains("dummy-dev-csrf-0001");
        assertThat(csrf.headers().firstValue("Set-Cookie")).contains("JSESSIONID=dummy-dev-session-0001; Path=/");
        assertThat(get(RealSampleStub.ROOT + "unknown").statusCode()).isEqualTo(404);
        for (String method : List.of("POST", "PUT")) {
            var write = HttpRequest.newBuilder(URI.create("http://localhost:" + stub.dev().port() + RealSampleStub.ROOT + "unknown"))
                    .header("Authorization", "Bearer dummy-dev-token-0001").method(method, HttpRequest.BodyPublishers.noBody());
            assertThat(client.send(write.build(), HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(403);
            write.header("X-CSRF-Token", "dummy-dev-csrf-0001");
            assertThat(client.send(write.build(), HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(403);
            write.header("Cookie", "JSESSIONID=dummy-dev-session-0001");
            assertThat(client.send(write.build(), HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(404);
        }
    }

    @Test @DisplayName("REQ-306 AC-2: deterministic ZIP has template metadata and all six required entries")
    void req306_ac2_bundle() throws Exception {
        var download = get(RealSampleStub.ARTIFACT + "/$value");
        assertThat(download.statusCode()).isEqualTo(200);
        assertThat(download.headers().firstValue("Content-Type")).contains("application/zip");
        assertThat(download.body()).isEqualTo(stub.bundle());
        try (var zip = new ZipInputStream(new ByteArrayInputStream(download.body()))) {
            java.util.zip.ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) assertThat(entry.getTime()).isZero();
        }
        var entries = entries(download.body());
        assertThat(entries.keySet()).containsExactlyInAnyOrder("META-INF/MANIFEST.MF", ".project", "metainfo.prop", IFLW,
                "src/main/resources/parameters.prop", "src/main/resources/parameters.propdef");
        var attributes = new Manifest(new ByteArrayInputStream(entries.get("META-INF/MANIFEST.MF"))).getMainAttributes();
        assertThat(attributes.getValue("Bundle-SymbolicName")).isEqualTo(RealSampleStub.ID + "; singleton:=true");
        for (String name : List.of("Bundle-Name", "Origin-Bundle-Name", "Origin-Bundle-SymbolicName"))
            assertThat(attributes.getValue(name)).isEqualTo(RealSampleStub.ID);
        assertThat(attributes.getValue("Bundle-Version")).isEqualTo("1.0.0");
        assertThat(attributes.getValue("SAP-BundleType")).isEqualTo("IntegrationFlow");
        assertThat(text(entries, ".project")).contains("<name>" + RealSampleStub.ID + "</name>");
    }

    @Test @DisplayName("REQ-306 AC-3: one header property and external parameter agree with the three mappings")
    void req306_ac3_values() throws Exception {
        var entries = entries(stub.bundle());
        var settings = new TransportProperties("examples/real-transport-mapping.yml", null, null, null, List.of());
        var mappings = new MappingFileLoader(settings).load();
        assertThat(mappings).hasSize(3);
        assertThat(mappings).allSatisfy(m -> {
            assertThat(m.artifactId()).isEqualTo(RealSampleStub.ID);
            assertThat(m.devValue()).isNotEqualTo(m.prdValue());
            assertThat(new SensitiveKeyMatcher(settings).isSensitive(m.key())).isFalse();
        });
        var result = new IflwReplacer(new SensitiveKeyMatcher(settings)).process(stub.bundle(), mappings, true);
        assertThat(result.replacements()).hasSize(2).allSatisfy(r -> {
            assertThat(r.status()).isEqualTo(com.company.sap.cpitransport.model.ReplacementStatus.PLANNED);
            assertThat(r.occurrences()).isEqualTo(1);
        });
        assertThat(result.unmappedKeys()).isEmpty();
        var external = mappings.stream().filter(m -> m.targetType() == TargetType.EXTERNAL_PARAM).findFirst().orElseThrow();
        assertThat(text(entries, IFLW)).contains("{{" + external.key() + "}}");
        var properties = new Properties(); properties.load(new StringReader(text(entries, "src/main/resources/parameters.prop")));
        assertThat(properties).hasSize(1);
        assertThat(properties.getProperty(external.key())).isEqualTo(external.devValue());
        var definitions = parse(entries.get("src/main/resources/parameters.propdef"));
        assertThat(definitions.getElementsByTagName("parameter").getLength()).isEqualTo(1);
        assertThat(definitions.getElementsByTagName("key").item(0).getTextContent()).isEqualTo(external.key());
        assertThat(definitions.getElementsByTagName("type").item(0).getTextContent()).isEqualTo("xsd:string");
        var configs = json.readTree(get(RealSampleStub.ARTIFACT + "/Configurations").body()).path("d").path("results");
        assertThat(configs.size()).isEqualTo(1);
        assertThat(configs.get(0).path("ParameterKey").asString()).isEqualTo(external.key());
        assertThat(configs.get(0).path("ParameterValue").asString()).isEqualTo(external.devValue());
        assertThat(configs.get(0).path("DataType").asString()).isEqualTo("xsd:string");
    }

    @Test @DisplayName("REQ-306 AC-4: timer starts without a sender connection and every flow element has a diagram")
    void req306_ac4_timer() throws Exception {
        var document = parse(entries(stub.bundle()).get(IFLW));
        String bpmn = "http://www.omg.org/spec/BPMN/20100524/MODEL";
        var start = (org.w3c.dom.Element) document.getElementsByTagNameNS(bpmn, "startEvent").item(0);
        assertThat(start.getElementsByTagNameNS(bpmn, "timerEventDefinition").getLength()).isEqualTo(1);
        assertThat(start.getElementsByTagNameNS(bpmn, "messageEventDefinition").getLength()).isZero();
        assertThat(start.getTextContent()).contains("simple.repeat=NONE");
        assertThat(document.getElementsByTagNameNS(bpmn, "messageFlow").getLength()).isZero();
        var diagrams = new HashSet<String>();
        for (String tag : List.of("BPMNShape", "BPMNEdge")) {
            var nodes = document.getElementsByTagNameNS("*", tag);
            for (int i = 0; i < nodes.getLength(); i++) diagrams.add(((org.w3c.dom.Element) nodes.item(i)).getAttribute("bpmnElement"));
        }
        for (String tag : List.of("participant", "startEvent", "endEvent", "callActivity", "sequenceFlow")) {
            var nodes = document.getElementsByTagNameNS(bpmn, tag);
            for (int i = 0; i < nodes.getLength(); i++) assertThat(diagrams).contains(((org.w3c.dom.Element) nodes.item(i)).getAttribute("id"));
        }
    }

    @Test @DisplayName("REQ-306 AC-5: sample texts have no tenant markers and only exact identifier URIs or localhost URLs")
    void req306_ac5_localOnly() throws Exception {
        var files = new ArrayList<Path>();
        try (var paths = Files.walk(RealSampleStub.SAMPLE)) { files.addAll(paths.filter(Files::isRegularFile).toList()); }
        files.add(Path.of("src/test/java/com/company/sap/cpitransport/stub/RealSampleStub.java"));
        files.add(Path.of("examples/real-transport-mapping.yml"));
        // Scheme and complete scheme-specific part are compared separately so the existing test-source
        // connection scanner does not mistake this exact identifier allowlist for connection URLs.
        Set<String> identifiers = Set.of("//www.omg.org/spec/BPMN/20100524/MODEL", "//www.omg.org/spec/BPMN/20100524/DI",
                "//www.omg.org/spec/DD/20100524/DC", "//www.omg.org/spec/DD/20100524/DI",
                "//www.w3.org/2001/XMLSchema-instance", "//com.sap.it.ifl.tooling/default/flow");
        var urls = Pattern.compile("https?://(?!/)[^\\s\"'<>\\\\]+", Pattern.CASE_INSENSITIVE);
        var markers = Pattern.compile("ondemand[.]com|trial|sb-", Pattern.CASE_INSENSITIVE);
        for (Path path : files) {
            String content = Files.readString(path);
            assertThat(markers.matcher(content).find()).as("tenant markers in %s", path).isFalse();
            var matcher = urls.matcher(content);
            while (matcher.find()) {
                var uri = URI.create(matcher.group());
                if ("http".equals(uri.getScheme()) && identifiers.contains(uri.getRawSchemeSpecificPart())) continue;
                String host = uri.getHost();
                assertThat(host != null && (host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1")
                        || host.toLowerCase(Locale.ROOT).endsWith(".localhost"))).as("URL in %s", path).isTrue();
            }
        }
    }
}
