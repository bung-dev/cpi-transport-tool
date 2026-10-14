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
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.parallel.ResourceLock;
import org.junit.jupiter.api.parallel.Resources;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@ResourceLock(Resources.SYSTEM_PROPERTIES)
class RealSampleVariantTests {
    private static final String ID = "CPITT_Sample_DeployFail";
    private static final Path DIRECTORY = Path.of("samples/real-transport/" + ID);
    private static final String ARTIFACT = RealSampleStub.ROOT
            + "IntegrationDesigntimeArtifacts(Id='" + ID + "',Version='active')";
    private RealSampleStub stub;
    @TempDir Path customDirectory;
    private final HttpClient client = HttpClient.newHttpClient();
    private final JsonMapper json = new JsonMapper();

    @AfterEach void stop() { if (stub != null) stub.stop(); }

    private HttpResponse<byte[]> get(String path, boolean authorized) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + stub.dev().port() + path));
        if (authorized) request.header("Authorization", "Bearer dummy-dev-token-0001");
        return client.send(request.GET().build(), HttpResponse.BodyHandlers.ofByteArray());
    }
    private HttpResponse<byte[]> get(String path) throws Exception { return get(path, true); }
    private void assertArtifact(String id, String name, String version) throws Exception {
        var response = get(RealSampleStub.ROOT + "IntegrationPackages('" + RealSampleStub.PACKAGE
                + "')/IntegrationDesigntimeArtifacts");
        assertThat(response.statusCode()).isEqualTo(200);
        var artifacts = json.readTree(response.body()).path("d").path("results");
        assertThat(artifacts.size()).isEqualTo(1);
        assertThat(artifacts.get(0).path("Id").asString()).isEqualTo(id);
        assertThat(artifacts.get(0).path("Name").asString()).isEqualTo(name);
        assertThat(artifacts.get(0).path("Version").asString()).isEqualTo(version);
    }
    private static Map<String, byte[]> entries(byte[] bytes) throws IOException {
        var result = new LinkedHashMap<String, byte[]>();
        try (var zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            java.util.zip.ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                assertThat(result.put(entry.getName(), zip.readAllBytes())).isNull();
            }
        }
        return result;
    }
    private static void restore(String key, String value) {
        if (value == null) System.clearProperty(key); else System.setProperty(key, value);
    }

    @Test @DisplayName("REQ-306 AC-1·AC-7: absent and empty options preserve the single default artifact")
    void req306_ac1_defaultVariant() throws Exception {
        String previous = System.getProperty("sample.variant");
        try {
            for (String option : Arrays.asList(null, "")) {
                restore("sample.variant", option);
                stub = new RealSampleStub(); stub.start(0);
                assertArtifact(RealSampleStub.ID, RealSampleStub.ID, "1.0.0");
                assertThat(get(RealSampleStub.ARTIFACT + "/$value").statusCode()).isEqualTo(200);
                assertThat(get(ARTIFACT + "/$value").statusCode()).isEqualTo(404);
                stub.stop();
            }
        } finally { restore("sample.variant", previous); }
    }

    @Test @DisplayName("REQ-306 AC-1·AC-7: variant exposes only its artifact bundle and one parameter with common dummy gates")
    void req306_ac1_variantContract() throws Exception {
        stub = new RealSampleStub("deployFail"); stub.start(0);
        var manifest = new Manifest(new ByteArrayInputStream(entries(stub.bundle()).get("META-INF/MANIFEST.MF")));
        assertArtifact(ID, manifest.getMainAttributes().getValue("Bundle-Name"),
                manifest.getMainAttributes().getValue("Bundle-Version"));
        var packages = json.readTree(get(RealSampleStub.ROOT + "IntegrationPackages").body()).path("d").path("results");
        assertThat(packages.size()).isEqualTo(1);
        assertThat(packages.get(0).path("Id").asString()).isEqualTo(RealSampleStub.PACKAGE);
        var bundle = get(ARTIFACT + "/$value");
        assertThat(bundle.statusCode()).isEqualTo(200);
        assertThat(entries(bundle.body())).containsOnlyKeys(entries(stub.bundle()).keySet().toArray(String[]::new));
        assertThat(get(RealSampleStub.ARTIFACT + "/$value").statusCode()).isEqualTo(404);
        assertThat(get(RealSampleStub.ARTIFACT + "/Configurations").statusCode()).isEqualTo(404);
        var parameters = new Properties();
        try (var in = Files.newBufferedReader(DIRECTORY.resolve("src/main/resources/parameters.prop"))) { parameters.load(in); }
        var configs = json.readTree(get(ARTIFACT + "/Configurations").body()).path("d").path("results");
        assertThat(configs.size()).isEqualTo(1);
        String key = parameters.stringPropertyNames().iterator().next();
        assertThat(configs.get(0).path("ParameterKey").asString()).isEqualTo(key);
        assertThat(configs.get(0).path("ParameterValue").asString()).isEqualTo(parameters.getProperty(key));
        assertThat(configs.get(0).path("DataType").asString()).isEqualTo("xsd:string");
        assertThat(get(ARTIFACT + "/$value", false).statusCode()).isEqualTo(401);
        assertThat(get(RealSampleStub.ROOT + "missing").statusCode()).isEqualTo(404);
        var token = HttpRequest.newBuilder(URI.create("http://localhost:" + stub.dev().port() + "/oauth/token"))
                .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                        "dummy-dev-client:dummy-dev-secret".getBytes(StandardCharsets.UTF_8)))
                .POST(HttpRequest.BodyPublishers.ofString("grant_type=client_credentials")).build();
        var response = client.send(token, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(json.readTree(response.body()).path("access_token").asString()).isEqualTo("dummy-dev-token-0001");
        var csrf = HttpRequest.newBuilder(URI.create("http://localhost:" + stub.dev().port() + RealSampleStub.ROOT))
                .header("Authorization", "Bearer dummy-dev-token-0001").header("X-CSRF-Token", "Fetch").GET().build();
        var csrfResponse = client.send(csrf, HttpResponse.BodyHandlers.ofString());
        assertThat(csrfResponse.statusCode()).isEqualTo(200);
        assertThat(csrfResponse.headers().firstValue("X-CSRF-Token")).contains("dummy-dev-csrf-0001");
        assertThat(csrfResponse.headers().firstValue("Set-Cookie").orElseThrow()).contains("JSESSIONID=dummy-dev-session-0001");
        var write = HttpRequest.newBuilder(URI.create("http://localhost:" + stub.dev().port() + ARTIFACT))
                .header("Authorization", "Bearer dummy-dev-token-0001").POST(HttpRequest.BodyPublishers.noBody()).build();
        assertThat(client.send(write, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
    }

    @Test @DisplayName("REQ-306 AC-7: all six ZIP entries use the variant ID and preserve manifest and project metadata")
    void req306_ac7_bundle() throws Exception {
        stub = new RealSampleStub("deployFail");
        var contents = entries(stub.bundle());
        assertThat(contents).containsOnlyKeys("META-INF/MANIFEST.MF", ".project", "metainfo.prop",
                "src/main/resources/parameters.prop", "src/main/resources/parameters.propdef",
                "src/main/resources/scenarioflows/integrationflow/" + ID + ".iflw");
        contents.forEach((name, bytes) -> {
            assertThat(name).doesNotContain(RealSampleStub.ID);
            assertThat(new String(bytes, StandardCharsets.UTF_8)).as(name).doesNotContain(RealSampleStub.ID);
        });
        var attributes = new Manifest(new ByteArrayInputStream(contents.get("META-INF/MANIFEST.MF"))).getMainAttributes();
        assertThat(attributes.getValue("Bundle-Name")).isEqualTo(ID);
        assertThat(attributes.getValue("Bundle-SymbolicName")).isEqualTo(ID + "; singleton:=true");
        assertThat(attributes.getValue("Origin-Bundle-Name")).isEqualTo(ID);
        assertThat(attributes.getValue("Origin-Bundle-SymbolicName")).isEqualTo(ID);
        for (String line : new String(contents.get("META-INF/MANIFEST.MF"), StandardCharsets.UTF_8).split("\\R"))
            assertThat(line.getBytes(StandardCharsets.UTF_8).length).isLessThanOrEqualTo(72);
        assertThat(RealSampleStubTests.parse(contents.get(".project")).getElementsByTagName("name").item(0).getTextContent()).isEqualTo(ID);
    }

    @Test @DisplayName("REQ-306 AC-5·AC-7: variant files have no tenant markers and only exact identifier URIs or localhost URLs")
    void req306_ac5_variantLocalOnly() throws Exception {
        // Complete identifiers belonging to the frozen variant, independent of the default sample allowlist.
        Set<String> identifiers = Set.of("//www.omg.org/spec/BPMN/20100524/MODEL", "//www.omg.org/spec/BPMN/20100524/DI",
                "//www.omg.org/spec/DD/20100524/DC", "//www.omg.org/spec/DD/20100524/DI",
                "//www.w3.org/2001/XMLSchema-instance", "//com.sap.it.ifl.tooling/default/flow");
        var urls = Pattern.compile("https?://(?!/)[^\\s\"'<>\\\\]+", Pattern.CASE_INSENSITIVE);
        var markers = Pattern.compile("ondemand[.]com|trial|sb-", Pattern.CASE_INSENSITIVE);
        try (var files = Files.walk(DIRECTORY)) {
            for (Path path : files.filter(Files::isRegularFile).toList()) {
                assertThat(path.toString()).doesNotContain(RealSampleStub.ID);
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

    @Test @DisplayName("REQ-306 AC-1·AC-7: system variant and directory override are honored and unknown variants are rejected")
    void req306_ac7_options() throws Exception {
        String previousVariant = System.getProperty("sample.variant");
        String previousDirectory = System.getProperty("real.sample.dir");
        try {
            System.setProperty("sample.variant", "deployFail");
            try (var files = Files.walk(DIRECTORY)) {
                for (Path source : files.filter(Files::isRegularFile).toList()) {
                    Path destination = customDirectory.resolve(DIRECTORY.relativize(source));
                    Files.createDirectories(destination.getParent());
                    Files.copy(source, destination);
                }
            }
            System.setProperty("real.sample.dir", customDirectory.toString());
            stub = new RealSampleStub(); stub.start(0);
            assertArtifact(ID, ID, "1.0.0"); stub.stop();
            stub = new RealSampleStub(DIRECTORY, "deployFail");
            assertThat(entries(stub.bundle())).hasSize(6);
            System.setProperty("sample.variant", "unknown");
            assertThatThrownBy(RealSampleStub::new).isInstanceOf(IllegalArgumentException.class).hasMessage("Unknown sample variant");
            assertThatThrownBy(() -> new RealSampleStub("unknown")).isInstanceOf(IllegalArgumentException.class).hasMessage("Unknown sample variant");
            assertThatThrownBy(() -> new RealSampleStub(DIRECTORY, "unknown")).isInstanceOf(IllegalArgumentException.class).hasMessage("Unknown sample variant");
            assertThat(stub.dev()).isNull();
        } finally {
            restore("sample.variant", previousVariant);
            restore("real.sample.dir", previousDirectory);
        }
    }
}
