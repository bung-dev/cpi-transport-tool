package com.company.sap.cpitransport.version;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.info.BuildProperties;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class VersionConfiguration {
    private static final Logger log = LoggerFactory.getLogger(VersionConfiguration.class);

    @Bean
    AppVersion appVersion(ObjectProvider<BuildProperties> build) {
        return AppVersion.from(build.getIfAvailable());
    }

    @Bean
    ApplicationListener<ApplicationReadyEvent> logVersionOnStartup(AppVersion version) {
        return event -> log.info(version.startupLine());
    }
}
