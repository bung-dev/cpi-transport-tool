package com.company.sap.cpitransport.client;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import com.company.sap.cpitransport.model.ArtifactType;
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

    // These OData v2 contracts are the spec section 4 assumptions; actual tenant
    // compatibility is unverified (backlog Q-13). (근거: REQ-005 AC-4)
    public List<CpiPackage> listPackages(String environment) {
        return list(environment, "/IntegrationPackages", this::packageValue);
    }

    public Optional<CpiPackage> getPackage(String environment, String id) {
        return optional(environment, "/IntegrationPackages('" + identifier(id) + "')")
                .map(this::packageValue);
    }

    public void createPackage(String environment, CpiPackage source) {
        identifier(source.id());
        var body = new java.util.LinkedHashMap<String, String>();
        body.put("Id", source.id());
        body.put("Name", source.name());
        body.put("ShortText", source.shortText());
        body.put("Description", source.description());
        body.put("Version", source.version());
        write(environment, HttpMethod.POST, "/IntegrationPackages", body);
    }

    public List<CpiArtifact> listArtifacts(String environment, String packageId) {
        return listArtifacts(environment, packageId, ArtifactType.INTEGRATION_FLOW);
    }

    public List<CpiArtifact> listArtifacts(String environment, String packageId, ArtifactType type) {
        String path = "/IntegrationPackages('" + identifier(packageId) + "')/"
                + collection(type);
        try {
            return list(environment, path,
                    node -> new CpiArtifact(field(node, "Id"), field(node, "Name"), field(node, "Version")));
        } catch (CpiCallException failure) {
            if (type != ArtifactType.INTEGRATION_FLOW && !failure.isTokenStageFailure()
                    && Integer.valueOf(404).equals(failure.httpStatus())) {
                return List.of();
            }
            throw failure;
        }
    }

    public boolean artifactExists(String environment, String id) {
        return artifactExists(environment, id, ArtifactType.INTEGRATION_FLOW);
    }

    public boolean artifactExists(String environment, String id, ArtifactType type) {
        return findArtifact(environment, id, type).isPresent();
    }

    public record ArtifactMetadata(String name) {}

    public Optional<ArtifactMetadata> findArtifact(String environment, String id, ArtifactType type) {
        return optional(environment, artifactPath(id, type)).map(node -> {
            var name = node.path("Name");
            return new ArtifactMetadata(name.isString() ? name.asString() : null);
        });
    }

    public byte[] downloadArtifact(String environment, String id) {
        return downloadArtifact(environment, id, ArtifactType.INTEGRATION_FLOW);
    }

    public byte[] downloadArtifact(String environment, String id, ArtifactType type) {
        return http.execute(environment, HttpMethod.GET, ROOT + artifactPath(id, type) + "/$value", null, false)
                .getBody();
    }

    public void createArtifact(String environment, String name, String id, String packageId,
                               String base64) {
        createArtifact(environment, name, id, packageId, base64, ArtifactType.INTEGRATION_FLOW);
    }

    public void createArtifact(String environment, String name, String id, String packageId, String base64,
                               ArtifactType type) {
        var body = Map.of("Name", name, "Id", identifier(id), "PackageId", identifier(packageId), "ArtifactContent", base64);
        write(environment, HttpMethod.POST, "/" + collection(type), body, type == ArtifactType.INTEGRATION_FLOW);
    }

    public void updateArtifactContent(String environment, String id, ArtifactType type, String base64) {
        write(environment, HttpMethod.PUT, artifactPath(id, type), Map.of("ArtifactContent", base64), false);
    }

    public void deleteArtifact(String environment, String id, ArtifactType type) {
        write(environment, HttpMethod.DELETE, artifactPath(id, type), null, false);
    }

    public void updateArtifact(String environment, String id, String name, String base64) {
        write(environment, HttpMethod.PUT, artifactPath(id), Map.of("Name", name, "ArtifactContent", base64));
    }

    public List<CpiConfiguration> getConfigurations(String environment, String id) {
        return list(environment, artifactPath(id) + "/Configurations",
                node -> new CpiConfiguration(field(node, "ParameterKey"), configurationValue(node),
                        field(node, "DataType")));
    }

    public void updateConfiguration(String environment, String id, String key,
                                    String value, String dataType) {
        // OData string literals escape quotes by doubling; URI encoding protects delimiters in keys.
        String encodedKey = UriUtils.encode(key.replace("'", "''"), StandardCharsets.UTF_8);
        write(environment, HttpMethod.PUT, artifactPath(id) + "/$links/Configurations('" + encodedKey + "')",
                configurationBody(value, dataType));
    }

    public void deploy(String environment, String id) {
        write(environment, HttpMethod.POST,
                "/DeployIntegrationDesigntimeArtifact?Id='" + identifier(id) + "'&Version='active'", null);
    }

    public String deployObject(String environment, String id, ArtifactType type) {
        String path = ROOT + "/Deploy" + type.odataPrefix() + "DesigntimeArtifact?Id='" + identifier(id) + "'&Version='active'";
        byte[] body = http.execute(environment, HttpMethod.POST, path, null, false).getBody();
        String task = body == null ? "" : new String(body, StandardCharsets.UTF_8).strip();
        if (task.length() >= 2 && task.startsWith("\"") && task.endsWith("\"")) {
            task = task.substring(1, task.length() - 1).strip();
        }
        return task;
    }

    public String getBuildAndDeployStatus(String environment, String task) {
        String encoded = UriUtils.encode(task.replace("'", "''"), StandardCharsets.UTF_8);
        String path = ROOT + "/BuildAndDeployStatus(TaskId='" + encoded + "')";
        byte[] body = http.execute(environment, HttpMethod.GET, path, null, true, false).getBody();
        return field(data(body), "Status");
    }

    public Optional<String> getRuntimeStatus(String environment, String id) {
        return optional(environment, "/IntegrationRuntimeArtifacts('" + identifier(id) + "')")
                .map(node -> field(node, "Status"));
    }

    public Map<String, String> listRuntimeStatuses(String environment) {
        var statuses = new HashMap<String, String>();
        // A failed runtime list is retried on the next deployment polling interval.
        for (var entry : list(environment, "/IntegrationRuntimeArtifacts", false,
                node -> Map.entry(field(node, "Id"), field(node, "Status")))) {
            statuses.put(entry.getKey(), entry.getValue());
        }
        return statuses;
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
        return artifactPath(id, ArtifactType.INTEGRATION_FLOW);
    }

    private String artifactPath(String id, ArtifactType type) {
        return "/" + collection(type) + "(Id='" + identifier(id) + "',Version='active')";
    }

    private String collection(ArtifactType type) {
        return type.odataPrefix() + "DesigntimeArtifacts";
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
            // JSON parser diagnostics can expose configuration values; discard the cause.
            throw invalidResponse();
        }
    }

    private <T> List<T> list(String environment, String path, Function<JsonNode, T> convert) {
        return list(environment, path, true, convert);
    }

    private <T> List<T> list(String environment, String path, boolean retryTransient, Function<JsonNode, T> convert) {
        URI base = http.apiUrl(environment);
        URI current = URI.create(base.toString() + ROOT + path);
        List<T> values = new ArrayList<>();
        for (int page = 1; page <= 50; page++) {
            String requestPath = (current.getRawPath().isEmpty() ? "/" : current.getRawPath())
                    + (current.getRawQuery() == null ? "" : "?" + current.getRawQuery());
            JsonNode response = data(http.executePage(environment, requestPath, retryTransient).getBody());
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

    // Resolve against the current request, but validate against the selected tenant
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
        return new CpiPackage(field(node, "Id"), field(node, "Name"), field(node, "Version"),
                optionalField(node, "ShortText"), optionalField(node, "Description"), optionalField(node, "Mode"));
    }

    private Map<String, String> configurationBody(String value, String dataType) {
        var body = new java.util.LinkedHashMap<String, String>();
        body.put("ParameterValue", value);
        body.put("DataType", dataType);
        return body;
    }

    private String configurationValue(JsonNode node) {
        var value = node.path("ParameterValue");
        if (value.isMissingNode() || value.isNull()) return null;
        return field(node, "ParameterValue");
    }

    private String optionalField(JsonNode node, String key) {
        var value = node.path(key);
        return value.isMissingNode() || value.isNull() ? null : field(node, key);
    }

    private String field(JsonNode node, String key) {
        if (!node.path(key).isString()) throw invalidResponse();
        return node.path(key).asString();
    }

    private static CpiCallException invalidResponse() {
        return new CpiCallException(null, "Invalid CPI OData response");
    }

    private void write(String environment, HttpMethod method, String path, Map<String, String> body) {
        write(environment, method, path, body, true);
    }

    private void write(String environment, HttpMethod method, String path, Map<String, String> body,
                       boolean retryTransient) {
        http.execute(environment, method, ROOT + path,
                body == null ? null : mapper.writeValueAsBytes(body), true, retryTransient);
    }
}
