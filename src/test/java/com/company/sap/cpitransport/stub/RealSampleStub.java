package com.company.sap.cpitransport.stub;

import com.github.tomakehurst.wiremock.WireMockServer;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.jar.Manifest;
import java.util.zip.*;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;

/** Local DEV contract; sample format still requires the separate deployment verification. */
// AI-NOTE: Timer, Content Modifier and parameter definitions are format assumptions; mock success
// does not prove SAP upload/deployment compatibility (REQ-306, 01_spec.md A7, REQ-307 AC-3~AC-5).
public final class RealSampleStub {
    public static final String ID = "CPITT_Sample_Push";
    public static final String PACKAGE = "CPITransportRealTest";
    public static final String ROOT = "/api/v1/";
    public static final String ARTIFACT = ROOT + "IntegrationDesigntimeArtifacts(Id='" + ID + "',Version='active')";
    public static final Path SAMPLE = Path.of("samples/real-transport/" + ID);
    private final Path directory;
    private WireMockServer dev;

    public RealSampleStub() { this(Path.of(System.getProperty("real.sample.dir", SAMPLE.toString()))); }
    public RealSampleStub(Path directory) { this.directory = directory; }
    public WireMockServer dev() { return dev; }

    public void start(int port) throws IOException {
        if (dev != null) throw new IllegalStateException("Already started");
        byte[] bundle = bundle();
        String version;
        try (var in = Files.newInputStream(directory.resolve("META-INF/MANIFEST.MF"))) {
            version = new Manifest(in).getMainAttributes().getValue("Bundle-Version");
        }
        var parameters = new Properties();
        try (var in = Files.newBufferedReader(directory.resolve("src/main/resources/parameters.prop"))) { parameters.load(in); }
        if (version == null || parameters.size() != 1) throw new IOException("Invalid sample metadata");
        dev = new WireMockServer(options().bindAddress("localhost").port(port));
        try {
            dev.start();
            common();
            var json = new JsonMapper();
            var pkg = Map.of("Id", PACKAGE, "Name", PACKAGE, "Version", "1.0.0");
            var artifact = Map.of("Id", ID, "Name", ID, "Version", version);
            getJson(ROOT + "IntegrationPackages", json.writeValueAsString(Map.of("d", Map.of("results", List.of(pkg)))));
            getJson(ROOT + "IntegrationPackages('" + PACKAGE + "')", json.writeValueAsString(Map.of("d", pkg)));
            getJson(ROOT + "IntegrationPackages('" + PACKAGE + "')/IntegrationDesigntimeArtifacts",
                    json.writeValueAsString(Map.of("d", Map.of("results", List.of(artifact)))));
            dev.stubFor(get(urlPathEqualTo(ARTIFACT + "/$value")).willReturn(ok().withHeader("Content-Type", "application/zip").withBody(bundle)));
            String key = parameters.stringPropertyNames().iterator().next();
            getJson(ARTIFACT + "/Configurations", json.writeValueAsString(Map.of("d", Map.of("results", List.of(
                    Map.of("ParameterKey", key, "ParameterValue", parameters.getProperty(key), "DataType", "xsd:string"))))));
        } catch (RuntimeException failure) { stop(); throw failure; }
    }

    public byte[] bundle() throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var paths = Files.walk(directory); var zip = new ZipOutputStream(bytes)) {
            for (Path path : paths.filter(Files::isRegularFile).sorted().toList()) {
                String name = directory.relativize(path).toString().replace('\\', '/');
                if (name.equals("dot.project")) name = ".project";
                var entry = new ZipEntry(name); entry.setTime(0);
                zip.putNextEntry(entry); zip.write(Files.readAllBytes(path)); zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    private void getJson(String path, String body) { dev.stubFor(get(urlPathEqualTo(path)).willReturn(okJson(body))); }
    // Same priorities and dummy gates as the existing DEV contract (REQ-306 AC-1·AC-6).
    private void common() {
        dev.stubFor(any(urlPathEqualTo("/oauth/token")).atPriority(9).willReturn(aResponse().withStatus(401)));
        dev.stubFor(post(urlPathEqualTo("/oauth/token")).atPriority(5)
                .withBasicAuth("dummy-dev-client", "dummy-dev-secret")
                .withRequestBody(equalTo("grant_type=client_credentials"))
                .willReturn(okJson("{\"access_token\":\"dummy-dev-token-0001\",\"token_type\":\"bearer\",\"expires_in\":3600}")));
        dev.stubFor(any(urlPathMatching(ROOT + ".*")).atPriority(1)
                .withHeader("Authorization", notMatching("Bearer dummy-dev-token-0001")).willReturn(aResponse().withStatus(401)));
        for (String method : List.of("POST", "PUT")) {
            dev.stubFor(request(method, urlPathMatching(ROOT + ".*")).atPriority(2)
                    .withHeader("X-CSRF-Token", notMatching("dummy-dev-csrf-0001"))
                    .willReturn(aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required")));
            dev.stubFor(request(method, urlPathMatching(ROOT + ".*")).atPriority(2)
                    .withCookie("JSESSIONID", absent()).willReturn(aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required")));
            dev.stubFor(request(method, urlPathMatching(ROOT + ".*")).atPriority(2)
                    .withCookie("JSESSIONID", notMatching("dummy-dev-session-0001"))
                    .willReturn(aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required")));
        }
        dev.stubFor(get(urlPathEqualTo(ROOT)).withHeader("X-CSRF-Token", equalTo("Fetch"))
                .willReturn(ok().withHeader("X-CSRF-Token", "dummy-dev-csrf-0001")
                        .withHeader("Set-Cookie", "JSESSIONID=dummy-dev-session-0001; Path=/")));
        dev.stubFor(any(urlPathMatching(ROOT + ".*")).atPriority(10).willReturn(notFound()));
    }

    public void stop() { if (dev != null) { dev.stop(); dev = null; } }
    public static void main(String[] args) throws Exception {
        var stub = new RealSampleStub();
        Runtime.getRuntime().addShutdownHook(new Thread(stub::stop));
        stub.start(args.length > 0 ? Integer.parseInt(args[0]) : Integer.getInteger("dev.port", 18081));
        System.out.println("Real sample DEV stub: DEV=http://localhost:" + stub.dev().port());
        new CountDownLatch(1).await();
    }
}
