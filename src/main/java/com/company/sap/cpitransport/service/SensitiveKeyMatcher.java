package com.company.sap.cpitransport.service;

import java.util.List;
import java.util.Locale;
import com.company.sap.cpitransport.config.TransportProperties;
import org.springframework.stereotype.Service;

@Service
public class SensitiveKeyMatcher {
    private final List<String> patterns;

    public SensitiveKeyMatcher(TransportProperties properties) {
        patterns = properties.sensitiveKeyPatterns().stream()
                .map(String::trim)
                .filter(pattern -> !pattern.isEmpty())
                .map(pattern -> pattern.toLowerCase(Locale.ROOT))
                .toList();
    }

    public boolean isSensitive(String key) {
        // AI-NOTE: The spec does not define null keys; an absent key cannot match.
        if (key == null) {
            return false;
        }
        String normalizedKey = key.toLowerCase(Locale.ROOT);
        return patterns.stream().anyMatch(normalizedKey::contains);
    }
}
