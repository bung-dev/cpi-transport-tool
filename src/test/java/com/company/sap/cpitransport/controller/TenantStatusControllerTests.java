package com.company.sap.cpitransport.controller;

import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.*;
import com.company.sap.cpitransport.config.*;
import com.company.sap.cpitransport.service.TenantStatusService;
import com.company.sap.cpitransport.tenant.*;
import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.ObjectMapper;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.*;

class TenantStatusControllerTests {
    @TempDir Path directory;
    WireMockServer server;
    TenantStatusService service;
    TenantRegistry registry;
    MockMvc mvc;
    final ObjectMapper json = new ObjectMapper();
    @BeforeEach void setup() {
        server = new WireMockServer(options().dynamicPort().bindAddress("localhost")); server.start();
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        var store = new EncryptedTenantStore(directory.resolve("tenants.enc"),
                () -> Optional.of(Base64.getEncoder().encodeToString(bytes)), json);
        var connection = new CpiProperties.Connection(server.baseUrl(), server.baseUrl() + "/oauth/token",
                "test-dummy-client", "test-dummy-secret");
        registry = new TenantRegistry(new CpiProperties(connection, connection), store, Clock.systemUTC(),
                event -> { if (event instanceof TenantChangedEvent changed) service.changed(changed); });
        service = new TenantStatusService(registry, new ReadOnlyProperties(true), Clock.systemUTC(), json);
        mvc = MockMvcBuilders.standaloneSetup(new TenantStatusController(service), new TenantController(registry, json))
                .setControllerAdvice(new ApiExceptionHandler()).build();
        server.stubFor(post(urlEqualTo("/oauth/token")).willReturn(okJson(
                "{\"access_token\":\"test-dummy-token\",\"expires_in\":3600}")));
        server.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo("/api/v1/IntegrationPackages?$top=1"))
                .willReturn(okJson("{\"d\":{\"results\":[]}}")));
    }
    @AfterEach void stop() { service.close(); server.stop(); }
    String register() {
        var body = json.createObjectNode().put("name", "Registered");
        var oauth = body.putObject("serviceKey").putObject("oauth");
        oauth.put("url", server.baseUrl()); oauth.put("tokenurl", server.baseUrl() + "/oauth/token");
        oauth.put("clientid", "test-dummy-client"); oauth.put("clientsecret", "test-dummy-secret");
        return registry.register(body).id();
    }
    @Test @DisplayName("REQ-302 AC-3 / REQ-303 AC-1·AC-5: read-only permits status and preserves source order")
    void req302_ac3_status() throws Exception {
        String id = register();
        mvc.perform(get("/tenants/status")).andExpect(status().isOk())
                .andExpect(jsonPath("$.readOnly").value(true))
                .andExpect(jsonPath("$.tenants[0].id").value("DEV"))
                .andExpect(jsonPath("$.tenants[1].id").value("PRD"))
                .andExpect(jsonPath("$.tenants[0].source").value("env"))
                .andExpect(jsonPath("$.tenants[2].id").value(id))
                .andExpect(jsonPath("$.tenants[2].source").value("registered"))
                .andExpect(jsonPath("$.tenants[2].check").value("OK"));
    }
    @Test @DisplayName("REQ-303 AC-2·AC-5: unknown query tenant returns 400 including absent reserved ids")
    void req303_ac2_missing() throws Exception {
        mvc.perform(get("/tenants/status").param("tenantId", "missing"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("TENANT_NOT_FOUND"));
        var empty = new TenantStatusService(TenantRegistry.initial(new CpiProperties(new CpiProperties.Connection("", "", "", ""), new CpiProperties.Connection("", "", "", ""))),
                new ReadOnlyProperties(true), Clock.systemUTC(), json);
        try {
            var emptyMvc = MockMvcBuilders.standaloneSetup(new TenantStatusController(empty))
                    .setControllerAdvice(new ApiExceptionHandler()).build();
            for (String id : List.of("DEV", "PRD")) emptyMvc.perform(get("/tenants/status").param("tenantId", id))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("TENANT_NOT_FOUND"));
        } finally { empty.close(); }
        assertThat(server.getAllServeEvents()).isEmpty();
    }
    @Test @DisplayName("REQ-301 AC-4 / REQ-303 AC-3·AC-5: PUT invalidates only the changed tenant cache")
    void req301_ac4_update() throws Exception {
        String id = register(); service.status(null, false);
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/tenants/" + id)
                .contentType("application/json").content("{\"name\":\"Renamed\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/tenants/status")).andExpect(status().isOk())
                .andExpect(jsonPath("$.tenants[2].name").value("Renamed"));
        server.verify(4, postRequestedFor(urlEqualTo("/oauth/token")));
    }
}
