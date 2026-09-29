package com.company.sap.cpitransport.client;

import java.time.Instant;

public record AccessToken(String value, Instant refreshAt) {
    public boolean isUsableAt(Instant now) {
        return now.isBefore(refreshAt);
    }

    // AI-NOTE: Diagnostic string representations must not expose credentials. (근거: REQ-002 AC-6, run 20260928-cpi-transport)
    @Override
    public String toString() {
        return "AccessToken[redacted]";
    }
}
