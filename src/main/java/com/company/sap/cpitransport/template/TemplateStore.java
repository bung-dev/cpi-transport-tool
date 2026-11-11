package com.company.sap.cpitransport.template;

import com.company.sap.cpitransport.config.TemplateProperties;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.function.UnaryOperator;
import org.springframework.stereotype.Service;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;

@Service
public class TemplateStore {
    // Serialize read-modify-write across application contexts sharing a file.
    private static final Object LOCK = new Object();
    private final Path file;
    private final ObjectMapper json;

    public TemplateStore(TemplateProperties properties, ObjectMapper json) {
        this.file = properties.storeFile().toAbsolutePath();
        this.json = json;
    }

    public List<StoredTemplate> findAll() {
        synchronized (LOCK) { return read(); }
    }

    public void update(UnaryOperator<List<StoredTemplate>> change) {
        synchronized (LOCK) { write(change.apply(read())); }
    }

    private List<StoredTemplate> read() {
        try {
            StoredTemplate[] entries = json.readerFor(StoredTemplate[].class)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(Files.readAllBytes(file));
            if (entries == null) throw new IllegalArgumentException();
            var ids = new HashSet<String>();
            var names = new HashSet<String>();
            for (var t : entries) {
                if (t == null || t.id() == null || t.id().isBlank() || t.name() == null || t.name().isBlank()
                        || t.name().codePointCount(0, t.name().length()) > 60
                        || t.sourceTenantId() == null || t.sourceTenantId().isBlank()
                        || t.targetTenantId() == null || t.targetTenantId().isBlank()
                        || t.sourceTenantId().equals(t.targetTenantId())
                        || t.createdAt() == null || t.updatedAt() == null
                        || !ids.add(t.id()) || !names.add(t.name().toLowerCase(Locale.ROOT))) {
                    throw new IllegalArgumentException();
                }
            }
            return List.of(entries);
        } catch (NoSuchFileException missing) {
            return List.of();
        } catch (IOException | RuntimeException ignored) {
            throw new ApiException(Code.TEMPLATE_STORE_UNREADABLE);
        }
    }

    private void write(List<StoredTemplate> entries) {
        Path temporary = null;
        try {
            byte[] bytes = json.writeValueAsBytes(entries);
            Files.createDirectories(file.getParent());
            temporary = Files.createTempFile(file.getParent(), "templates-", ".tmp");
            Files.write(temporary, bytes);
            try {
                Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException | RuntimeException ignored) {
            throw new ApiException(Code.TEMPLATE_STORE_UNREADABLE);
        } finally {
            if (temporary != null) {
                try { Files.deleteIfExists(temporary); } catch (IOException ignored) { }
            }
        }
    }
}
