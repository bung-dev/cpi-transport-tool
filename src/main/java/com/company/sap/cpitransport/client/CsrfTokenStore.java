package com.company.sap.cpitransport.client;

import com.company.sap.cpitransport.tenant.TenantChangedEvent;
import org.springframework.context.event.EventListener;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

@Component
public class CsrfTokenStore {
    private final ConcurrentHashMap<String, Token> tokens = new ConcurrentHashMap<>();
    public Token getOrFetch(CpiEnvironment environment, Supplier<Token> fetch) {
        return getOrFetch(environment.name(), fetch);
    }
    public Token getOrFetch(String environment, Supplier<Token> fetch) {
        return tokens.computeIfAbsent(environment, ignored -> fetch.get());
    }
    public void invalidate(CpiEnvironment environment) { invalidate(environment.name()); }
    public void invalidate(String environment) { tokens.remove(environment); }
    @EventListener
    public void changed(TenantChangedEvent event) { invalidate(event.tenantId()); }
    public record Token(String value, String cookie) {
        @Override
        public String toString() { return "CsrfToken[redacted]"; }
    }
}
