package com.company.sap.cpitransport.service;

import java.util.Locale;
import java.util.Map;
import com.company.sap.cpitransport.config.TransportProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.ResourceLock;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

class SensitiveKeyMatcherTests {
    private SensitiveKeyMatcher matcher(Map<String, Object> settings) {
        var binder = new Binder(new MapConfigurationPropertySource(settings));
        return new SensitiveKeyMatcher(binder.bindOrCreate(
                "cpi.transport", Bindable.of(TransportProperties.class)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"password", "passwd", "pwd", "secret", "token",
            "credential", "privatekey", "apikey", "ClientPassword", "APIKEY", "myApiKeyX"})
    @DisplayName("REQ-012 AC-1: default patterns match case-insensitive substrings")
    void req012_ac1_defaultPatternsAndSubstrings(String key) {
        assertThat(matcher(Map.of()).isSensitive(key)).isTrue();
    }

    @Test
    @DisplayName("REQ-012 AC-1: ordinary and absent keys do not match")
    void req012_ac1_nonSensitiveKeys() {
        var matcher = matcher(Map.of());
        assertThat(matcher.isSensitive("Endpoint")).isFalse();
        assertThat(matcher.isSensitive("")).isFalse();
        assertThat(matcher.isSensitive(null)).isFalse();
    }

    @Test
    @DisplayName("REQ-012 AC-1: configured patterns replace all defaults")
    void req012_ac1_configuredPatternsReplaceDefaults() {
        var matcher = matcher(Map.of("cpi.transport.sensitive-key-patterns", "custom"));
        assertThat(matcher.isSensitive("myCUSTOMkey")).isTrue();
        for (String key : new String[]{"password", "passwd", "pwd", "secret", "token",
                "credential", "privatekey", "apikey"}) {
            assertThat(matcher.isSensitive(key)).as(key).isFalse();
        }
    }

    @Test
    @DisplayName("REQ-012 AC-1: whitespace is trimmed and empty patterns ignored")
    void req012_ac1_trimAndIgnoreEmptyPatterns() {
        var matcher = matcher(Map.of(
                "cpi.transport.sensitive-key-patterns[0]", "  CuStOm\t",
                "cpi.transport.sensitive-key-patterns[1]", "",
                "cpi.transport.sensitive-key-patterns[2]", " \t "));
        assertThat(matcher.isSensitive("myCUSTOMkey")).isTrue();
        assertThat(matcher.isSensitive("Endpoint")).isFalse();
        assertThat(matcher.isSensitive("")).isFalse();
    }

    @Test
    @DisplayName("REQ-012 AC-1: explicitly empty patterns do not restore defaults")
    void req012_ac1_emptyPatternsDisableMatching() {
        var matcher = matcher(Map.of("cpi.transport.sensitive-key-patterns", ""));
        assertThat(matcher.isSensitive("password")).isFalse();
        assertThat(matcher.isSensitive("Endpoint")).isFalse();
    }

    @Test
    @DisplayName("REQ-012 AC-1: patterns are literal substrings rather than regular expressions")
    void req012_ac1_literalPatterns() {
        var matcher = matcher(Map.of("cpi.transport.sensitive-key-patterns", "a.b"));
        assertThat(matcher.isSensitive("prefixA.Bsuffix")).isTrue();
        assertThat(matcher.isSensitive("prefixAXBsuffix")).isFalse();
    }

    @Test
    @ResourceLock("java.util.Locale.default")
    @DisplayName("REQ-012 AC-1: matching uses ROOT locale for both keys and patterns")
    void req012_ac1_localeIndependentMatching() {
        Locale original = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"));
            assertThat(matcher(Map.of()).isSensitive("PRIVATEKEY")).isTrue();
            assertThat(matcher(Map.of("cpi.transport.sensitive-key-patterns", "APIKEY"))
                    .isSensitive("myapikeyX")).isTrue();
        } finally {
            Locale.setDefault(original);
        }
    }
}
