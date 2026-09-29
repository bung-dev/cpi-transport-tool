package com.company.sap.cpitransport.config;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.Map;
import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.model.EnvironmentNotConfiguredException;
import com.company.sap.cpitransport.service.EnvironmentGuard;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.test.context.support.TestPropertySourceUtils;

import static com.company.sap.cpitransport.config.CpiProperties.Environment.*;
import static org.assertj.core.api.Assertions.*;

class CpiPropertiesTests {
    @TempDir Path tempDir;

    private ApplicationContextRunner context(Map<String, Object> variables, String... overrides) {
        return new ApplicationContextRunner()
                .withInitializer(ctx -> {
                    // AI-NOTE: Isolate binding tests from developer machine credentials.
                    ctx.getEnvironment().getPropertySources().replace("systemEnvironment",
                            new SystemEnvironmentPropertySource("systemEnvironment", variables));
                    new ConfigDataApplicationContextInitializer().initialize(ctx);
                    // Properties syntax treats Windows backslashes as escape characters.
                    String[] escaped = java.util.Arrays.stream(overrides)
                            .map(value -> value.replace("\\", "\\\\")).toArray(String[]::new);
                    TestPropertySourceUtils.addInlinedPropertiesToEnvironment(ctx, escaped);
                })
                .withUserConfiguration(AppConfig.class, EnvironmentGuard.class);
    }

    private Map<String, Object> devVariables() {
        return Map.of("CPI_DEV_API_URL", "http://localhost:18081",
                "CPI_DEV_TOKEN_URL", "http://localhost:18081/oauth/token",
                "CPI_DEV_CLIENT_ID", "dummy-dev-client", "CPI_DEV_CLIENT_SECRET", "dummy-dev-secret");
    }

    @Test
    @DisplayName("REQ-002 AC-2: empty environment starts and reports all four DEV keys")
    void req002_ac2_emptyEnvironmentStarts() {
        context(Map.of()).run(ctx -> {
            assertThat(ctx).hasNotFailed();
            assertThat(ctx.getBean(EnvironmentGuard.class).missingKeys(DEV)).containsExactly(
                    "cpi.environments.dev.api-url", "cpi.environments.dev.token-url",
                    "cpi.environments.dev.client-id", "cpi.environments.dev.client-secret");
            assertThat(ctx.getBean(Clock.class).getZone()).isEqualTo(ZoneOffset.UTC);
            assertThat(ctx.getBean(Sleeper.class)).isNotNull();
        });
    }

    @Test
    @DisplayName("REQ-002 AC-1: all eight named environment variables bind independently")
    void req002_ac1_environmentPlaceholdersBind() {
        var variables = new java.util.HashMap<>(devVariables());
        variables.putAll(Map.of("CPI_PRD_API_URL", "http://localhost:18082",
                "CPI_PRD_TOKEN_URL", "http://localhost:18082/oauth/token",
                "CPI_PRD_CLIENT_ID", "dummy-prd-client", "CPI_PRD_CLIENT_SECRET", "dummy-prd-secret"));
        context(variables).run(ctx -> {
            var properties = ctx.getBean(CpiProperties.class);
            assertThat(properties.dev()).isEqualTo(new CpiProperties.Connection(
                    "http://localhost:18081", "http://localhost:18081/oauth/token", "dummy-dev-client", "dummy-dev-secret"));
            assertThat(properties.prd()).isEqualTo(new CpiProperties.Connection(
                    "http://localhost:18082", "http://localhost:18082/oauth/token", "dummy-prd-client", "dummy-prd-secret"));
            assertThat(ctx.getBean(EnvironmentGuard.class).missingKeys(DEV)).isEmpty();
            assertThat(ctx.getBean(EnvironmentGuard.class).missingKeys(PRD)).isEmpty();
            assertThat(properties.toString()).doesNotContain("dummy-dev-secret", "dummy-prd-secret");
        });
    }

    @Test
    @DisplayName("REQ-002 AC-2: configured DEV does not require PRD")
    void req002_ac2_onlyPrdMissing() {
        context(devVariables()).run(ctx -> {
            var guard = ctx.getBean(EnvironmentGuard.class);
            assertThat(guard.missingKeys(DEV)).isEmpty();
            assertThat(guard.missingKeys(PRD)).containsExactly("cpi.environments.prd.api-url",
                    "cpi.environments.prd.token-url", "cpi.environments.prd.client-id", "cpi.environments.prd.client-secret");
        });
    }

    @Test
    @DisplayName("REQ-002 AC-2: one blank value yields only its key in the exception")
    void req002_ac2_oneMissingKeyWithoutValues() {
        context(devVariables(), "cpi.environments.dev.client-id=  ").run(ctx -> {
            var missing = ctx.getBean(EnvironmentGuard.class).missingKeys(DEV);
            assertThat(missing).containsExactly("cpi.environments.dev.client-id");
            var exception = new EnvironmentNotConfiguredException(missing);
            assertThat(exception.getMessage()).isEqualTo("cpi.environments.dev.client-id");
            assertThat(exception.missingKeys()).containsExactlyElementsOf(missing);
            assertThatThrownBy(() -> exception.missingKeys().add("x")).isInstanceOf(UnsupportedOperationException.class);
        });
    }

    @Test
    @DisplayName("REQ-006 AC-4: mapping path defaults to empty")
    void req006_ac4_emptyMappingDefault() {
        context(Map.of()).run(ctx -> assertThat(ctx.getBean(TransportProperties.class).mappingFile()).isEmpty());
    }

    @Test
    @DisplayName("REQ-011 AC-1: history defaults outside repository under user home")
    void req011_ac1_historyDefault() {
        context(Map.of()).run(ctx -> assertThat(ctx.getBean(TransportProperties.class).history().file())
                .isEqualTo(Path.of(System.getProperty("user.home"), ".cpi-transport-tool", "transport-history.jsonl")));
    }

    @Test
    @DisplayName("REQ-003 AC-3: retry defaults to three attempts and one second")
    void req003_ac3_retryDefaults() {
        context(Map.of()).run(ctx -> {
            var retry = ctx.getBean(TransportProperties.class).retry();
            assertThat(retry.maxAttempts()).isEqualTo(3);
            assertThat(retry.initialBackoff()).isEqualTo(Duration.ofSeconds(1));
        });
    }

    @Test
    @DisplayName("REQ-009 AC-1: deployment defaults to five second polling and 300 second timeout")
    void req009_ac1_deployDefaults() {
        context(Map.of()).run(ctx -> {
            var deploy = ctx.getBean(TransportProperties.class).deploy();
            assertThat(deploy.pollInterval()).isEqualTo(Duration.ofSeconds(5));
            assertThat(deploy.timeout()).isEqualTo(Duration.ofSeconds(300));
        });
    }

    @Test
    @DisplayName("REQ-012 AC-1: all eight default sensitive patterns bind")
    void req012_ac1_sensitiveDefaults() {
        context(Map.of()).run(ctx -> assertThat(ctx.getBean(TransportProperties.class).sensitiveKeyPatterns())
                .containsExactly("password", "passwd", "pwd", "secret", "token", "credential", "privatekey", "apikey"));
    }

    @Test
    @DisplayName("REQ-003 AC-3: explicit transport settings override defaults")
    void req003_ac3_transportOverrides() {
        Path history = tempDir.resolve("history.jsonl");
        Path mapping = tempDir.resolve("mapping.yml");
        context(Map.of(), "cpi.transport.mapping-file=" + mapping,
                "cpi.transport.history.file=" + history,
                "cpi.transport.retry.max-attempts=5", "cpi.transport.retry.initial-backoff=250ms",
                "cpi.transport.deploy.poll-interval=2s", "cpi.transport.deploy.timeout=20s",
                "cpi.transport.sensitive-key-patterns=password,token").run(ctx -> {
            var properties = ctx.getBean(TransportProperties.class);
            assertThat(properties.mappingFile()).isEqualTo(mapping.toString());
            assertThat(properties.history().file()).isEqualTo(history);
            assertThat(properties.retry().maxAttempts()).isEqualTo(5);
            assertThat(properties.retry().initialBackoff()).isEqualTo(Duration.ofMillis(250));
            assertThat(properties.deploy().pollInterval()).isEqualTo(Duration.ofSeconds(2));
            assertThat(properties.deploy().timeout()).isEqualTo(Duration.ofSeconds(20));
            assertThat(properties.sensitiveKeyPatterns()).containsExactly("password", "token");
        });
    }
}
