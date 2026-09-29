package com.company.sap.cpitransport.client;

import java.net.URI;
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
    private final CpiProperties properties;
    private final OAuthTokenProvider tokens;
    private final CsrfTokenStore csrf;
    private final TransportProperties.Retry retry;
    private final Sleeper sleeper;
    private final RestClient client;

    public CpiHttpExecutor(CpiProperties properties, OAuthTokenProvider tokens, CsrfTokenStore csrf,
                           TransportProperties transport, Sleeper sleeper) {
        this.properties = properties;
        this.tokens = tokens;
        this.csrf = csrf;
        this.retry = transport.retry();
        this.sleeper = sleeper;
        if (retry.maxAttempts() < 1 || retry.initialBackoff().isNegative()) {
            throw new IllegalArgumentException("Invalid retry settings");
        }
        this.client = RestClient.builder().requestFactory(new JdkClientHttpRequestFactory()).build();
    }

    public ResponseEntity<byte[]> execute(CpiEnvironment environment, HttpMethod method,
                                           String path, byte[] body, boolean acceptJson) {
        if (!path.startsWith("/") || path.startsWith("//")) {
            throw new IllegalArgumentException("CPI path must be relative to the configured API");
        }
        return send(environment, method, path, body, acceptJson, false);
    }

    private ResponseEntity<byte[]> send(CpiEnvironment environment, HttpMethod method, String path,
                                         byte[] body, boolean acceptJson, boolean fetch) {
        boolean write = HttpMethod.POST.equals(method) || HttpMethod.PUT.equals(method);
        boolean refreshedAuth = false;
        boolean refreshedCsrf = false;
        int transientFailures = 0;
        Duration delay = retry.initialBackoff();
        List<String> secrets = new ArrayList<>();
        for (var connection : List.of(properties.dev(), properties.prd())) {
            secrets.add(connection.clientSecret());
            secrets.add(Base64.getEncoder().encodeToString(
                    (connection.clientId() + ":" + connection.clientSecret()).getBytes(StandardCharsets.UTF_8)));
        }
        while (true) {
            CsrfTokenStore.Token session = write ? csrf.getOrFetch(environment, () -> fetchCsrf(environment)) : null;
            String bearer;
            try {
                bearer = tokens.getToken(environment.configurationEnvironment());
            } catch (OAuthTokenProvider.TokenRequestException failure) {
                throw new CpiCallException(failure.httpStatus(), "CPI authentication failed");
            }
            secrets.add(bearer);
            if (session != null) {
                secrets.add(session.value());
                secrets.add(session.cookie());
                for (String cookie : session.cookie().split(";")) {
                    int equals = cookie.indexOf('=');
                    if (equals >= 0) secrets.add(cookie.substring(equals + 1).trim());
                }
            }
            ResponseEntity<byte[]> response;
            try {
                String base = properties.connection(environment.configurationEnvironment()).apiUrl().replaceAll("/+$", "");
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
                // AI-NOTE: URI/client diagnostics can contain credentials; never retain their cause.
                throw new CpiCallException(null, "CPI request failed");
            }
            int status = response.getStatusCode().value();
            if (response.getStatusCode().is2xxSuccessful()) return response;
            if (status == 401 && !refreshedAuth) {
                refreshedAuth = true;
                tokens.invalidate(environment.configurationEnvironment());
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
                // AI-NOTE: Auth/CSRF replays do not reset the transient-failure budget.
                pause(delay);
                delay = nextDelay(delay, transientFailures);
                continue;
            }
            throw new CpiCallException(status, summarize(response.getBody(), secrets));
        }
    }

    private CsrfTokenStore.Token fetchCsrf(CpiEnvironment environment) {
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
        // AI-NOTE: Sanitize before truncation so a secret crossing character 200 cannot leak a prefix.
        for (String secret : secrets.stream().filter(value -> value != null && !value.isEmpty())
                .sorted((a, b) -> Integer.compare(b.length(), a.length())).toList()) {
            summary = summary.replace(secret, "***");
        }
        summary = summary.replaceAll("(?i)(authorization|(?:set-)?cookie|x-csrf-token)[\"']?\\s*[:=][^\\r\\n]*", "$1: ***")
                .replaceAll("(?i)(bearer|basic)\\s+[^\\s\"'<>]+", "$1 ***")
                .replaceAll("[\\r\\n\\t]", " ");
        return summary.isBlank() ? "CPI request failed" : summary.substring(0, Math.min(200, summary.length()));
    }
}
