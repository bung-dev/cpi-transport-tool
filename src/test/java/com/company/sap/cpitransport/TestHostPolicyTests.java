package com.company.sap.cpitransport;

import java.net.URI;
import java.nio.charset.MalformedInputException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TestHostPolicyTests {
    // AI-NOTE: REQ-015 AC-4 forbids connections, not identifier URIs. These exact BPMN namespace and
    // JAXP feature identifiers are never fetched; SecureXml disables external DTD/entity access.
    // Domain-wide exemptions are forbidden. (근거: D-041, REQ-015 AC-4, run 20260928-cpi-transport)
    private static final Set<String> IDENTIFIER_URIS = Set.of(
            "http://www.omg.org/spec/BPMN/20100524/MODEL",
            "http://apache.org/xml/features/disallow-doctype-decl");

    // Match URLs with an authority; the hostless SAP XML namespace is not a connection URL.
    private static final Pattern URL = Pattern.compile("https?://(?!/)[^\\s\"'<>\\\\]+",
            Pattern.CASE_INSENSITIVE);

    @Test
    @DisplayName("REQ-015 AC-4: test sources fixtures and examples use only localhost connection URLs")
    void req015_ac4_onlyLocalhostConnectionUrls() throws Exception {
        var violations = new ArrayList<String>();
        int checkedUrls = 0;
        for (String root : List.of("src/test/java", "src/test/resources", "examples")) {
            assertThat(Files.isDirectory(Path.of(root))).as("scan root %s", root).isTrue();
            try (var paths = Files.walk(Path.of(root))) {
                for (Path path : paths.filter(Files::isRegularFile).sorted().toList()) {
                    String content;
                    try {
                        content = Files.readString(path);
                    } catch (MalformedInputException binaryFile) {
                        // Repository text fixtures are UTF-8; binary files are outside this text scan.
                        continue;
                    }
                    var matcher = URL.matcher(content);
                    while (matcher.find()) {
                        checkedUrls++;
                        String url = matcher.group();
                        if (IDENTIFIER_URIS.contains(url)) {
                            continue;
                        }
                        String host;
                        try {
                            host = URI.create(url).getHost();
                        } catch (IllegalArgumentException malformedUrl) {
                            host = null;
                        }
                        if (host == null || !(host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1")
                                || host.toLowerCase(Locale.ROOT).endsWith(".localhost"))) {
                            long line = content.substring(0, matcher.start()).chars().filter(c -> c == '\n').count() + 1;
                            violations.add(path + ":" + line + ": " + url);
                        }
                    }
                }
            }
        }
        assertThat(checkedUrls).as("URLs were found in the scan roots").isPositive();
        assertThat(violations).as("non-localhost connection URLs").isEmpty();
    }
}
