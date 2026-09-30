package com.company.sap.cpitransport.client;

import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.config.CpiProperties.Environment;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.EnvironmentNotConfiguredException;
import com.company.sap.cpitransport.service.EnvironmentGuard;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;

@Component
public class OAuthTokenProvider {
    private final CpiProperties properties;
    private final Clock clock;
    private final RestClient client;
    private final RetryExecutor retry;
    private final ConcurrentHashMap<Environment, AccessToken> tokens = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Environment, Object> locks = new ConcurrentHashMap<>();

    public OAuthTokenProvider(CpiProperties properties, TransportProperties transport,
                              Clock clock, Sleeper sleeper) {
        this.properties = properties;
        this.clock = clock;
        this.retry = new RetryExecutor(transport.retry(), sleeper);
        this.client = RestClient.builder().requestFactory(new JdkClientHttpRequestFactory()).build();
    }

    public String getToken(Environment environment) {
        synchronized (locks.computeIfAbsent(environment, ignored -> new Object())) {
            var missing = new EnvironmentGuard(properties).missingKeys(environment);
            if (!missing.isEmpty()) {
                throw new EnvironmentNotConfiguredException(missing);
            }
            var cached = tokens.get(environment);
            if (cached != null && cached.isUsableAt(clock.instant())) {
                return cached.value();
            }
            var token = retry.execute(() -> requestToken(environment));
            tokens.put(environment, token);
            return token.value();
        }
    }

    public void invalidate(Environment environment) {
        synchronized (locks.computeIfAbsent(environment, ignored -> new Object())) {
            tokens.remove(environment);
        }
    }

    private AccessToken requestToken(Environment environment) {
        var connection = properties.connection(environment);
        // AI-NOTE: Request-start time conservatively avoids extending validity by network latency. (근거: REQ-002 AC-4, run 20260928-cpi-transport)
        var issuedAt = clock.instant();
        try {
            JsonNode body = client.post().uri(connection.tokenUrl())
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .headers(headers -> headers.setBasicAuth(connection.clientId(), connection.clientSecret()))
                    .body("grant_type=client_credentials")
                    .retrieve()
                    .onStatus(status -> !status.is2xxSuccessful(), (request, response) -> {
                        throw new TokenRequestException(response.getStatusCode().value());
                    })
                    .body(JsonNode.class);
            if (body == null || !body.path("access_token").isString()
                    || body.path("access_token").asString().isBlank()
                    || !body.path("expires_in").isIntegralNumber()
                    || !body.path("expires_in").canConvertToLong()
                    || body.path("expires_in").asLong() <= 0) {
                throw new TokenRequestException(null);
            }
            return new AccessToken(body.path("access_token").asString(),
                    issuedAt.plusSeconds(body.path("expires_in").asLong()).minusSeconds(60));
        } catch (TokenRequestException | ResourceAccessException failure) {
            throw failure;
        } catch (RuntimeException failure) {
            // AI-NOTE: Parser/URI errors may contain secrets; discard their messages and causes. (근거: REQ-002 AC-6, run 20260928-cpi-transport)
            throw new TokenRequestException(null);
        }
    }

    public static final class TokenRequestException extends RuntimeException {
        private final Integer httpStatus;

        public TokenRequestException(Integer httpStatus) {
            super("Token request failed (HTTP status: " + (httpStatus == null ? "unavailable" : httpStatus) + ")");
            this.httpStatus = httpStatus;
        }

        public Integer httpStatus() {
            return httpStatus;
        }
    }

    // Nested retry helper, reusable by other callers.
    public static final class RetryExecutor {
        private final TransportProperties.Retry settings;
        private final Sleeper sleeper;

        public RetryExecutor(TransportProperties.Retry settings, Sleeper sleeper) {
            if (settings.maxAttempts() < 1 || settings.initialBackoff().isNegative()) {
                throw new IllegalArgumentException("Invalid retry settings");
            }
            this.settings = settings;
            this.sleeper = sleeper;
        }

        public <T> T execute(Supplier<T> action) {
            Duration delay = settings.initialBackoff();
            for (int attempt = 1; ; attempt++) {
                try {
                    return action.get();
                } catch (TokenRequestException failure) {
                    Integer status = failure.httpStatus();
                    if (attempt >= settings.maxAttempts() || status == null
                            || (status != 429 && (status < 500 || status > 599))) {
                        throw failure;
                    }
                } catch (ResourceAccessException failure) {
                    if (attempt >= settings.maxAttempts()) {
                        throw new TokenRequestException(null);
                    }
                }
                try {
                    sleeper.sleep(delay);
                } catch (InterruptedException failure) {
                    Thread.currentThread().interrupt();
                    throw new TokenRequestException(null);
                }
                if (attempt < settings.maxAttempts() - 1) {
                    delay = delay.multipliedBy(2);
                }
            }
        }
    }
}