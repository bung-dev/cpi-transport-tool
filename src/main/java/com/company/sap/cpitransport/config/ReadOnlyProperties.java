package com.company.sap.cpitransport.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("cpi.transport")
public record ReadOnlyProperties(@DefaultValue("true") boolean readOnly) {}
