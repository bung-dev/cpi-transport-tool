package com.company.sap.cpitransport.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("cpi.environments")
public record CpiProperties(@DefaultValue Connection dev, @DefaultValue Connection prd) {
    public enum Environment { DEV, PRD }

    public Connection connection(Environment environment) {
        return switch (environment) {
            case DEV -> dev;
            case PRD -> prd;
        };
    }

    public record Connection(@DefaultValue("") String apiUrl,
                             @DefaultValue("") String tokenUrl,
                             @DefaultValue("") String clientId,
                             @DefaultValue("") String clientSecret) {
        // AI-NOTE: Record-generated toString would expose credentials in diagnostic logs. (근거: REQ-002 AC-6, run 20260928-cpi-transport)
        @Override
        public String toString() {
            return "Connection[redacted]";
        }
    }
}
