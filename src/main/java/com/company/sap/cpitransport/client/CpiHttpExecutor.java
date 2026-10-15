package com.company.sap.cpitransport.client;

import com.company.sap.cpitransport.tenant.TenantRegistry;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import org.springframework.beans.factory.annotation.Autowired;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.TransportProperties;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

@Component
public class CpiHttpExecutor {
    private final TenantRegistry tenants;
    private final OAuthTokenProvider tokens;
    private final CsrfTokenStore csrf;
    private final TransportProperties.Retry retry;
    private final Sleeper sleeper;
    private final RestClient client;
    private final RestClient onceClient;

    public CpiHttpExecutor(CpiProperties properties, OAuthTokenProvider tokens, CsrfTokenStore csrf,
                           TransportProperties transport, Sleeper sleeper) {
        this(TenantRegistry.initial(properties), tokens, csrf, transport, sleeper);
    }

    @Autowired
    public CpiHttpExecutor(TenantRegistry tenants, OAuthTokenProvider tokens, CsrfTokenStore csrf, TransportProperties transport, Sleeper sleeper) {
        this(tenants, tokens, csrf, transport, sleeper, Duration.ofSeconds(10));
    }

    public CpiHttpExecutor(TenantRegistry tenants, OAuthTokenProvider tokens, CsrfTokenStore csrf,
                           TransportProperties transport, Sleeper sleeper, Duration detailTimeout) {
        this.tenants = tenants;
        this.tokens = tokens;
        this.csrf = csrf;
        this.retry = transport.retry();
        this.sleeper = sleeper;
        if (retry.maxAttempts() < 1 || retry.initialBackoff().isNegative()) {
            throw new IllegalArgumentException("Invalid retry settings");
        }
        this.client = RestClient.builder().requestFactory(new JdkClientHttpRequestFactory()).build();
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .connectTimeout(detailTimeout).followRedirects(HttpClient.Redirect.NEVER).build());
        factory.setReadTimeout(detailTimeout);
        this.onceClient = RestClient.builder().requestFactory(factory).build();
    }

    public ResponseEntity<byte[]> execute(CpiEnvironment environment, HttpMethod method,
                                           String path, byte[] body, boolean acceptJson) {
        return execute(environment.name(), method, path, body, acceptJson);
    }

    public ResponseEntity<byte[]> execute(String environment, HttpMethod method, String path, byte[] body, boolean acceptJson) {
        if (!path.startsWith("/") || path.startsWith("//")) {
            throw new IllegalArgumentException("CPI path must be relative to the configured API");
        }
        return send(environment, method, path, body, acceptJson, false);
    }

    private ResponseEntity<byte[]> send(String environment, HttpMethod method, String path,
                                         byte[] body, boolean acceptJson, boolean fetch) {
        boolean write = HttpMethod.POST.equals(method) || HttpMethod.PUT.equals(method);
        boolean refreshedAuth = false;
        boolean refreshedCsrf = false;
        int transientFailures = 0;
        Duration delay = retry.initialBackoff();
        var connection = tenants.find(environment).orElseThrow(() -> new ApiException(Code.TENANT_NOT_FOUND)).connection();
        List<String> secrets = credentialSecrets(connection);
        while (true) {
            CsrfTokenStore.Token session = write ? csrf.getOrFetch(environment, () -> fetchCsrf(environment)) : null;
            String bearer;
            try {
                bearer = tokens.getToken(environment);
            } catch (OAuthTokenProvider.TokenRequestException failure) {
                throw new CpiCallException(failure.httpStatus(), "CPI authentication failed", true);
            }
            addRequestSecrets(secrets, bearer, session);
            ResponseEntity<byte[]> response;
            try {
                String base = connection.apiUrl().replaceAll("/+$", "");
                var request = client.method(method).uri(URI.create(base + path))
                        .headers(headers -> {
                            headers.setBearerAuth(bearer);
                            if (acceptJson && !path.split("\\?", 2)[0].endsWith("/$value")) {
                                headers.setAccept(List.of(MediaType.APPLICATION_JSON));
                            }
                            if (fetch) headers.set("X-CSRF-Token", "Fetch");
                            if (session != null) {
                                headers.set("X-CSRF-Token", session.value());
                                if (!session.cookie().isBlank()) headers.set(HttpHeaders.COOKIE, session.cookie());
                            }
                        });
                if (body != null) request.contentType(MediaType.APPLICATION_JSON).body(body);
                response = request.exchange((req, res) -> new ResponseEntity<>(
                        res.getBody().readAllBytes(), res.getHeaders(), res.getStatusCode()));
            } catch (ResourceAccessException failure) {
                if (++transientFailures >= retry.maxAttempts()) throw new CpiCallException(null, "CPI IO failure");
                pause(delay);
                delay = nextDelay(delay, transientFailures);
                continue;
            } catch (RuntimeException failure) {
                // AI-NOTE: URI/client diagnostics can contain credentials; never retain their cause. (근거: REQ-002 AC-6, run 20260928-cpi-transport)
                throw new CpiCallException(null, "CPI request failed");
            }
            int status = response.getStatusCode().value();
            if (response.getStatusCode().is2xxSuccessful()) return response;
            if (status == 401 && !refreshedAuth) {
                refreshedAuth = true;
                tokens.invalidate(environment);
                continue;
            }
            if (status == 403 && write && !refreshedCsrf
                    && "Required".equalsIgnoreCase(response.getHeaders().getFirst("X-CSRF-Token"))) {
                refreshedCsrf = true;
                csrf.invalidate(environment);
                continue;
            }
            if ((status == 429 || status >= 500 && status <= 599)
                    && ++transientFailures < retry.maxAttempts()) {
                // AI-NOTE: Auth/CSRF replays do not reset the transient-failure budget. (근거: REQ-003 AC-3, run 20260928-cpi-transport)
                pause(delay);
                delay = nextDelay(delay, transientFailures);
                continue;
            }
            throw new CpiCallException(status, summarize(response.getBody(), secrets));
        }
    }

    // AI-NOTE: ErrorInformation must never use send's retry/auth replay path (REQ-309 AC-1).
    public OnceResponse executeOnce(String tenantId, String path) {
        if (!path.startsWith("/") || path.startsWith("//")) {
            throw new IllegalArgumentException("CPI path must be relative to the configured API");
        }
        try {
            var connection = tenants.find(tenantId).orElseThrow(() -> new ApiException(Code.TENANT_NOT_FOUND)).connection();
            var secrets = credentialSecrets(connection);
            String bearer = tokens.getToken(tenantId);
            addRequestSecrets(secrets, bearer, null);
            String base = connection.apiUrl().replaceAll("/+$", "");
            return onceClient.get().uri(URI.create(base + path)).headers(h -> h.setBearerAuth(bearer))
                    .exchange((req, res) -> new OnceResponse(res.getStatusCode().value(),
                            res.getBody().readAllBytes(), secrets, connection.apiUrl(), connection.tokenUrl()));
        } catch (RuntimeException failure) {
            // AI-NOTE: Discard diagnostics and causes, which may echo secrets (REQ-309 AC-3 / REQ-305 AC-3).
            return new OnceResponse(0, null, List.of(), null, null);
        }
    }

    public record OnceResponse(int status, byte[] body, List<String> secrets, String apiUrl, String tokenUrl) {
        @Override public String toString() { return "OnceResponse[content redacted]"; }
    }

    private List<String> credentialSecrets(CpiProperties.Connection connection) {
        List<String> secrets = new ArrayList<>();
        var connections = new ArrayList<CpiProperties.Connection>();
        connections.add(connection);
        // Preserve legacy initial-tenant masking while covering the selected registered tenant.
        for (String initialId : List.of("DEV", "PRD")) {
            tenants.find(initialId).ifPresent(t -> connections.add(t.connection()));
        }
        for (var credentials : connections) {
            secrets.add(credentials.clientId());
            secrets.add(credentials.clientSecret());
            secrets.add(Base64.getEncoder().encodeToString(
                    (credentials.clientId() + ":" + credentials.clientSecret()).getBytes(StandardCharsets.UTF_8)));
        }
        return secrets;
    }

    private void addRequestSecrets(List<String> secrets, String bearer, CsrfTokenStore.Token session) {
        secrets.add(bearer);
        if (session != null) {
            secrets.add(session.value());
            secrets.add(session.cookie());
            for (String cookie : session.cookie().split(";")) {
                int equals = cookie.indexOf('=');
                if (equals >= 0) secrets.add(cookie.substring(equals + 1).trim());
            }
        }
    }

    private CsrfTokenStore.Token fetchCsrf(String environment) {
        var response = send(environment, HttpMethod.GET, "/api/v1/", null, true, true);
        String token = response.getHeaders().getFirst("X-CSRF-Token");
        if (token == null || token.isBlank() || "Required".equalsIgnoreCase(token)) {
            throw new CpiCallException(response.getStatusCode().value(), "CPI CSRF token missing");
        }
        List<String> cookies = response.getHeaders().get(HttpHeaders.SET_COOKIE);
        String cookie = cookies == null ? "" : String.join("; ", cookies.stream()
                .map(value -> value.split(";", 2)[0].trim()).toList());
        return new CsrfTokenStore.Token(token, cookie);
    }

    private Duration nextDelay(Duration delay, int failures) {
        return failures < retry.maxAttempts() - 1 ? delay.multipliedBy(2) : delay;
    }

    private void pause(Duration delay) {
        try {
            sleeper.sleep(delay);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new CpiCallException(null, "CPI request interrupted");
        }
    }

    private String summarize(byte[] body, List<String> secrets) {
        String summary = body == null ? "" : new String(body, StandardCharsets.UTF_8);
        // AI-NOTE: Sanitize before truncation so a secret crossing character 200 cannot leak a prefix. (근거: REQ-002 AC-6, run 20260928-cpi-transport)
        summary = maskAuthentication(maskSecrets(summary, secrets)).replaceAll("[\\r\\n\\t]", " ");
        return summary.isBlank() ? "CPI request failed" : summary.substring(0, Math.min(200, summary.length()));
    }
    public static String maskSecrets(String value, List<String> secrets) {
        for (String secret : secrets.stream().filter(secretValue -> secretValue != null && !secretValue.isEmpty())
                .sorted((a, b) -> Integer.compare(b.length(), a.length())).toList()) {
            value = value.replace(secret, "***");
        }
        return value;
    }

    public static String maskAuthentication(String value) {
        value = value.replaceAll("(?i)(authorization|(?:set-)?cookie|x-csrf-token)[\"']?\\s*[:=][^\\r\\n]*", "$1: ***")
                .replaceAll("(?i)(bearer|basic)\\s+[^\\s\"'<>]+", "$1 ***");
        return value;
    }

}
