package com.company.sap.cpitransport.stub;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.MappingBuilder;
import com.github.tomakehurst.wiremock.client.ResponseDefinitionBuilder;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.zip.*;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;

/** Local-only, deliberately dummy CPI contracts shared by manual runs and tests. */
public final class LocalCpiStubs {
    private static final String ROOT = "/api/v1/";
    private static final JsonMapper JSON = new JsonMapper();
    private static final List<String> FAULTS = Arrays.stream(("A B Download500 Download400 Flaky503 RateLimited429 "
            + "BadXml Doctype NotZip NoIflw TargetCheck500 UploadFail CsrfRetry AuthRetry ConfigRead500 "
            + "ParamPutFail DeployError DeployTimeout DeployPost500 RuntimeGet500").split(" "))
            .map(s -> "IF_Fault_" + s).toList();
    private final Path zipDirectory;
    private WireMockServer dev;
    private WireMockServer prd;

    public LocalCpiStubs() { this(Path.of("build/local-stubs/dev-zips")); }
    public LocalCpiStubs(Path zipDirectory) { this.zipDirectory = zipDirectory; }
    public WireMockServer dev() { return dev; }
    public WireMockServer prd() { return prd; }

    public void start(int devPort, int prdPort) throws IOException {
        if (dev != null || prd != null) throw new IllegalStateException("Already started");
        dev = new WireMockServer(options().bindAddress("localhost").port(devPort));
        prd = new WireMockServer(options().bindAddress("localhost").port(prdPort));
        try {
            dev.start(); prd.start();
            common(dev, "dev"); common(prd, "prd");
            seed();
        } catch (IOException | RuntimeException failure) { stop(); throw failure; }
    }
    public void stop() {
        try { if (prd != null) prd.stop(); }
        finally { if (dev != null) dev.stop(); prd = null; dev = null; }
    }
    public static void main(String[] args) throws Exception {
        var stubs = new LocalCpiStubs();
        Runtime.getRuntime().addShutdownHook(new Thread(stubs::stop));
        stubs.start(args.length > 0 ? Integer.parseInt(args[0]) : Integer.getInteger("dev.port", 18081),
                args.length > 1 ? Integer.parseInt(args[1]) : Integer.getInteger("prd.port", 18082));
        System.out.println("Local CPI stubs: DEV=" + stubs.dev.baseUrl() + " PRD=" + stubs.prd.baseUrl());
        new CountDownLatch(1).await();
    }
    private void common(WireMockServer server, String env) {
        String token = "dummy-" + env + "-token-0001";
        String csrf = "dummy-" + env + "-csrf-0001";
        String session = "dummy-" + env + "-session-0001";
        server.stubFor(any(urlPathEqualTo("/oauth/token")).atPriority(9).willReturn(aResponse().withStatus(401)));
        server.stubFor(post(urlPathEqualTo("/oauth/token")).atPriority(5)
                .withBasicAuth("dummy-" + env + "-client", "dummy-" + env + "-secret")
                .withRequestBody(equalTo("grant_type=client_credentials"))
                .willReturn(okJson(JSON.writeValueAsString(Map.of("access_token", token, "token_type", "bearer", "expires_in", 3600)))));
        server.stubFor(any(urlPathMatching(ROOT + ".*")).atPriority(1)
                .withHeader("Authorization", notMatching("Bearer " + token)).willReturn(aResponse().withStatus(401)));
        for (String method : List.of("POST", "PUT")) {
            server.stubFor(request(method, urlPathMatching(ROOT + ".*")).atPriority(2)
                    .withHeader("X-CSRF-Token", notMatching(csrf))
                    .willReturn(aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required")));
            server.stubFor(request(method, urlPathMatching(ROOT + ".*")).atPriority(2)
                    .withCookie("JSESSIONID", absent())
                    .willReturn(aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required")));
            server.stubFor(request(method, urlPathMatching(ROOT + ".*")).atPriority(2)
                    .withCookie("JSESSIONID", notMatching(session))
                    .willReturn(aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required")));
        }
        server.stubFor(get(urlPathEqualTo(ROOT)).withHeader("X-CSRF-Token", equalTo("Fetch"))
                .willReturn(ok().withHeader("X-CSRF-Token", csrf).withHeader("Set-Cookie", "JSESSIONID=" + session + "; Path=/")));
        server.stubFor(any(urlPathMatching(ROOT + ".*")).atPriority(10).willReturn(aResponse().withStatus(404)));
    }
    private static String artifact(String id) { return ROOT + "IntegrationDesigntimeArtifacts(Id='" + id + "',Version='active')"; }
    private static Map<String, String> metadata(String id, String name, String version) {
        return Map.of("Id", id, "Name", name, "Version", version);
    }
    private static final Set<String> NOT_IN_PRD = Set.of("PkgNotInPrd", "PkgCreateFail");
    private static Map<String, String> packageMetadata(String id, String name, String mode) {
        var value = new LinkedHashMap<String, String>();
        value.put("Id", id);
        value.put("Name", name);
        value.put("ShortText", name + " short text");
        value.put("Description", name + " description");
        value.put("Version", "1.0.0");
        if (mode != null) value.put("Mode", mode);
        return value;
    }
    private static String data(Object value) { return JSON.writeValueAsString(Map.of("d", value)); }
    private static String results(Object value) { return data(Map.of("results", value)); }
    private static void getJson(WireMockServer server, String path, String body) {
        server.stubFor(get(urlPathEqualTo(path)).willReturn(okJson(body)));
    }
    private static void once(WireMockServer server, String scenario, MappingBuilder first,
                             MappingBuilder next, ResponseDefinitionBuilder failure, ResponseDefinitionBuilder success) {
        server.stubFor(first.inScenario(scenario).whenScenarioStateIs("Started").willSetStateTo("done").willReturn(failure));
        server.stubFor(next.inScenario(scenario).whenScenarioStateIs("done").willReturn(success));
    }
    private void seed() throws IOException {
        var packages = List.of(packageMetadata("PkgTransportDemo", "Transport Demo", "EDIT_ALLOWED"),
                packageMetadata("PkgFaultDemo", "Fault Demo", null), packageMetadata("PkgNotInPrd", "Not In PRD", null),
                packageMetadata("PkgCreateFail", "Create Fail Demo", null));
        // REQ-605, REQ-606: SAP 제공(구성 전용) 패키지는 Mode가 편집 불가라 목록에서 숨는다. ID로 직접 읽으면 보인다.
        var sapPackage = packageMetadata("PkgSapStandard", "SAP Standard Content", "READ_ONLY");
        var devList = new ArrayList<>(packages);
        devList.add(sapPackage);
        getJson(dev, ROOT + "IntegrationPackages", results(devList));
        getJson(dev, ROOT + "IntegrationPackages('PkgSapStandard')", data(sapPackage));
        getJson(dev, ROOT + "IntegrationPackages('PkgSapStandard')/IntegrationDesigntimeArtifacts", results(List.of()));
        // PRD도 패키지 목록을 돌려준다(대상에 없는 PkgNotInPrd·PkgCreateFail 제외). 연결 확인(IntegrationPackages?$top=1)이 OK가 되어야
        // 대상 연결 확인 실패 때 실제 이관을 막는 규칙(REQ-430·423, 2026-11-16 사람 결정) 아래에서 화면 실제 이관을 검증할 수 있다.
        getJson(prd, ROOT + "IntegrationPackages", results(packages.stream().filter(p -> !NOT_IN_PRD.contains(p.get("Id"))).toList()));
        // REQ-606: 승인하면 PkgNotInPrd는 만들어지고(201), PkgCreateFail은 만들기가 실패한다(500).
        prd.stubFor(post(urlPathEqualTo(ROOT + "IntegrationPackages")).atPriority(8).willReturn(created()));
        prd.stubFor(post(urlPathEqualTo(ROOT + "IntegrationPackages"))
                .withRequestBody(matchingJsonPath("$.Id", equalTo("PkgCreateFail"))).willReturn(serverError()));
        Files.createDirectories(zipDirectory);
        for (var pkg : packages) {
            String id = pkg.get("Id");
            String path = ROOT + "IntegrationPackages('" + id + "')";
            getJson(dev, path, data(pkg));
            if (!NOT_IN_PRD.contains(id)) getJson(prd, path, data(pkg));
            List<String> ids = id.equals("PkgTransportDemo") ? List.of("IF_Order_Sync", "IF_Customer_Push")
                    : id.equals("PkgFaultDemo") ? FAULTS : id.equals("PkgCreateFail") ? List.of("IF_CreateFail") : List.of("IF_Orphan");
            getJson(dev, path + "/IntegrationDesigntimeArtifacts", results(ids.stream().map(a -> metadata(a,
                    a.equals("IF_Order_Sync") ? "Order Sync" : a.equals("IF_Customer_Push") ? "Customer Push" : a,
                    a.equals("IF_Order_Sync") ? "1.0.3" : a.equals("IF_Customer_Push") ? "2.1.0" : "1.0.0")).toList()));
            for (String a : ids) seedArtifact(a);
        }
        getJson(prd, artifact("IF_Order_Sync"), data(metadata("IF_Order_Sync", "Order Sync", "1.0.3")));
        prd.stubFor(get(urlPathEqualTo(artifact("IF_Fault_TargetCheck500"))).willReturn(serverError()));
        prd.stubFor(post(urlPathEqualTo(ROOT + "IntegrationDesigntimeArtifacts")).atPriority(8).willReturn(created()));
        prd.stubFor(post(urlPathEqualTo(ROOT + "IntegrationDesigntimeArtifacts"))
                .withRequestBody(matchingJsonPath("$.Id", equalTo("IF_Fault_UploadFail"))).willReturn(serverError()));
        once(prd, "csrf-retry", upload("IF_Fault_CsrfRetry"), upload("IF_Fault_CsrfRetry"),
                aResponse().withStatus(403).withHeader("X-CSRF-Token", "Required"), created());
        // REQ-702: 401 한 번 뒤 토큰을 다시 받아 재시도하면 성공한다.
        once(prd, "auth-retry", upload("IF_Fault_AuthRetry"), upload("IF_Fault_AuthRetry"),
                aResponse().withStatus(401), created());
        prd.stubFor(put(urlPathEqualTo(artifact("IF_Order_Sync"))).willReturn(ok()));
        // 20261121-perf-retry REQ-904: 배포 확인은 런타임 목록(IntegrationRuntimeArtifacts)을 한 번에 읽는다.
        // 단건 조회와 같은 뜻: DeployError는 ERROR, DeployTimeout·RuntimeGet500은 목록에 없음(배포 중),
        // IF_Order_Sync는 첫 목록에 없고 다음부터 STARTED. 나머지는 STARTED.
        var statuses = new LinkedHashMap<String, String>();
        for (var pkg : packages) {
            String id = pkg.get("Id");
            for (String a : id.equals("PkgTransportDemo") ? List.of("IF_Order_Sync", "IF_Customer_Push")
                    : id.equals("PkgFaultDemo") ? FAULTS : id.equals("PkgCreateFail") ? List.of("IF_CreateFail") : List.of("IF_Orphan")) {
                if (a.equals("IF_Fault_DeployTimeout") || a.equals("IF_Fault_RuntimeGet500")) continue;
                statuses.put(a, a.equals("IF_Fault_DeployError") ? "ERROR" : "STARTED");
            }
        }
        var first = new LinkedHashMap<>(statuses);
        first.remove("IF_Order_Sync");
        once(prd, "runtime-list", RuntimeListStub.list(), RuntimeListStub.list(),
                okJson(RuntimeListStub.body(first)), okJson(RuntimeListStub.body(statuses)));
    }
    private static MappingBuilder upload(String id) {
        return post(urlPathEqualTo(ROOT + "IntegrationDesigntimeArtifacts")).withRequestBody(matchingJsonPath("$.Id", equalTo(id)));
    }
    private void seedArtifact(String id) throws IOException {
        String path = artifact(id);
        byte[] zip = zip(id);
        Files.write(zipDirectory.resolve(id + ".zip"), zip);
        var download = aResponse().withHeader("Content-Type", "application/zip").withBody(zip);
        String value = path + "/$value";
        switch (id) {
            case "IF_Fault_Download500" -> dev.stubFor(get(urlPathEqualTo(value)).willReturn(serverError()));
            case "IF_Fault_Download400" -> dev.stubFor(get(urlPathEqualTo(value)).willReturn(badRequest()));
            case "IF_Fault_Flaky503", "IF_Fault_RateLimited429" -> once(dev, id, get(urlPathEqualTo(value)), get(urlPathEqualTo(value)),
                    aResponse().withStatus(id.endsWith("503") ? 503 : 429), download);
            case "IF_Fault_NotZip" -> dev.stubFor(get(urlPathEqualTo(value)).willReturn(ok("NOT-A-ZIP-FILE")));
            default -> dev.stubFor(get(urlPathEqualTo(value)).willReturn(download));
        }
        // REQ-506, REQ-702: 구성 값은 원본(DEV)에서만 읽는다. 읽기 500은 원본 쪽. 401 재시도는 업로드 POST에서 난다(seed).
        if (id.equals("IF_Fault_ConfigRead500")) dev.stubFor(get(urlPathEqualTo(path + "/Configurations")).willReturn(serverError()));
        else getJson(dev, path + "/Configurations", results(configurations(id)));
        String links = java.util.regex.Pattern.quote(path) + "/\\$links/Configurations\\('[^']*'\\)";
        prd.stubFor(put(urlPathMatching(links)).atPriority(8).willReturn(aResponse().withStatus(202)));
        // REQ-702: 구성 값 PUT을 보내지 않으므로 ParamPutFail은 성공한다(이 매핑은 호출되지 않아야 한다).
        if (id.equals("IF_Fault_ParamPutFail")) prd.stubFor(put(urlPathEqualTo(path + "/$links/Configurations('ParamA')")).willReturn(serverError()));
        prd.stubFor(post(urlPathEqualTo(ROOT + "DeployIntegrationDesigntimeArtifact"))
                .withQueryParam("Id", equalTo("'" + id + "'")).withQueryParam("Version", equalTo("'active'"))
                .willReturn(aResponse().withStatus(id.equals("IF_Fault_DeployPost500") ? 500 : 202)));
        String runtime = ROOT + "IntegrationRuntimeArtifacts('" + id + "')";
        var started = okJson(data(Map.of("Id", id, "Status", "STARTED")));
        switch (id) {
            case "IF_Order_Sync" -> once(prd, "runtime-order", get(urlPathEqualTo(runtime)), get(urlPathEqualTo(runtime)), notFound(), started);
            case "IF_Fault_DeployError" -> getJson(prd, runtime, data(Map.of("Id", id, "Status", "ERROR")));
            case "IF_Fault_DeployTimeout" -> prd.stubFor(get(urlPathEqualTo(runtime)).willReturn(notFound()));
            case "IF_Fault_RuntimeGet500" -> prd.stubFor(get(urlPathEqualTo(runtime)).willReturn(serverError()));
            default -> prd.stubFor(get(urlPathEqualTo(runtime)).willReturn(started));
        }
    }
    private static List<Map<String, String>> configurations(String id) {
        // REQ-701: 민감해 보이는 키(ApiToken)의 빈 값도 다른 값과 같게 다룬다.
        if (id.equals("IF_Order_Sync")) return List.of(
                parameter("Endpoint", "http://dev-backend.localhost/orders", "xsd:string"),
                parameter("BatchSize", "100", "xsd:integer"), parameter("ApiToken", "", "xsd:string"));
        if (id.equals("IF_Fault_AuthRetry")) return List.of(parameter("RetryKey", "retry-dev", "xsd:string"));
        if (id.equals("IF_Customer_Push")) return List.of(
                parameter("ReceiverUrl", "http://dev-receiver.localhost/customers", "xsd:string"),
                parameter("Timeout", "30000", "xsd:integer"), parameter("ClientPassword", "dummy-dev-pass-XYZ", "xsd:string"),
                parameter("LogLevel", "INFO", "xsd:string"));
        if (id.equals("IF_Fault_ParamPutFail")) return List.of(parameter("ParamA", "a-dev", "xsd:string"), parameter("ParamB", "b-dev", "xsd:string"));
        return List.of();
    }
    private static Map<String, String> parameter(String key, String value, String type) {
        return Map.of("ParameterKey", key, "ParameterValue", value, "DataType", type);
    }
    // AI-NOTE: XML namespace URIs in fixtures identify BPMN/SAP vocabularies; they are never network targets. (근거: D-041, REQ-015 AC-4, run 20260928-cpi-transport)
    private static byte[] zip(String id) throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var out = new ZipOutputStream(bytes)) {
            // Fixed ancillary bytes are local fixtures, not a claim about tenant exports.
            entry(out, "META-INF/MANIFEST.MF", "Manifest-Version: 1.0\n".getBytes(StandardCharsets.UTF_8));
            entry(out, "src/main/resources/parameters.prop", "fixture=local\n".getBytes(StandardCharsets.UTF_8));
            if (!id.equals("IF_Fault_NoIflw")) {
                try (var in = LocalCpiStubs.class.getResourceAsStream("/local-stubs/iflw/" + id + ".iflw")) {
                    if (in == null) throw new FileNotFoundException(id + ".iflw");
                    entry(out, "src/main/resources/scenarioflows/integrationflow/" + id + ".iflw", in.readAllBytes());
                }
            }
        }
        return bytes.toByteArray();
    }
    private static void entry(ZipOutputStream out, String name, byte[] bytes) throws IOException {
        var entry = new ZipEntry(name); entry.setTime(0); out.putNextEntry(entry); out.write(bytes); out.closeEntry();
    }
}
