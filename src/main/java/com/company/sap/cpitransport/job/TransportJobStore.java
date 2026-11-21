package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.TransportHistoryStore;
import com.company.sap.cpitransport.service.TransportService.Stage;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class TransportJobStore {
    private static final Logger log = LoggerFactory.getLogger(TransportJobStore.class);
    private static final int FINISHED_LIMIT = 20;
    private static final long SAVE_INTERVAL = TimeUnit.SECONDS.toNanos(1);
    private final Path file;
    private final ObjectMapper json;
    // Updates arrive under the individual run's lock. Never acquire a run lock from this store.
    private final Map<String, SavedJob> jobs = new LinkedHashMap<>();

    private final ScheduledExecutorService writer = Executors.newSingleThreadScheduledExecutor(
            Thread.ofPlatform().daemon().name("transport-job-writer").factory());
    private final AtomicInteger writes = new AtomicInteger();
    private ScheduledFuture<?> pending;
    private CompletableFuture<Void> latestWrite = CompletableFuture.completedFuture(null);
    private long lastWrite;

    record SavedJob(@JsonIgnoreProperties("result") TransportRun.Snapshot progress, String transportId,
                    TemplateRef template, List<ArtifactResult> completedResults, Boolean cancelRequested, String retryOf) {
        void validate() {
            Objects.requireNonNull(progress.jobId());
            Objects.requireNonNull(progress.status());
            Objects.requireNonNull(progress.startedAt());
            Objects.requireNonNull(transportId);
            progress.packages().forEach(Objects::requireNonNull);
            completedResults.forEach(Objects::requireNonNull);
            for (var item : progress.items()) {
                Objects.requireNonNull(item.packageId());
                Objects.requireNonNull(item.artifactId());
                Objects.requireNonNull(item.stage());
            }
            if (progress.total() != progress.items().size()
                    || (progress.status() == JobStatus.RUNNING) != (progress.finishedAt() == null)) {
                throw new IllegalArgumentException("Invalid job state");
            }
        }

        SavedJob restore(TransportResponse result, TransportHistoryStore history, Clock clock) {
            var status = progress.status();
            var finishedAt = progress.finishedAt();
            var items = progress.items();
            var packages = progress.packages();
            if (status == JobStatus.RUNNING) {
                if (result == null) {
                    items = items.stream().map(item -> item.stage() == Stage.DONE ? item : item.at(Stage.SKIPPED, null))
                            .toList();
                    result = progress.response(JobStatus.INTERRUPTED, clock.instant(), completedResults, items, template, retryOf);
                    try {
                        history.append(result);
                    } catch (RuntimeException failure) {
                        log.warn("Could not append interrupted transport job to history");
                    }
                } else {
                    // History was committed before the process stopped or the terminal jobs write failed.
                    items = terminalItems(items, result.results());
                }
                status = result.jobStatus();
                finishedAt = result.finishedAt();
                packages = result.packages();
            }
            var snapshot = new TransportRun.Snapshot(progress.jobId(), status, progress.dryRun(), progress.deploy(),
                    progress.startedAt(), finishedAt, items.size(), items.size(), progress.sourceTenant(),
                    progress.targetTenant(), packages, items, result);
            return new SavedJob(snapshot, transportId, template, List.of(), cancelRequested, retryOf);
        }

        private static List<TransportRun.Item> terminalItems(List<TransportRun.Item> items, List<ArtifactResult> results) {
            var terminal = new ArrayList<TransportRun.Item>(items.size());
            int next = 0;
            for (var item : items) {
                var artifact = next < results.size() ? results.get(next) : null;
                if (artifact != null && item.packageId().equals(artifact.packageId())
                        && item.type() == artifact.type() && item.artifactId().equals(artifact.artifactId())
                        && item.stage() != Stage.SKIPPED) {
                    terminal.add(item.at(Stage.DONE, artifact.status()));
                    next++;
                } else {
                    terminal.add(item.at(Stage.SKIPPED, null));
                }
            }
            return List.copyOf(terminal);
        }
    }

    public TransportJobStore(@Value("${cpi.transport.jobs.file}") Path file, ObjectMapper json,
                             TransportHistoryStore history, Clock clock) {
        this.file = file.toAbsolutePath();
        this.json = json;
        load();
        if (jobs.isEmpty()) return;

        Map<String, TransportResponse> results = new HashMap<>();
        try {
            for (var result : history.findAll()) results.put(result.transportId(), result);
        } catch (UncheckedIOException failure) {
            log.warn("Could not read history for transport jobs");
        }
        boolean recovered = jobs.values().stream().anyMatch(job -> job.progress().status() == JobStatus.RUNNING);
        jobs.replaceAll((id, job) -> job.restore(results.get(job.transportId()), history, clock));
        boolean trimmed = trimFinished();
        if (recovered || trimmed) write(List.copyOf(jobs.values()));
    }

    private void load() {
        try {
            var saved = json.readValue(Files.readAllBytes(file), SavedJob[].class);
            for (var job : saved) {
                job.validate();
                if (jobs.putIfAbsent(job.progress().jobId(), job) != null) {
                    throw new IllegalArgumentException("Duplicate job ID");
                }
            }
        } catch (NoSuchFileException missing) {
            // Create the file on the first state change.
        } catch (IOException | RuntimeException failure) {
            jobs.clear();
            log.warn("Could not read transport jobs file, starting with no jobs");
        }
    }

    synchronized TransportRun.Snapshot require(String id) {
        var job = jobs.get(id);
        if (job == null) throw new ErrorResponse.ApiException(ErrorResponse.Code.JOB_NOT_FOUND);
        return job.progress();
    }

    synchronized CompletableFuture<Void> save(SavedJob job) {
        if (writer.isShutdown()) return CompletableFuture.completedFuture(null);
        // Reinsertion preserves completion order even when finish times tie.
        var previous = jobs.remove(job.progress().jobId());
        jobs.put(job.progress().jobId(), job);
        boolean terminal = job.progress().status() != JobStatus.RUNNING;
        if (terminal) trimFinished();
        boolean immediate = previous == null || terminal
                || !Objects.equals(previous.cancelRequested(), job.cancelRequested());
        if (pending == null) latestWrite = new CompletableFuture<>();
        schedule(immediate);
        return immediate ? latestWrite : CompletableFuture.completedFuture(null);
    }

    private void schedule(boolean immediate) {
        if (pending != null) {
            if (!immediate || pending.getDelay(TimeUnit.NANOSECONDS) <= 0) return;
            pending.cancel(false);
        }
        var scheduledBatch = latestWrite;
        long delay = immediate ? 0 : SAVE_INTERVAL - (System.nanoTime() - lastWrite);
        pending = writer.schedule(() -> flush(scheduledBatch), Math.max(0, delay), TimeUnit.NANOSECONDS);
    }

    // Only the single writer calls flush. New updates can enter the store during file I/O.
    private void flush(CompletableFuture<Void> scheduledBatch) {
        List<SavedJob> snapshot;
        synchronized (this) {
            if (scheduledBatch != latestWrite || pending == null) return;
            snapshot = List.copyOf(jobs.values());
            pending = null;
            lastWrite = System.nanoTime();
        }
        write(snapshot);
        scheduledBatch.complete(null);
    }

    int writeCount() {
        return writes.get();
    }

    @PreDestroy
    void close() {
        CompletableFuture<Void> last;
        synchronized (this) {
            if (!writer.isShutdown()) {
                if (pending != null) schedule(true);
                writer.shutdown();
            }
            last = latestWrite;
        }
        last.join();
        writer.close();
    }

    private boolean trimFinished() {
        var finished = jobs.values().stream().map(SavedJob::progress)
                .filter(job -> job.status() != JobStatus.RUNNING)
                .sorted(Comparator.comparing(TransportRun.Snapshot::finishedAt)).toList();
        int excess = finished.size() - FINISHED_LIMIT;
        for (int i = 0; i < excess; i++) jobs.remove(finished.get(i).jobId());
        return excess > 0;
    }

    private void write(List<SavedJob> snapshot) {
        try {
            Files.createDirectories(file.getParent());
            var temp = Files.createTempFile(file.getParent(), "jobs-", ".tmp");
            try {
                Files.write(temp, json.writeValueAsBytes(snapshot));
                try {
                    Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } catch (AtomicMoveNotSupportedException unsupported) {
                    Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
                }
            } finally {
                Files.deleteIfExists(temp);
            }
        } catch (IOException | RuntimeException failure) {
            log.warn("Could not save transport jobs file");
        } finally {
            writes.incrementAndGet();
        }
    }
}
