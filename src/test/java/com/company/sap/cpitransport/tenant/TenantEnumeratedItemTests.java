package com.company.sap.cpitransport.tenant;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Stream;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import com.company.sap.cpitransport.config.CpiProperties;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import static org.assertj.core.api.Assertions.*;

// REQ-314 AC-1·AC-2: one test per enumerated item so the test name shows the item (dummy values only).
@ExtendWith(OutputCaptureExtension.class)
class TenantEnumeratedItemTests {
    private static final String WARNING = "tokenurl에 /oauth/token을 붙였습니다";
    @TempDir Path directory;
    private final ObjectMapper json = new ObjectMapper();
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-20T00:00:00Z"), ZoneOffset.UTC);
    private final CpiProperties.Connection empty = new CpiProperties.Connection("", "", "", "");

    private static String key() {
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }
    private Path file() { return directory.resolve("tenants.enc"); }
    private EncryptedTenantStore store(String key) {
        return new EncryptedTenantStore(file(), () -> Optional.of(key), json);
    }
    private TenantRegistry registry(String key) {
        return new TenantRegistry(new CpiProperties(empty, empty), store(key), clock, event -> {});
    }
    private ObjectNode serviceKey(String tokenUrl, String client, String secret) {
        ObjectNode key = json.createObjectNode();
        key.putObject("oauth").put("url", "https://tenant.example.localhost")
                .put("tokenurl", tokenUrl).put("clientid", client).put("clientsecret", secret);
        return key;
    }
    private ObjectNode body(String name, ObjectNode serviceKey) {
        ObjectNode node = json.createObjectNode().put("name", name);
        node.set("serviceKey", serviceKey);
        return node;
    }
    private ObjectNode patch(ObjectNode serviceKey) {
        ObjectNode node = json.createObjectNode();
        node.set("serviceKey", serviceKey);
        return node;
    }
    private static boolean containsBytes(byte[] haystack, byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= haystack.length; i++) {
            for (int j = 0; j < needle.length; j++) if (haystack[i + j] != needle[j]) continue outer;
            return true;
        }
        return false;
    }

    @Test
    @DisplayName("REQ-301 AC-5: stored file bytes contain no plaintext dummy clientid or clientsecret")
    void req301_ac5_noPlaintextCredentials() throws Exception {
        String key = key();
        var registry = registry(key);
        List<byte[]> written = new ArrayList<>();
        var first = registry.register(body("First", serviceKey("https://auth.example.localhost/oauth/token",
                "test-dummy-item-client-1", "test-dummy-item-secret-1")));
        written.add(Files.readAllBytes(file()));
        registry.register(body("Second", serviceKey("https://auth.example.localhost/oauth/token",
                "test-dummy-item-client-2", "test-dummy-item-secret-2")));
        written.add(Files.readAllBytes(file()));
        registry.update(first.id(), patch(serviceKey("https://auth.example.localhost/oauth/token",
                "test-dummy-item-client-3", "test-dummy-item-secret-3")));
        written.add(Files.readAllBytes(file()));
        assertThat(store(key).read().tenants()).extracting(StoredTenant::clientId, StoredTenant::clientSecret)
                .containsExactly(tuple("test-dummy-item-client-3", "test-dummy-item-secret-3"),
                        tuple("test-dummy-item-client-2", "test-dummy-item-secret-2"));
        for (byte[] bytes : written) {
            for (String plain : List.of("test-dummy-item-client-1", "test-dummy-item-secret-1", "test-dummy-item-client-2",
                    "test-dummy-item-secret-2", "test-dummy-item-client-3", "test-dummy-item-secret-3",
                    "test-dummy", "clientId", "clientSecret", key)) {
                assertThat(containsBytes(bytes, plain.getBytes(StandardCharsets.UTF_8))).as(plain).isFalse();
                assertThat(containsBytes(bytes, plain.getBytes(StandardCharsets.UTF_16BE))).as(plain).isFalse();
            }
            assertThat(new String(bytes, StandardCharsets.ISO_8859_1)).startsWith("CTS1")
                    .doesNotContain("test-dummy-item-client", "test-dummy-item-secret");
        }
    }

    @Test
    @DisplayName("REQ-301 AC-5: every write uses a fresh 12 bytes nonce (AES-GCM nonce length 12, distinct per write)")
    void req301_ac5_freshTwelveByteNonce() throws Exception {
        String key = key();
        byte[] raw = Base64.getDecoder().decode(key);
        byte[] magic = "CTS1".getBytes(StandardCharsets.US_ASCII);
        var store = store(key);
        var tenants = List.of(new StoredTenant("registered-1", "Demo", "https://api.example.localhost",
                "https://auth.example.localhost/oauth/token", "test-dummy-client", "test-dummy-secret",
                Instant.parse("2026-10-20T00:00:00Z")));
        Set<String> nonces = new HashSet<>();
        int writes = 8;
        for (int i = 0; i < writes; i++) {
            store.write(tenants);
            byte[] bytes = Files.readAllBytes(file());
            assertThat(Arrays.copyOf(bytes, 4)).isEqualTo(magic);
            byte[] nonce = Arrays.copyOfRange(bytes, 4, 16);
            assertThat(nonce).hasSize(12).isNotEqualTo(new byte[12]);
            nonces.add(HexFormat.of().formatHex(nonce));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(raw, "AES"), new GCMParameterSpec(128, nonce));
            cipher.updateAAD(magic);
            byte[] plain = cipher.doFinal(bytes, 16, bytes.length - 16);
            assertThat(new String(plain, StandardCharsets.UTF_8)).contains("registered-1", "test-dummy-client");
            assertThat(bytes).hasSize(4 + 12 + plain.length + 16);
            Cipher wider = Cipher.getInstance("AES/GCM/NoPadding");
            wider.init(Cipher.DECRYPT_MODE, new SecretKeySpec(raw, "AES"),
                    new GCMParameterSpec(128, Arrays.copyOfRange(bytes, 4, 20)));
            wider.updateAAD(magic);
            assertThatThrownBy(() -> wider.doFinal(bytes, 20, bytes.length - 20)).isInstanceOf(AEADBadTagException.class);
        }
        assertThat(nonces).hasSize(writes);
        assertThat(store(key).read().tenants()).isEqualTo(tenants);
    }

    static Stream<String> suffixedTokenUrls() {
        return Stream.of("https://auth.example.localhost/oauth/token", "https://auth.example.localhost/tenant-a/oauth/token",
                "http://localhost:1/oauth/token", "http://127.0.0.1:1/oauth/token");
    }

    @ParameterizedTest(name = "REQ-301 AC-2: tokenurl already ending with /oauth/token is kept unchanged without warning {0}")
    @MethodSource("suffixedTokenUrls")
    @DisplayName("REQ-301 AC-2: tokenurl already ending with /oauth/token is kept unchanged without warning")
    void req301_ac2_suffixKept(String tokenUrl, CapturedOutput output) {
        ServiceKey parsed = new ServiceKeyParser().parse(serviceKey(tokenUrl, "test-dummy-client", "test-dummy-secret"));
        assertThat(parsed.tokenUrl()).isEqualTo(tokenUrl);
        var registry = registry(key());
        var view = registry.register(body("Suffix", serviceKey(tokenUrl, "test-dummy-client", "test-dummy-secret")));
        assertThat(registry.find(view.id()).orElseThrow().tokenUrl()).isEqualTo(tokenUrl);
        assertThat(output.getAll()).doesNotContain(WARNING);
    }

    @Test
    @DisplayName("REQ-305 AC-3: tenant registry path logs never contain service key clientid or clientsecret (masking)")
    void req305_ac3_registryLogsMasked(CapturedOutput output) throws Exception {
        String key = key();
        var registry = registry(key);
        List<Throwable> failures = new ArrayList<>();
        var first = registry.register(body("Logged", serviceKey("https://auth.example.localhost",
                "test-dummy-log-client-1", "test-dummy-log-secret-1")));
        registry.update(first.id(), patch(serviceKey("https://auth.example.localhost/",
                "test-dummy-log-client-2", "test-dummy-log-secret-2")));
        ObjectNode invalid = serviceKey("https://auth.example.localhost/oauth/token", "test-dummy-log-client-3", "");
        failures.add(catchThrowable(() -> registry.register(body("Invalid", invalid))));
        failures.add(catchThrowable(() -> registry.update(first.id(), patch(invalid))));
        Files.write(file(), new byte[] {1, 2, 3});
        failures.add(catchThrowable(() -> registry.update(first.id(), patch(serviceKey("https://auth.example.localhost",
                "test-dummy-log-client-4", "test-dummy-log-secret-4")))));
        assertThat(failures).allSatisfy(failure -> assertThat(failure).isInstanceOf(ApiException.class).hasNoCause());
        assertThat(failures).extracting(failure -> ((ApiException) failure).code())
                .containsExactly(Code.INVALID_SERVICE_KEY, Code.INVALID_SERVICE_KEY, Code.TENANT_STORE_UNREADABLE);
        assertThat(registry.find(first.id()).orElseThrow().toString()).doesNotContain("test-dummy-log");
        assertThat(output.getAll().split(WARNING, -1)).hasSize(4);
        String messages = output.getAll() + failures.stream().map(Throwable::getMessage).toList();
        assertThat(messages).doesNotContain("test-dummy-log-client", "test-dummy-log-secret", key,
                "auth.example.localhost", "clientsecret\":");
    }
}
