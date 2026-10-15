package com.company.sap.cpitransport.client;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import com.company.sap.cpitransport.model.CpiArtifact;
import com.company.sap.cpitransport.model.CpiConfiguration;
import com.company.sap.cpitransport.model.CpiPackage;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class CpiApiClient {
    private static final String ROOT = "/api/v1";
    private final CpiHttpExecutor http;
    private final ObjectMapper mapper;

    public CpiApiClient(CpiHttpExecutor http, ObjectMapper mapper) {
        this.http = http;
        this.mapper = mapper;
    }

    // AI-NOTE: These OData v2 contracts are the spec section 4 assumptions; actual tenant
    // compatibility is unverified (backlog Q-13). (근거: REQ-005 AC-4, run 20260928-cpi-transport)
    public List<CpiPackage> listPackages(String environment) {
        return list(environment, "/IntegrationPackages", this::packageValue);
    }

    public Optional<CpiPackage> getPackage(String environment, String id) {
        return optional(environment, "/IntegrationPackages('" + identifier(id) + "')")
                .map(this::packageValue);
    }

    public List<CpiArtifact> listArtifacts(String environment, String packageId) {
        // Preserve the HTTP 404 so callers can distinguish a missing package from an empty list.
        return list(environment, "/IntegrationPackages('" + identifier(packageId)
                + "')/IntegrationDesigntimeArtifacts",
                node -> new CpiArtifact(field(node, "Id"), field(node, "Name"), field(node, "Version")));
    }

    public boolean artifactExists(String environment, String id) {
        return optional(environment, artifactPath(id)).isPresent();
    }

    public byte[] downloadArtifact(String environment, String id) {
        return http.execute(environment, HttpMethod.GET, ROOT + artifactPath(id) + "/$value", null, false)
                .getBody();
    }

    public void createArtifact(String environment, String name, String id, String packageId,
                               String base64) {
        identifier(id);
        identifier(packageId);
        write(environment, HttpMethod.POST, "/IntegrationDesigntimeArtifacts",
                Map.of("Name", name, "Id", id, "PackageId", packageId, "ArtifactContent", base64));
    }

    public void updateArtifact(String environment, String id, String name, String base64) {
        write(environment, HttpMethod.PUT, artifactPath(id), Map.of("Name", name, "ArtifactContent", base64));
    }

    public List<CpiConfiguration> getConfigurations(String environment, String id) {
        return list(environment, artifactPath(id) + "/Configurations",
                node -> new CpiConfiguration(field(node, "ParameterKey"), field(node, "ParameterValue"),
                        field(node, "DataType")));
    }

    public void updateConfiguration(String environment, String id, String key,
                                    String value, String dataType) {
        // OData string literals escape quotes by doubling; URI encoding protects delimiters in keys.
        String encodedKey = UriUtils.encode(key.replace("'", "''"), StandardCharsets.UTF_8);
        write(environment, HttpMethod.PUT, artifactPath(id) + "/$links/Configurations('" + encodedKey + "')",
                Map.of("ParameterValue", value, "DataType", dataType));
    }

    public void deploy(String environment, String id) {
        write(environment, HttpMethod.POST,
                "/DeployIntegrationDesigntimeArtifact?Id='" + identifier(id) + "'&Version='active'", null);
    }

    public Optional<String> getRuntimeStatus(String environment, String id) {
        return optional(environment, "/IntegrationRuntimeArtifacts('" + identifier(id) + "')")
                .map(node -> field(node, "Status"));
    }

    public CpiHttpExecutor.OnceResponse getDeployErrorInformation(String tenantId, String id) {
        return http.executeOnce(tenantId, ROOT + "/IntegrationRuntimeArtifacts('" + identifier(id)
                + "')/ErrorInformation/$value");
    }

    public List<CpiPackage> listPackages(CpiEnvironment environment) { return listPackages(environment.name()); }

    public Optional<CpiPackage> getPackage(CpiEnvironment environment, String id) { return getPackage(environment.name(), id); }

    public List<CpiArtifact> listArtifacts(CpiEnvironment environment, String packageId) { return listArtifacts(environment.name(), packageId); }

    public boolean artifactExists(CpiEnvironment environment, String id) { return artifactExists(environment.name(), id); }

    public byte[] downloadArtifact(CpiEnvironment environment, String id) { return downloadArtifact(environment.name(), id); }

    public void createArtifact(CpiEnvironment environment, String name, String id, String packageId,
                               String base64) { createArtifact(environment.name(), name, id, packageId, base64); }

    public void updateArtifact(CpiEnvironment environment, String id, String name, String base64) { updateArtifact(environment.name(), id, name, base64); }

    public List<CpiConfiguration> getConfigurations(CpiEnvironment environment, String id) { return getConfigurations(environment.name(), id); }

    public void updateConfiguration(CpiEnvironment environment, String id, String key,
                                    String value, String dataType) { updateConfiguration(environment.name(), id, key, value, dataType); }

    public void deploy(CpiEnvironment environment, String id) { deploy(environment.name(), id); }

    public Optional<String> getRuntimeStatus(CpiEnvironment environment, String id) { return getRuntimeStatus(environment.name(), id); }

    private String artifactPath(String id) {
        return "/IntegrationDesigntimeArtifacts(Id='" + identifier(id) + "',Version='active')";
    }

    private String identifier(String id) {
        if (id == null || !id.matches("[A-Za-z0-9_.-]{1,100}")) {
            throw new IllegalArgumentException("Invalid CPI identifier");
        }
        return id;
    }

    private Optional<JsonNode> optional(String environment, String path) {
        try {
            return Optional.of(read(environment, path));
        } catch (CpiCallException failure) {
            // A token-endpoint 404 is an authentication failure, not a missing resource.
            if (Integer.valueOf(404).equals(failure.httpStatus())
                    && !failure.isTokenStageFailure()) return Optional.empty();
            throw failure;
        }
    }

    private JsonNode read(String environment, String path) {
        byte[] body = http.execute(environment, HttpMethod.GET, ROOT + path, null, true).getBody();
        try {
            JsonNode data = mapper.readTree(body).path("d");
            if (!data.isObject()) throw invalidResponse();
            return data;
        } catch (RuntimeException failure) {
            // AI-NOTE: JSON parser diagnostics can expose configuration values; discard the cause. (근거: REQ-002 AC-6, run 20260928-cpi-transport)
            throw invalidResponse();
        }
    }

    private <T> List<T> list(String environment, String path, Function<JsonNode, T> convert) {
        JsonNode results = read(environment, path).path("results");
        if (!results.isArray()) throw invalidResponse();
        return results.valueStream().map(convert).toList();
    }

    private CpiPackage packageValue(JsonNode node) {
        return new CpiPackage(field(node, "Id"), field(node, "Name"), field(node, "Version"));
    }

    private String field(JsonNode node, String key) {
        if (!node.path(key).isString()) throw invalidResponse();
        return node.path(key).asString();
    }

    private CpiCallException invalidResponse() {
        return new CpiCallException(null, "Invalid CPI OData response");
    }

    private void write(String environment, HttpMethod method, String path, Map<String, String> body) {
        http.execute(environment, method, ROOT + path,
                body == null ? null : mapper.writeValueAsBytes(body), true);
    }
}
