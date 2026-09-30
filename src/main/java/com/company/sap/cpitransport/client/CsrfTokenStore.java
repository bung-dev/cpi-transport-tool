package com.company.sap.cpitransport.client;

import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

@Component
public class CsrfTokenStore {
    private final ConcurrentHashMap<CpiEnvironment, Token> tokens = new ConcurrentHashMap<>();
    public Token getOrFetch(CpiEnvironment environment, Supplier<Token> fetch) {
        return tokens.computeIfAbsent(environment, ignored -> fetch.get());
    }
    public void invalidate(CpiEnvironment environment) { tokens.remove(environment); }
    public record Token(String value, String cookie) {
        @Override
        public String toString() { return "CsrfToken[redacted]"; }
    }
}
