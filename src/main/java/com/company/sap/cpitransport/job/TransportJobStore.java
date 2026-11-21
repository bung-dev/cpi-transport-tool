package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.TransportHistoryStore;
import com.company.sap.cpitransport.service.TransportService.Stage;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class TransportJobStore {
    private static final Logger log = LoggerFactory.getLogger(TransportJobStore.class);
    private static final int FINISHED_LIMIT = 20;
    private final Path file;
    private final ObjectMapper json;
    // Updates arrive under the individual run's lock. Never acquire a run lock from this store.
    private final Map<String, SavedJob> jobs = new LinkedHashMap<>();

    record SavedJob(@JsonIgnoreProperties("result") TransportRun.Snapshot progress, String transportId,
                    TemplateRef template, List<ArtifactResult> completedResults) {
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
                    result = progress.response(JobStatus.INTERRUPTED, clock.instant(), completedResults, items, template);
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
            return new SavedJob(snapshot, transportId, template, List.of());
        }

        private static List<TransportRun.Item> terminalItems(List<TransportRun.Item> items, List<ArtifactResult> results) {
            var terminal = new ArrayList<TransportRun.Item>(items.size());
            int next = 0;
            for (var item : items) {
                var artifact = next < results.size() ? results.get(next) : null;
                if (artifact != null && item.packageId().equals(artifact.packageId())
                        && item.artifactId().equals(artifact.artifactId()) && item.stage() != Stage.SKIPPED) {
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
        if (recovered || trimmed) write();
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

    synchronized void save(SavedJob job) {
        // Reinsertion preserves completion order even when finish times tie.
        jobs.remove(job.progress().jobId());
        jobs.put(job.progress().jobId(), job);
        if (job.progress().status() != JobStatus.RUNNING) trimFinished();
        write();
    }

    private boolean trimFinished() {
        var finished = jobs.values().stream().map(SavedJob::progress)
                .filter(job -> job.status() != JobStatus.RUNNING)
                .sorted(Comparator.comparing(TransportRun.Snapshot::finishedAt)).toList();
        int excess = finished.size() - FINISHED_LIMIT;
        for (int i = 0; i < excess; i++) jobs.remove(finished.get(i).jobId());
        return excess > 0;
    }

    private void write() {
        try {
            Files.createDirectories(file.getParent());
            var temp = Files.createTempFile(file.getParent(), "jobs-", ".tmp");
            try {
                Files.write(temp, json.writeValueAsBytes(jobs.values()));
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
        }
    }
}
