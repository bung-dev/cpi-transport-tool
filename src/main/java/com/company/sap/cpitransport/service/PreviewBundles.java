package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.model.ConfigurationItem;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

@Component
public class PreviewBundles {
    private static final Duration LIFETIME = Duration.ofMinutes(30);
    private static final int MAX_PREVIEWS = 5;
    private final Clock clock;
    private final ScheduledThreadPoolExecutor expiry = new ScheduledThreadPoolExecutor(1,
            Thread.ofVirtual().name("preview-expiry").factory());
    private final Map<String, Map<Key, Bundle>> pending = new HashMap<>();
    private final LinkedHashMap<String, Preview> completed = new LinkedHashMap<>();

    public PreviewBundles(Clock clock) {
        this.clock = clock;
        expiry.setRemoveOnCancelPolicy(true);
        expiry.setKeepAliveTime(1, TimeUnit.MINUTES);
        expiry.allowCoreThreadTimeOut(true);
    }

    private record Key(String tenantId, String artifactId, String version) {}
    private record Preview(Instant expiresAt, Map<Key, Bundle> artifacts, ScheduledFuture<?> eviction) {}
    public record Bundle(byte[] zip, List<ConfigurationItem> configurations) {
        public Bundle {
            zip = zip.clone();
            configurations = List.copyOf(configurations);
        }
        @Override public byte[] zip() { return zip.clone(); }
    }

    public void put(String previewId, String sourceTenantId, String artifactId, String version,
                    byte[] zip, List<ConfigurationItem> configurations) {
        var bundle = new Bundle(zip, configurations);
        synchronized (this) {
            pending.computeIfAbsent(previewId, unused -> new HashMap<>())
                    .put(new Key(sourceTenantId, artifactId, version), bundle);
        }
    }

    // A synchronous preview can be interrupted before the run publishes a result.
    synchronized void discardPending(String previewId) {
        pending.remove(previewId);
    }

    public synchronized void complete(String previewId) {
        var artifacts = pending.remove(previewId);
        if (completed.containsKey(previewId)) return;
        var expiresAt = clock.instant().plus(LIFETIME);
        var eviction = expiry.schedule(() -> evict(previewId), LIFETIME.toMillis(), TimeUnit.MILLISECONDS);
        completed.put(previewId, new Preview(expiresAt, artifacts == null ? Map.of() : artifacts, eviction));
        if (completed.size() > MAX_PREVIEWS) evict(completed.firstEntry().getKey());
    }

    public synchronized Optional<Bundle> find(String previewId, String sourceTenantId, String artifactId, String version) {
        if (previewId == null || version == null || version.isBlank()) return Optional.empty();
        var preview = completed.get(previewId);
        if (preview == null) return Optional.empty();
        if (!clock.instant().isBefore(preview.expiresAt())) {
            evict(previewId);
            return Optional.empty();
        }
        return Optional.ofNullable(preview.artifacts().get(new Key(sourceTenantId, artifactId, version)));
    }

    private synchronized void evict(String previewId) {
        var preview = completed.remove(previewId);
        if (preview != null) preview.eviction().cancel(false);
    }

    @PreDestroy
    synchronized void close() {
        expiry.shutdownNow();
        completed.clear();
        pending.clear();
    }
}
