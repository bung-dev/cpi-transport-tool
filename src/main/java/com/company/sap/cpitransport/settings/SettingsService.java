package com.company.sap.cpitransport.settings;

import com.company.sap.cpitransport.audit.AuditChange;
import com.company.sap.cpitransport.audit.AuditStore;
import com.company.sap.cpitransport.model.ConcurrencySettings;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import java.io.IOException;
import java.nio.file.*;
import java.util.StringJoiner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class SettingsService {
    private static final Logger log = LoggerFactory.getLogger(SettingsService.class);
    private final Path file;
    private final ObjectMapper json;
    private final AuditStore audit;
    private volatile ConcurrencySettings current;

    public SettingsService(@Value("${cpi.settings.store-file}") Path file, ConcurrencySettings defaults,
                           ObjectMapper json, AuditStore audit) {
        this.file = file.toAbsolutePath();
        this.json = json;
        this.audit = audit;
        this.current = load(defaults);
    }

    public ConcurrencySettings current() {
        return current;
    }

    private ConcurrencySettings load(ConcurrencySettings defaults) {
        try {
            return parse(Files.readAllBytes(file));
        } catch (NoSuchFileException missing) {
            return defaults;
        } catch (IOException | RuntimeException ignored) {
            log.warn("Cannot read settings file, using configured concurrency");
            return defaults;
        }
    }

    private ConcurrencySettings parse(byte[] bytes) {
        if (bytes == null) throw new ApiException(Code.INVALID_REQUEST);
        try {
            var root = json.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(bytes);
            if (root == null || !root.isObject()) throw new ApiException(Code.INVALID_REQUEST);
            return new ConcurrencySettings(integer(root.path("previewConcurrency")), integer(root.path("transportConcurrency")));
        } catch (JacksonException | IllegalArgumentException ignored) {
            throw new ApiException(Code.INVALID_REQUEST);
        }
    }

    private static int integer(JsonNode node) {
        if (!node.isIntegralNumber() || !node.canConvertToInt()) throw new ApiException(Code.INVALID_REQUEST);
        return node.intValue();
    }

    public synchronized ConcurrencySettings update(byte[] body) {
        var next = parse(body);
        var previous = current;
        try {
            persist(next);
        } catch (IOException failure) {
            throw new IllegalStateException("Cannot save settings file", failure);
        }
        current = next;
        var changes = new StringJoiner(", ");
        if (previous.previewConcurrency() != next.previewConcurrency())
            changes.add("미리보기 " + previous.previewConcurrency() + "→" + next.previewConcurrency());
        if (previous.transportConcurrency() != next.transportConcurrency())
            changes.add("실제 이관 " + previous.transportConcurrency() + "→" + next.transportConcurrency());
        if (changes.length() > 0)
            audit.append(new AuditChange("settings", "updated", "concurrency", "동시 처리", changes.toString()));
        return next;
    }

    private void persist(ConcurrencySettings settings) throws IOException {
        Files.createDirectories(file.getParent());
        Path temporary = Files.createTempFile(file.getParent(), "settings-", ".tmp");
        try {
            Files.write(temporary, json.writeValueAsBytes(settings));
            try {
                Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }
}
