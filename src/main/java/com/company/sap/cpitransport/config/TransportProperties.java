package com.company.sap.cpitransport.config;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("cpi.transport")
public record TransportProperties(
        @DefaultValue("") String mappingFile,
        @DefaultValue History history,
        @DefaultValue Retry retry,
        @DefaultValue Deploy deploy,
        @DefaultValue({"password", "passwd", "pwd", "secret", "token", "credential", "privatekey", "apikey"})
        List<String> sensitiveKeyPatterns) {
    public TransportProperties {
        sensitiveKeyPatterns = List.copyOf(sensitiveKeyPatterns);
    }

    public record History(Path file) {
        public History {
            if (file == null) {
                file = Path.of(System.getProperty("user.home"), ".cpi-transport-tool", "transport-history.jsonl");
            }
        }
    }

    public record Retry(@DefaultValue("3") int maxAttempts,
                        @DefaultValue("1s") Duration initialBackoff) {}

    public record Deploy(@DefaultValue("5s") Duration pollInterval,
                         @DefaultValue("300s") Duration timeout) {}
}
