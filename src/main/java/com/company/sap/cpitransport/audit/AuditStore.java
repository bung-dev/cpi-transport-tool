package com.company.sap.cpitransport.audit;

import com.company.sap.cpitransport.config.AuditProperties;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.SerializationFeature;

@Service
public class AuditStore {
    private static final Logger log = LoggerFactory.getLogger(AuditStore.class);
    private static final Object LOCK = new Object();
    private final Path file;
    private final ObjectMapper json;
    private final Clock clock;

    public AuditStore(AuditProperties properties, ObjectMapper json, Clock clock) {
        this.file = properties.file().toAbsolutePath();
        this.json = json;
        this.clock = clock;
    }

    public void append(AuditChange change) {
        synchronized (LOCK) {
            try {
                var entry = new AuditEntry(UUID.randomUUID().toString(), clock.instant(), change.category(),
                        change.action(), change.objectId(), change.objectName(), change.detail());
                byte[] bytes = (json.writer().without(SerializationFeature.INDENT_OUTPUT)
                        .writeValueAsString(entry) + "\n").getBytes(StandardCharsets.UTF_8);
                Files.createDirectories(file.getParent());
                try (var channel = FileChannel.open(file, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                     var ignored = channel.lock()) {
                    long end = channel.size();
                    channel.position(end);
                    try {
                        var buffer = ByteBuffer.wrap(bytes);
                        while (buffer.hasRemaining()) channel.write(buffer);
                    } catch (IOException failure) {
                        channel.truncate(end);
                        throw failure;
                    }
                }
            } catch (IOException | RuntimeException ignored) {
                // Best effort: preserve successful mutations; never log exception content.
                log.error("Audit append failed");
            }
        }
    }

    public List<AuditEntry> findAll() {
        synchronized (LOCK) {
            try (var channel = FileChannel.open(file, StandardOpenOption.READ);
                 var ignored = channel.lock(0, Long.MAX_VALUE, true)) {
                var reader = new BufferedReader(java.nio.channels.Channels.newReader(channel, StandardCharsets.UTF_8));
                var entries = new ArrayList<AuditEntry>();
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.isBlank()) continue;
                    try {
                        var entry = json.readValue(line, AuditEntry.class);
                        if (entry == null || entry.time() == null) throw new IllegalArgumentException();
                        entries.add(entry);
                    } catch (RuntimeException ignoredLine) {
                        log.warn("Skipping unreadable audit line");
                    }
                }
                return List.copyOf(entries);
            } catch (NoSuchFileException missing) {
                return List.of();
            } catch (IOException ignored) {
                // 예외 내용(경로 등)은 응답·로그에 싣지 않는다.
                log.error("Audit read failed");
                throw new ApiException(Code.AUDIT_STORE_UNREADABLE);
            }
        }
    }
}
