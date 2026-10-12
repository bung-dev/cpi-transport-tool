package com.company.sap.cpitransport.config;

import java.time.Clock;
import java.util.Optional;
import com.company.sap.cpitransport.tenant.TenantProperties;
import com.company.sap.cpitransport.tenant.TenantStoreKeySource;
import com.company.sap.cpitransport.client.Sleeper;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({CpiProperties.class, TransportProperties.class, TenantProperties.class})
public class AppConfig {
    @Bean
    public TenantStoreKeySource tenantStoreKeySource() {
        // AI-NOTE: REQ-301 AC-5 requires an environment-only key, never a Spring property.
        return () -> Optional.ofNullable(System.getenv("CPI_TENANT_STORE_KEY"));
    }

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    public Sleeper sleeper() {
        return Thread::sleep;
    }
}
