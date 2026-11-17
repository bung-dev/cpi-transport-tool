package com.company.sap.cpitransport.config;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("cpi.templates")
public record TemplateProperties(Path storeFile) {
    public TemplateProperties {
        if (storeFile == null) storeFile = Path.of(System.getProperty("user.home"), ".cpi-transport-tool", "templates.json");
    }
}
