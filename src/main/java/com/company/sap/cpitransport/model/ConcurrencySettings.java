package com.company.sap.cpitransport.model;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("cpi.transport")
public record ConcurrencySettings(@DefaultValue("4") int previewConcurrency,
                                  @DefaultValue("4") int transportConcurrency) {
    public ConcurrencySettings {
        validate("cpi.transport.preview-concurrency", previewConcurrency);
        validate("cpi.transport.transport-concurrency", transportConcurrency);
    }

    private static void validate(String property, int value) {
        if (value < 1 || value > 8) throw new IllegalArgumentException(property + " must be between 1 and 8");
    }
}
