package com.company.sap.cpitransport.config;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("cpi.audit")
public record AuditProperties(Path file) {
    public AuditProperties {
        if (file == null) file = Path.of(System.getProperty("user.home"), ".cpi-transport-tool", "audit.jsonl");
    }
}
