package com.company.sap.cpitransport.client;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
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
        return data(body);
    }

    private JsonNode data(byte[] body) {
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
        URI base = http.apiUrl(environment);
        URI current = URI.create(base.toString() + ROOT + path);
        List<T> values = new ArrayList<>();
        for (int page = 1; page <= 50; page++) {
            String requestPath = (current.getRawPath().isEmpty() ? "/" : current.getRawPath())
                    + (current.getRawQuery() == null ? "" : "?" + current.getRawQuery());
            JsonNode response = data(http.executePage(environment, requestPath).getBody());
            JsonNode results = response.path("results");
            if (!results.isArray()) throw invalidResponse();
            results.valueStream().map(convert).forEach(values::add);
            JsonNode next = response.path("__next");
            if (next.isMissingNode() || next.isNull()) return List.copyOf(values);
            if (!next.isString() || page == 50) throw invalidResponse();
            current = nextPage(base, current, next.asString());
        }
        throw invalidResponse();
    }

    // AI-NOTE: Resolve against the current request, but validate against the selected tenant
    // before sending any bearer token. Keep raw query bytes intact (REQ-304 AC-1 / REQ-305 AC-3).
    static URI nextPage(URI base, URI current, String link) {
        try {
            URI reference = URI.create(link);
            if (link.startsWith("//") || reference.getRawUserInfo() != null
                    || reference.getRawFragment() != null || reference.isOpaque()) throw invalidResponse();
            URI next = reference;
            if (!reference.isAbsolute()) {
                String path = reference.getRawPath();
                String query = reference.getRawQuery();
                if (path.isEmpty()) {
                    path = current.getRawPath();
                    if (query == null) query = current.getRawQuery();
                } else if (!path.startsWith("/")) {
                    String currentPath = current.getRawPath();
                    path = currentPath.substring(0, currentPath.lastIndexOf('/') + 1) + path;
                    if (!path.startsWith("/")) path = "/" + path;
                }
                next = URI.create(current.getScheme() + "://" + current.getRawAuthority()
                        + path + (query == null ? "" : "?" + query));
            }
            if (base.getHost() == null || next.getHost() == null
                    || !base.getScheme().equalsIgnoreCase(next.getScheme())
                    || !base.getHost().equalsIgnoreCase(next.getHost())
                    || port(base) != port(next) || next.getRawPath().startsWith("//")) throw invalidResponse();
            String normalizedPath = removeDotSegments(next.getRawPath());
            if (normalizedPath.startsWith("//")) throw invalidResponse();
            return URI.create(next.getScheme() + "://" + next.getRawAuthority()
                    + normalizedPath
                    + (next.getRawQuery() == null ? "" : "?" + next.getRawQuery()));
        } catch (RuntimeException failure) {
            throw invalidResponse();
        }
    }

    // RFC 3986 section 5.2.4 preserves empty path segments and clamps parent traversal at the root.
    private static String removeDotSegments(String path) {
        var output = new StringBuilder();
        while (!path.isEmpty()) {
            if (path.startsWith("../")) path = path.substring(3);
            else if (path.startsWith("./")) path = path.substring(2);
            else if (path.startsWith("/./") || path.equals("/.")) path = "/" + path.substring(Math.min(3, path.length()));
            else if (path.startsWith("/../") || path.equals("/..")) {
                path = "/" + path.substring(Math.min(4, path.length()));
                output.setLength(Math.max(0, output.lastIndexOf("/")));
            } else if (path.equals(".") || path.equals("..")) path = "";
            else {
                int end = path.indexOf('/', path.startsWith("/") ? 1 : 0);
                if (end < 0) end = path.length();
                output.append(path, 0, end);
                path = path.substring(end);
            }
        }
        return output.toString();
    }

    private static int port(URI uri) {
        return uri.getPort() >= 0 ? uri.getPort() : ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80);
    }

    private CpiPackage packageValue(JsonNode node) {
        return new CpiPackage(field(node, "Id"), field(node, "Name"), field(node, "Version"));
    }

    private String field(JsonNode node, String key) {
        if (!node.path(key).isString()) throw invalidResponse();
        return node.path(key).asString();
    }

    private static CpiCallException invalidResponse() {
        return new CpiCallException(null, "Invalid CPI OData response");
    }

    private void write(String environment, HttpMethod method, String path, Map<String, String> body) {
        http.execute(environment, method, ROOT + path,
                body == null ? null : mapper.writeValueAsBytes(body), true);
    }
}
