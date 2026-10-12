package com.company.sap.cpitransport.tenant;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.model.TenantListResponse;
import com.company.sap.cpitransport.model.TenantView;
import com.company.sap.cpitransport.service.EnvironmentGuard;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
public class TenantRegistry {
    public record Tenant(String id, String name, String source, String apiUrl, String tokenUrl,
                         String clientId, String clientSecret, Instant createdAt) {
        public CpiProperties.Connection connection() {
            return new CpiProperties.Connection(apiUrl, tokenUrl, clientId, clientSecret);
        }
        public TenantView view() {
            String host;
            try { host = URI.create(apiUrl).getHost(); }
            catch (IllegalArgumentException ignored) { host = null; }
            return new TenantView(id, name, source, host, createdAt);
        }
        @Override public String toString() { return "Tenant[credentials=***]"; }
    }

    private final CpiProperties properties;
    private final EncryptedTenantStore store;
    private final Clock clock;
    private final ApplicationEventPublisher events;
    private final List<Tenant> initial;
    private final ServiceKeyParser parser = new ServiceKeyParser();
    private StoreStatus status;
    private List<StoredTenant> registered;

    public TenantRegistry(CpiProperties properties, EncryptedTenantStore store, Clock clock,
                          ApplicationEventPublisher events) {
        this.properties = properties;
        this.store = store;
        this.clock = clock;
        this.events = events;
        List<Tenant> initial = new ArrayList<>();
        for (var environment : CpiProperties.Environment.values()) {
            if (missingKeys(environment).isEmpty()) {
                var c = properties.connection(environment);
                initial.add(new Tenant(environment.name(), environment.name(), "env",
                        c.apiUrl(), c.tokenUrl(), c.clientId(), c.clientSecret(), null));
            }
        }
        this.initial = List.copyOf(initial);
        var snapshot = store == null ? new EncryptedTenantStore.Snapshot(StoreStatus.NOT_CONFIGURED, List.of())
                : store.read();
        status = snapshot.status();
        registered = status == StoreStatus.OK ? snapshot.tenants() : List.of();
    }

    public static TenantRegistry initial(CpiProperties properties) {
        return new TenantRegistry(properties, null, Clock.systemUTC(), event -> {});
    }

    public List<String> missingKeys(CpiProperties.Environment environment) {
        return EnvironmentGuard.missingKeys(properties, environment);
    }

    public synchronized StoreStatus storeStatus() { return status; }
    public synchronized Optional<Tenant> find(String id) {
        return tenants().stream().filter(t -> t.id().equals(id)).findFirst();
    }
    public synchronized List<TenantView> list() { return tenants().stream().map(Tenant::view).toList(); }
    public synchronized TenantListResponse snapshot() { return new TenantListResponse(status, list()); }

    private List<Tenant> tenants() {
        List<Tenant> result = new ArrayList<>(initial);
        for (var t : registered) result.add(new Tenant(t.id(), t.name(), "registered", t.apiUrl(),
                t.tokenUrl(), t.clientId(), t.clientSecret(), t.createdAt()));
        return result;
    }

    public synchronized TenantView register(JsonNode body) {
        object(body);
        writable();
        String name = name(body.get("name"));
        ServiceKey key = key(body.get("serviceKey"));
        unique(name, null);
        String id;
        do { id = UUID.randomUUID().toString(); } while (find(id).isPresent());
        var tenant = new StoredTenant(id, name, key.apiUrl(), key.tokenUrl(), key.clientId(),
                key.clientSecret(), clock.instant());
        List<StoredTenant> next = new ArrayList<>(registered);
        next.add(tenant);
        persist(next);
        return find(id).orElseThrow().view();
    }

    public TenantView update(String id, JsonNode body) { return update(id, () -> body); }

    public TenantView update(String id, Supplier<JsonNode> bodyReader) {
        TenantView view = updateStored(id, bodyReader);
        // AI-NOTE: publish outside the registry monitor; cache fetches resolve tenants while locked (REQ-301 AC-4).
        events.publishEvent(new TenantChangedEvent(id));
        return view;
    }

    private synchronized TenantView updateStored(String id, Supplier<JsonNode> bodyReader) {
        StoredTenant previous = mutable(id);
        // AI-NOTE: defer reading PUT bodies until env/store/id checks (REQ-301 AC-4·AC-6).
        JsonNode body = bodyReader.get();
        object(body);
        if (!body.has("name") && !body.has("serviceKey")) throw new ApiException(Code.INVALID_REQUEST);
        String name = body.has("name") ? name(body.get("name")) : previous.name();
        ServiceKey key = body.has("serviceKey") ? key(body.get("serviceKey"))
                : new ServiceKey(previous.apiUrl(), previous.tokenUrl(), previous.clientId(), previous.clientSecret());
        unique(name, id);
        var replacement = new StoredTenant(id, name, key.apiUrl(), key.tokenUrl(), key.clientId(),
                key.clientSecret(), previous.createdAt());
        List<StoredTenant> next = new ArrayList<>(registered);
        next.set(next.indexOf(previous), replacement);
        persist(next);
        return find(id).orElseThrow().view();
    }

    public void delete(String id) {
        deleteStored(id);
        events.publishEvent(new TenantChangedEvent(id));
    }

    private synchronized void deleteStored(String id) {
        StoredTenant previous = mutable(id);
        List<StoredTenant> next = new ArrayList<>(registered);
        next.remove(previous);
        persist(next);
    }

    private StoredTenant mutable(String id) {
        if (initial.stream().anyMatch(t -> t.id().equals(id))) throw new ApiException(Code.TENANT_READ_ONLY);
        writable();
        return registered.stream().filter(t -> t.id().equals(id)).findFirst()
                .orElseThrow(() -> new ApiException(Code.TENANT_NOT_FOUND));
    }
    private void writable() {
        if (status != StoreStatus.OK) throw new ApiException(status == StoreStatus.NOT_CONFIGURED
                ? Code.TENANT_STORE_NOT_CONFIGURED : Code.TENANT_STORE_UNREADABLE);
    }
    private void persist(List<StoredTenant> next) {
        try { store.write(next); }
        catch (IllegalStateException ignored) {
            // AI-NOTE: never propagate storage causes or content (REQ-305 AC-3).
            StoreStatus observed = store.read().status();
            status = observed == StoreStatus.NOT_CONFIGURED ? observed : StoreStatus.UNREADABLE;
            throw new ApiException(status == StoreStatus.NOT_CONFIGURED
                    ? Code.TENANT_STORE_NOT_CONFIGURED : Code.TENANT_STORE_UNREADABLE);
        }
        registered = List.copyOf(next);
    }
    private static void object(JsonNode body) {
        if (body == null || !body.isObject()) throw new ApiException(Code.INVALID_REQUEST);
    }
    private static String name(JsonNode node) {
        if (node == null || !node.isString()) throw new ApiException(Code.INVALID_REQUEST);
        String name = node.asString().strip();
        int count = name.codePointCount(0, name.length());
        if (count < 1 || count > 40) throw new ApiException(Code.INVALID_REQUEST);
        return name;
    }
    private ServiceKey key(JsonNode node) {
        try { return parser.parse(node); }
        catch (InvalidServiceKeyException failure) {
            throw new ApiException(Code.INVALID_SERVICE_KEY, 400, failure.getMessage());
        }
    }
    private void unique(String name, String exceptId) {
        String folded = name.toLowerCase(Locale.ROOT);
        if (tenants().stream().anyMatch(t -> !t.id().equals(exceptId)
                && t.name().toLowerCase(Locale.ROOT).equals(folded))) {
            throw new ApiException(Code.TENANT_NAME_DUPLICATE);
        }
    }
}
