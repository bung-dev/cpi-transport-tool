package com.company.sap.cpitransport.client;

import java.time.Instant;

public record AccessToken(String value, Instant refreshAt) {
    public boolean isUsableAt(Instant now) {
        return now.isBefore(refreshAt);
    }

    // Diagnostic string representations must not expose credentials.
    @Override
    public String toString() {
        return "AccessToken[redacted]";
    }
}
