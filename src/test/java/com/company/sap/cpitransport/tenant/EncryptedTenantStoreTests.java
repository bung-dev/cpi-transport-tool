package com.company.sap.cpitransport.tenant;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;

class EncryptedTenantStoreTests {
    @TempDir Path directory;
    private final ObjectMapper json = new ObjectMapper();
    private String key() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }
    private EncryptedTenantStore store(String key) {
        return new EncryptedTenantStore(directory.resolve("nested/tenants.enc"), () -> Optional.ofNullable(key), json);
    }
    private List<StoredTenant> tenants() {
        return List.of(new StoredTenant("registered-1", "Demo", "https://api.example.localhost",
                "https://auth.example.localhost/oauth/token", "test-dummy-client", "test-dummy-secret",
                Instant.parse("2026-10-01T00:00:00Z")));
    }

    @Test
    @DisplayName("REQ-301 AC-5·AC-9 / REQ-305 AC-3: encrypted roundtrip restart fresh nonce and atomic replacement")
    void req301_ac5_roundtrip() throws Exception {
        String key = key();
        EncryptedTenantStore store = store(key);
        assertThat(store.read().status()).isEqualTo(StoreStatus.OK);
        assertThat(store.read().tenants()).isEmpty();
        store.write(tenants());
        Path file = directory.resolve("nested/tenants.enc");
        byte[] first = Files.readAllBytes(file);
        assertThat(new String(first, StandardCharsets.ISO_8859_1))
                .startsWith("CTS1").doesNotContain("test-dummy-client", "test-dummy-secret", key);
        assertThat(store(key).read().tenants()).isEqualTo(tenants());
        store.write(tenants());
        byte[] second = Files.readAllBytes(file);
        assertThat(Arrays.copyOfRange(second, 4, 16)).isNotEqualTo(Arrays.copyOfRange(first, 4, 16));
        try (var files = Files.list(file.getParent())) {
            assertThat(files.toList()).containsExactly(file);
        }
        assertThat(tenants().getFirst().toString()).doesNotContain("test-dummy-client", "test-dummy-secret");
    }

    @Test
    @DisplayName("REQ-301 AC-5·AC-6·AC-9 / REQ-305 AC-3: wrong key unreadable and original file preserved")
    void req301_ac5_wrongKey() throws Exception {
        store(key()).write(tenants());
        byte[] original = Files.readAllBytes(directory.resolve("nested/tenants.enc"));
        String wrong = key();
        EncryptedTenantStore store = store(wrong);
        assertThat(store.read().status()).isEqualTo(StoreStatus.UNREADABLE);
        assertThat(store.read().tenants()).isEmpty();
        assertThatThrownBy(() -> store.write(tenants())).hasMessage("TENANT_STORE_UNREADABLE")
                .hasNoCause();
        assertThat(Files.readAllBytes(directory.resolve("nested/tenants.enc"))).isEqualTo(original);
    }

    @Test
    @DisplayName("REQ-301 AC-6·AC-9 / REQ-305 AC-3: missing empty invalid and short keys not configured")
    void req301_ac6_invalidKey() {
        for (String key : Arrays.asList(null, "", "test-dummy-not-base64", Base64.getEncoder().encodeToString(new byte[16]))) {
            EncryptedTenantStore store = store(key);
            assertThat(store.read().status()).isEqualTo(StoreStatus.NOT_CONFIGURED);
            assertThat(store.read().tenants()).isEmpty();
            assertThatThrownBy(() -> store.write(tenants())).hasMessage("TENANT_STORE_NOT_CONFIGURED").hasNoCause();
        }
        assertThat(directory.resolve("nested")).doesNotExist();
    }

    @Test
    @DisplayName("REQ-301 AC-6·AC-9: corrupt magic length and authentication tag preserve file")
    void req301_ac6_corrupt() throws Exception {
        String key = key();
        EncryptedTenantStore store = store(key);
        store.write(tenants());
        Path file = directory.resolve("nested/tenants.enc");
        byte[] good = Files.readAllBytes(file);
        byte[] magic = good.clone(); magic[0] ^= 1;
        byte[] tag = good.clone(); tag[tag.length - 1] ^= 1;
        for (byte[] corrupt : List.of(new byte[0], new byte[31], magic, tag)) {
            Files.write(file, corrupt);
            assertThat(store.read().status()).isEqualTo(StoreStatus.UNREADABLE);
            assertThatThrownBy(() -> store.write(tenants())).hasMessage("TENANT_STORE_UNREADABLE");
            assertThat(Files.readAllBytes(file)).isEqualTo(corrupt);
        }
    }

    @Test
    @DisplayName("REQ-301 AC-6·AC-9 / REQ-305 AC-3: valid encryption with malformed JSON is unreadable")
    void req301_ac6_invalidJson() throws Exception {
        String key = key();
        byte[] nonce = new byte[12]; new SecureRandom().nextBytes(nonce);
        var cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE,
                new javax.crypto.spec.SecretKeySpec(Base64.getDecoder().decode(key), "AES"),
                new javax.crypto.spec.GCMParameterSpec(128, nonce));
        byte[] magic = "CTS1".getBytes(StandardCharsets.UTF_8);
        cipher.updateAAD(magic);
        byte[] encrypted = cipher.doFinal("test-dummy-invalid-json".getBytes(StandardCharsets.UTF_8));
        byte[] bytes = java.nio.ByteBuffer.allocate(16 + encrypted.length).put(magic).put(nonce).put(encrypted).array();
        Path file = directory.resolve("nested/tenants.enc");
        Files.createDirectories(file.getParent()); Files.write(file, bytes);
        assertThat(store(key).read().status()).isEqualTo(StoreStatus.UNREADABLE);
        assertThatThrownBy(() -> store(key).write(tenants())).hasMessage("TENANT_STORE_UNREADABLE").hasNoCause();
        assertThat(Files.readAllBytes(file)).isEqualTo(bytes);
    }
}
