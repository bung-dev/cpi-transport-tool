package com.company.sap.cpitransport.tenant;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import tools.jackson.databind.ObjectMapper;

public class EncryptedTenantStore {
    private static final byte[] MAGIC = {'C', 'T', 'S', '1'};
    private static final SecureRandom RANDOM = new SecureRandom();
    private final Path file;
    private final TenantStoreKeySource keySource;
    private final ObjectMapper json;

    public EncryptedTenantStore(Path file, TenantStoreKeySource keySource, ObjectMapper json) {
        this.file = file.toAbsolutePath();
        this.keySource = keySource;
        this.json = json;
    }

    public record Snapshot(StoreStatus status, List<StoredTenant> tenants) {
        public Snapshot { tenants = List.copyOf(tenants); }
    }
    private record Document(int version, List<StoredTenant> tenants) {}

    public synchronized Snapshot read() {
        byte[] key = key();
        return key == null ? new Snapshot(StoreStatus.NOT_CONFIGURED, List.of()) : read(key);
    }

    private Snapshot read(byte[] key) {
        try {
            byte[] bytes = Files.readAllBytes(file);
            if (bytes.length < 32 || !Arrays.equals(MAGIC, Arrays.copyOf(bytes, 4))) {
                return unreadable();
            }
            byte[] nonce = Arrays.copyOfRange(bytes, 4, 16);
            byte[] plain = cipher(Cipher.DECRYPT_MODE, key, nonce).doFinal(bytes, 16, bytes.length - 16);
            Document document = json.readValue(plain, Document.class);
            if (document == null || document.version() != 1 || document.tenants() == null
                    || document.tenants().stream().anyMatch(t -> t == null || t.id() == null
                    || t.name() == null || t.apiUrl() == null || t.tokenUrl() == null
                    || t.clientId() == null || t.clientSecret() == null || t.createdAt() == null)) {
                return unreadable();
            }
            return new Snapshot(StoreStatus.OK, document.tenants());
        } catch (NoSuchFileException missing) {
            return new Snapshot(StoreStatus.OK, List.of());
        } catch (IOException | GeneralSecurityException | RuntimeException ignored) {
            // AI-NOTE: discard parser/crypto causes, which can expose credentials (REQ-305 AC-3).
            return unreadable();
        }
    }

    public synchronized void write(List<StoredTenant> tenants) {
        byte[] key = key();
        StoreStatus status = key == null ? StoreStatus.NOT_CONFIGURED : read(key).status();
        if (status != StoreStatus.OK) throw new IllegalStateException("TENANT_STORE_" + status);
        try {
            byte[] nonce = new byte[12];
            RANDOM.nextBytes(nonce);
            byte[] encrypted = cipher(Cipher.ENCRYPT_MODE, key, nonce)
                    .doFinal(json.writeValueAsBytes(new Document(1, List.copyOf(tenants))));
            byte[] bytes = ByteBuffer.allocate(16 + encrypted.length)
                    .put(MAGIC).put(nonce).put(encrypted).array();
            Files.createDirectories(file.getParent());
            Path temporary = Files.createTempFile(file.getParent(), "tenants-", ".tmp");
            Files.write(temporary, bytes);
            try {
                Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException | GeneralSecurityException | RuntimeException ignored) {
            throw new IllegalStateException("Tenant store write failed");
        }
    }

    private byte[] key() {
        try {
            String encoded = keySource.storeKey().orElse("");
            byte[] decoded = Base64.getDecoder().decode(encoded);
            return decoded.length == 32 ? decoded : null;
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private Cipher cipher(int mode, byte[] key, byte[] nonce) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(MAGIC);
        return cipher;
    }

    private Snapshot unreadable() { return new Snapshot(StoreStatus.UNREADABLE, List.of()); }
}
