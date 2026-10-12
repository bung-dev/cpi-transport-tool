package com.company.sap.cpitransport.service;

import java.net.http.HttpClient;
import java.time.*;
import java.util.concurrent.*;
import com.company.sap.cpitransport.config.ReadOnlyProperties;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.model.TenantStatusResponse;
import com.company.sap.cpitransport.model.TenantStatusResponse.Check;
import com.company.sap.cpitransport.tenant.*;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class TenantStatusService {
    private final TenantRegistry registry;
    private final ReadOnlyProperties readOnly;
    private final Clock clock;
    private final Duration limit;
    private final ObjectMapper json;
    private final RestClient client;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final ConcurrentHashMap<String, Entry> cache = new ConcurrentHashMap<>();
    private record Entry(CompletableFuture<Check> result, Instant started) {}
    @Autowired
    public TenantStatusService(TenantRegistry registry, ReadOnlyProperties readOnly, Clock clock, ObjectMapper json) {
        this(registry, readOnly, clock, json, Duration.ofSeconds(10));
    }
    TenantStatusService(TenantRegistry registry, ReadOnlyProperties readOnly, Clock clock,
                        ObjectMapper json, Duration limit) {
        this.registry = registry; this.readOnly = readOnly; this.clock = clock;
        this.json = json; this.limit = limit;
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .connectTimeout(limit).followRedirects(HttpClient.Redirect.NEVER).build());
        factory.setReadTimeout(limit);
        client = RestClient.builder().requestFactory(factory).build();
    }
    @PreDestroy public void close() { executor.shutdownNow(); }
    @EventListener public void changed(TenantChangedEvent event) { cache.remove(event.tenantId()); }
    public TenantStatusResponse status(String tenantId, boolean refresh) {
        var views = registry.list();
        if (tenantId != null) {
            views = views.stream().filter(t -> t.id().equals(tenantId)).toList();
            if (views.isEmpty()) throw new ApiException(Code.TENANT_NOT_FOUND, 400, "Tenant not found");
        }
        // AI-NOTE: start all checks before joining to preserve order and parallelism (REQ-303 AC-3).
        var results = views.stream().map(view -> {
            var entry = cache.compute(view.id(), (id, old) -> {
                if (!refresh && old != null && clock.instant().isBefore(old.started().plusSeconds(60))) return old;
                var tenant = registry.find(id).orElseThrow(
                        () -> new ApiException(Code.TENANT_NOT_FOUND, 400, "Tenant not found"));
                var result = new CompletableFuture<Check>();
                var task = executor.submit(() -> result.complete(probe(tenant)));
                result.completeOnTimeout(Check.UNREACHABLE, limit.toMillis(), TimeUnit.MILLISECONDS);
                result.whenComplete((check, failure) -> task.cancel(true));
                return new Entry(result, clock.instant());
            });
            return entry.result().thenApply(check -> new TenantStatusResponse.Item(view.id(), view.name(),
                    view.source(), view.apiHost(), check));
        }).toList();
        return new TenantStatusResponse(readOnly.readOnly(), results.stream().map(CompletableFuture::join).toList());
    }
    private Check probe(TenantRegistry.Tenant tenant) {
        String token;
        try {
            token = client.post().uri(tenant.tokenUrl()).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .headers(h -> h.setBasicAuth(tenant.clientId(), tenant.clientSecret()))
                    .body("grant_type=client_credentials").exchange((request, response) -> {
                        if (!response.getStatusCode().is2xxSuccessful()) return null;
                        JsonNode body = json.readTree(response.getBody());
                        if (body == null || !body.path("access_token").isString()
                                || body.path("access_token").asString().isBlank()
                                || !body.path("expires_in").isIntegralNumber()
                                || !body.path("expires_in").canConvertToLong()
                                || body.path("expires_in").asLong() <= 0) return null;
                        return body.path("access_token").asString();
                    });
        } catch (ResourceAccessException ignored) { return Check.UNREACHABLE; }
        catch (RuntimeException ignored) { return Check.TOKEN_FAILED; }
        if (token == null) return Check.TOKEN_FAILED;
        try {
            String base = tenant.apiUrl().replaceAll("/+$", "");
            if (!base.endsWith("/api/v1")) base += "/api/v1";
            return client.get().uri(base + "/IntegrationPackages?$top=1")
                    .headers(h -> h.setBearerAuth(token)).accept(MediaType.APPLICATION_JSON)
                    .exchange((request, response) -> {
                        int status = response.getStatusCode().value();
                        if (status == 401 || status == 403) return Check.API_FORBIDDEN;
                        if (!response.getStatusCode().is2xxSuccessful()) return Check.ERROR;
                        JsonNode body = json.readTree(response.getBody());
                        return body != null && body.path("d").path("results").isArray() ? Check.OK : Check.ERROR;
                    });
        } catch (ResourceAccessException ignored) { return Check.UNREACHABLE; }
        catch (RuntimeException ignored) { return Check.ERROR; }
        // AI-NOTE: discard failure messages, bodies and causes (REQ-305 AC-3).
    }
}
