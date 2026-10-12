package com.company.sap.cpitransport.controller;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import com.company.sap.cpitransport.CpiTransportToolApplication;
import com.company.sap.cpitransport.tenant.TenantStoreKeySource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.annotation.DirtiesContext;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = {CpiTransportToolApplication.class, TenantApiSecretTests.Keys.class},
        properties = {"logging.level.org.springframework.web=TRACE", "logging.level.com.company=TRACE"})
@ExtendWith(OutputCaptureExtension.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TenantApiSecretTests {
    @TempDir static Path directory;
    @LocalServerPort int port;
    static final String KEY = TenantControllerTests.randomKey();
    @TestConfiguration(proxyBeanMethods = false)
    static class Keys {
        @Bean @Primary TenantStoreKeySource testKey() { return () -> Optional.of(KEY); }
    }
    @DynamicPropertySource
    static void configuration(DynamicPropertyRegistry values) {
        values.add("cpi.tenants.store-file", () -> directory.resolve("tenants.enc").toString());
        values.add("cpi.transport.history.file", () -> directory.resolve("history.jsonl").toString());
        for (String env : List.of("dev", "prd")) {
            for (String field : List.of("api-url", "token-url", "client-id", "client-secret")) {
                values.add("cpi.environments." + env + "." + field, () -> "");
            }
        }
    }

    @Test
    @DisplayName("REQ-305 AC-3 / REQ-301 AC-3·AC-9: TRACE success and invalid registration update never disclose body credentials")
    void req305_ac3_trace(CapturedOutput output) throws Exception {
        var json = TenantControllerTests.JSON;
        String body = json.writeValueAsString(TenantControllerTests.body("Secret test", "http://localhost:1"));
        var registered = TenantControllerTests.request(port, "POST", "/tenants", body);
        assertThat(registered.statusCode()).isEqualTo(201);
        String id = json.readTree(registered.body()).get("id").asString();
        var keyPatch = json.createObjectNode();
        keyPatch.set("serviceKey", TenantControllerTests.body("unused", "http://localhost:2").get("serviceKey"));
        var updated = TenantControllerTests.request(port, "PUT", "/tenants/" + id, json.writeValueAsString(keyPatch));
        assertThat(updated.statusCode()).isEqualTo(200);
        var invalid = (tools.jackson.databind.node.ObjectNode) TenantControllerTests.body("Bad secret test", "http://localhost:1");
        ((tools.jackson.databind.node.ObjectNode) invalid.get("serviceKey").get("oauth")).put("url", "test-dummy-invalid-url");
        var failedPost = TenantControllerTests.request(port, "POST", "/tenants", json.writeValueAsString(invalid));
        var failedPut = TenantControllerTests.request(port, "PUT", "/tenants/" + id, json.writeValueAsString(invalid));
        assertThat(failedPost.statusCode()).isEqualTo(400);
        assertThat(failedPut.statusCode()).isEqualTo(400);
        String broken = "{\"name\":\"test-dummy-api-secret\",\"serviceKey\":test-dummy-api-client";
        var parsePost = TenantControllerTests.request(port, "POST", "/tenants", broken);
        var parsePut = TenantControllerTests.request(port, "PUT", "/tenants/" + id, broken);
        assertThat(parsePost.statusCode()).isEqualTo(400);
        assertThat(parsePut.statusCode()).isEqualTo(400);
        var list = TenantControllerTests.request(port, "GET", "/tenants", null);
        assertThat(list.statusCode()).isEqualTo(200);
        String all = output.getAll() + registered.body() + updated.body() + failedPost.body() + failedPut.body()
                + parsePost.body() + parsePut.body() + list.body();
        assertThat(all).doesNotContain("test-dummy-api-client", "test-dummy-api-secret", KEY,
                "test-dummy-invalid-url", body, broken, "\"oauth\":{", "/oauth/token");
        assertThat(output.getAll()).contains("TRACE");
    }
}
