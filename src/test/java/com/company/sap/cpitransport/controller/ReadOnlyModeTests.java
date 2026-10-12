package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.config.AppConfig;
import com.company.sap.cpitransport.config.ReadOnlyProperties;
import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.stub.LocalCpiStubs;
import com.company.sap.cpitransport.tenant.TenantStoreKeySource;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.security.SecureRandom;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.annotation.*;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.assertThat;

class ReadOnlyModeTests {
    @TempDir Path directory;
    static final ObjectMapper JSON = new ObjectMapper();

    @TestConfiguration(proxyBeanMethods = false)
    static class Keys {
        @Bean @Primary TenantStoreKeySource testKey() {
            byte[] bytes = new byte[32];
            new SecureRandom().nextBytes(bytes);
            String key = Base64.getEncoder().encodeToString(bytes);
            return () -> Optional.of(key);
        }
        @Bean @Primary Sleeper testSleeper() { return duration -> {}; }
    }

    @Test
    @DisplayName("REQ-302 AC-1: safe default and environment placeholder bind independently")
    void req302_ac1_defaultAndEnvironment() {
        for (boolean explicit : List.of(false, true)) {
            new ApplicationContextRunner().withInitializer(ctx -> {
                ctx.getEnvironment().getPropertySources().replace("systemEnvironment",
                        new SystemEnvironmentPropertySource("systemEnvironment",
                                explicit ? Map.of("CPI_TRANSPORT_READ_ONLY", "false") : Map.of()));
                new ConfigDataApplicationContextInitializer().initialize(ctx);
            }).withUserConfiguration(AppConfig.class).run(ctx -> {
                assertThat(ctx).hasNotFailed();
                assertThat(ctx.getBean(ReadOnlyProperties.class).readOnly()).isEqualTo(!explicit);
            });
        }
    }

    private org.springframework.context.ConfigurableApplicationContext app(LocalCpiStubs stubs,
                                                                          boolean readOnly, boolean prd) throws Exception {
        Files.copy(Path.of("examples/mapping-example.yml"), directory.resolve("mapping.yml"),
                StandardCopyOption.REPLACE_EXISTING);
        var args = new ArrayList<String>(List.of("--server.port=0",
                "--cpi.transport.read-only=" + readOnly,
                "--cpi.transport.mapping-file=" + directory.resolve("mapping.yml"),
                "--cpi.transport.history.file=" + directory.resolve(prd ? "history.jsonl" : "missing-prd-history.jsonl"),
                "--cpi.tenants.store-file=" + directory.resolve("tenants.enc")));
        for (String env : List.of("dev", "prd")) {
            boolean enabled = env.equals("dev") || prd;
            String base = "http://localhost:" + (env.equals("dev") ? stubs.dev().port() : stubs.prd().port());
            String prefix = "--cpi.environments." + env + ".";
            args.add(prefix + "api-url=" + (enabled ? base : ""));
            args.add(prefix + "token-url=" + (enabled ? base + "/oauth/token" : ""));
            args.add(prefix + "client-id=" + (enabled ? "dummy-" + env + "-client" : ""));
            args.add(prefix + "client-secret=" + (enabled ? "dummy-" + env + "-secret" : ""));
        }
        return new SpringApplicationBuilder(CpiTransportToolApplication.class, Keys.class)
                .run(args.toArray(String[]::new));
    }

    private HttpResponse<String> request(org.springframework.context.ConfigurableApplicationContext ctx,
                                         String method, String path, String body, int expected) throws Exception {
        int port = ((WebServerApplicationContext) ctx).getWebServer().getPort();
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        try (var client = HttpClient.newHttpClient()) {
            var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(expected);
            return response;
        }
    }

    @Test
    @DisplayName("REQ-302 AC-2: rejection precedes configuration and leaves CPI and history untouched")
    void req302_ac2_rejectsBeforeAnySideEffect() throws Exception {
        var stubs = new LocalCpiStubs(directory.resolve("bundles"));
        stubs.start(0, 0);
        try {
            for (boolean prd : List.of(true, false)) {
                try (var ctx = app(stubs, true, prd)) {
                    for (boolean existing : List.of(false, true)) {
                        Path history = directory.resolve(prd ? "history.jsonl" : "missing-prd-history.jsonl");
                        if (existing) Files.writeString(history, "preserved\n");
                        for (String suffix : List.of(",\"dryRun\":false", "")) {
                            var response = request(ctx, "POST", "/transport",
                                    "{\"packageId\":\"PkgTransportDemo\"" + suffix + "}", 409);
                            assertThat(JSON.readTree(response.body()).get("error").asString()).isEqualTo("READ_ONLY_MODE");
                            assertThat(JSON.readTree(response.body()).get("message").asString())
                                    .isEqualTo("Read-only mode: real transport is disabled");
                        }
                        if (existing) assertThat(Files.readString(history)).isEqualTo("preserved\n");
                        else assertThat(history).doesNotExist();
                    }
                    for (String invalid : List.of("[]", "{}", "{\"packageId\":\"bad/id\"}",
                            "{\"packageId\":\"PkgTransportDemo\",\"deploy\":\"yes\"}")) {
                        assertThat(request(ctx, "POST", "/transport", invalid, 400).body()).contains("INVALID_REQUEST");
                    }
                    assertThat(stubs.dev().getAllServeEvents()).isEmpty();
                    assertThat(stubs.prd().getAllServeEvents()).isEmpty();
                }
            }
        } finally { stubs.stop(); }
    }

    @Test
    @DisplayName("REQ-302 AC-3: read-only permits dry run queries and local tenant management")
    void req302_ac3_readsAndTenantManagement() throws Exception {
        var stubs = new LocalCpiStubs(directory.resolve("bundles"));
        stubs.start(0, 0);
        try (var ctx = app(stubs, true, true)) {
            request(ctx, "POST", "/transport", "{\"packageId\":\"PkgTransportDemo\",\"dryRun\":true}", 200);
            for (String path : List.of("/packages", "/packages/PkgTransportDemo/artifacts", "/transport/history", "/tenants")) {
                request(ctx, "GET", path, null, 200);
            }
            var body = JSON.createObjectNode().put("name", "test-dummy-tenant");
            var oauth = body.putObject("serviceKey").putObject("oauth");
            String base = "http://localhost:" + stubs.prd().port();
            oauth.put("url", base).put("tokenurl", base + "/oauth/token")
                    .put("clientid", "dummy-prd-client").put("clientsecret", "dummy-prd-secret");
            String id = JSON.readTree(request(ctx, "POST", "/tenants", body.toString(), 201).body()).get("id").asString();
            request(ctx, "PUT", "/tenants/" + id, "{\"name\":\"test-dummy-renamed\"}", 200);
            request(ctx, "DELETE", "/tenants/" + id, null, 204);
            assertThat(stubs.prd().getAllServeEvents()).isEmpty();
        } finally { stubs.stop(); }
    }

    @Test
    @DisplayName("REQ-302 AC-4: explicit false retains UPDATED and CREATED real transport")
    void req302_ac4_realTransportWhenDisabled() throws Exception {
        var stubs = new LocalCpiStubs(directory.resolve("bundles"));
        stubs.start(0, 0);
        try (var ctx = app(stubs, false, true)) {
            var response = JSON.readTree(request(ctx, "POST", "/transport",
                    "{\"packageId\":\"PkgTransportDemo\",\"dryRun\":false}", 200).body());
            var actions = new HashMap<String, String>();
            for (var result : response.get("results")) actions.put(result.get("artifactId").asString(), result.get("action").asString());
            assertThat(actions).containsEntry("IF_Order_Sync", "UPDATED").containsEntry("IF_Customer_Push", "CREATED");
            assertThat(response.get("summary").get("failed").asInt()).isZero();
            assertThat(directory.resolve("history.jsonl")).exists();
            assertThat(stubs.prd().getAllServeEvents()).isNotEmpty();
        } finally { stubs.stop(); }
    }
}
