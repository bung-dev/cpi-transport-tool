package com.company.sap.cpitransport.tenant;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("cpi.tenants")
public record TenantProperties(Path storeFile) {
    public TenantProperties {
        if (storeFile == null) {
            storeFile = Path.of(System.getProperty("user.home"), ".cpi-transport-tool", "tenants.enc");
        }
    }
}
