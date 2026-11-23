package com.company.sap.cpitransport.service;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.locks.ReentrantLock;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.TransportResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.SerializationFeature;

@Service
public class TransportHistoryStore {
    private static final Logger log = LoggerFactory.getLogger(TransportHistoryStore.class);
    // A JVM-wide lock also covers multiple store instances and path aliases.
    private static final ReentrantLock LOCK = new ReentrantLock();
    private final Path file;
    private final ObjectMapper json;

    public TransportHistoryStore(TransportProperties properties, ObjectMapper json) {
        file = properties.history().file().toAbsolutePath();
        this.json = json;
    }

    public void append(TransportResponse response) {
        // Preserve the API response, including source configuration values.
        byte[] line = (json.writer().without(SerializationFeature.INDENT_OUTPUT)
                .writeValueAsString(response) + "\n").getBytes(StandardCharsets.UTF_8);
        LOCK.lock();
        try {
            Files.createDirectories(file.getParent());
            try (var channel = FileChannel.open(file, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                    var ignored = channel.lock()) {
                long end = channel.size();
                channel.position(end);
                try {
                    if (channel.write(ByteBuffer.wrap(line)) != line.length)
                        throw new IOException("Incomplete history write");
                } catch (IOException failure) {
                    channel.truncate(end);
                    throw failure;
                }
            }
        } catch (IOException failure) {
            // Storage errors have no specified API contract; fail rather than return an unrecorded 200.
            throw new UncheckedIOException("History append failed", failure);
        } finally {
            LOCK.unlock();
        }
    }

    public List<TransportResponse> findAll() {
        LOCK.lock();
        try (var channel = FileChannel.open(file, StandardOpenOption.READ);
                var ignored = channel.lock(0, Long.MAX_VALUE, true)) {
            var reader = new BufferedReader(java.nio.channels.Channels.newReader(channel, StandardCharsets.UTF_8));
            var results = new ArrayList<TransportResponse>();
            String line;
            int number = 0;
            while ((line = reader.readLine()) != null) {
                number++;
                if (line.isBlank()) continue;
                try {
                    var node = json.readTree(line);
                    if (node.isObject() && !node.has("packages") && node.has("packageId")) {
                        var legacy = (tools.jackson.databind.node.ObjectNode) node;
                        String packageId = legacy.path("packageId").asString();
                        legacy.remove("packageId");
                        legacy.putArray("packages").addObject().put("packageId", packageId)
                                .putNull("packageName").putNull("targetPackage");
                        for (var result : legacy.path("results")) {
                            if (!result.hasNonNull("packageId"))
                                ((tools.jackson.databind.node.ObjectNode) result).put("packageId", packageId);
                        }
                    }
                    var response = json.treeToValue(node, TransportResponse.class);
                    if (response == null || response.startedAt() == null) throw new IllegalArgumentException();
                    results.add(response);
                } catch (RuntimeException failure) {
                    log.warn("Skipping unreadable history line {}", number);
                }
            }
            results.sort(Comparator.comparing(TransportResponse::startedAt).reversed());
            return List.copyOf(results);
        } catch (NoSuchFileException missing) {
            return List.of();
        } catch (IOException failure) {
            throw new UncheckedIOException("History read failed", failure);
        } finally {
            LOCK.unlock();
        }
    }
}
