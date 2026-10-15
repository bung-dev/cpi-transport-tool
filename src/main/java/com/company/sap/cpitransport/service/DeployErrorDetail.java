package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.CpiHttpExecutor;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.regex.Pattern;

public final class DeployErrorDetail {
    private DeployErrorDetail() {}

    public static String mask(byte[] body, List<String> secrets, String apiUrl, String tokenUrl,
                              List<String> sensitiveValues) {
        String value = body == null ? "" : new String(body, StandardCharsets.UTF_8).strip();
        if (value.isBlank()) return null;
        value = CpiHttpExecutor.maskSecrets(value, secrets);
        value = CpiHttpExecutor.maskAuthentication(value);
        value = value.replaceAll("eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+", "***");
        value = maskSubdomain(value, apiUrl);
        value = maskSubdomain(value, tokenUrl);
        value = CpiHttpExecutor.maskSecrets(value, sensitiveValues);
        // AI-NOTE: Mask the whole body before code-point truncation (REQ-309 AC-4, D-089).
        return value.codePointCount(0, value.length()) > 4000
                ? value.substring(0, value.offsetByCodePoints(0, 4000)) + "…(잘림)" : value;
    }

    private static String maskSubdomain(String value, String url) {
        if (url == null) return value;
        String host = URI.create(url).getHost();
        if (host == null || host.indexOf(':') >= 0 || host.matches("[0-9.]+")
                || host.chars().filter(c -> c == '.').count() < 2) return value;
        String label = host.substring(0, host.indexOf('.'));
        return Pattern.compile(Pattern.quote(label), Pattern.CASE_INSENSITIVE)
                .matcher(value).replaceAll("<subdomain>");
    }
}
