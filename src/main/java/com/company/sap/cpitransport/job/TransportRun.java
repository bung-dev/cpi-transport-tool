package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.TransportService.Stage;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Ordered execution state shared by synchronous transports and background jobs. */
public final class TransportRun {
    private static final Logger log = LoggerFactory.getLogger(TransportRun.class);

    public record Item(String packageId, String artifactId, Stage stage, ArtifactStatus status) {
        Item at(Stage stage, ArtifactStatus status) {
            return new Item(packageId, artifactId, stage, status);
        }
    }
    public record Started(String jobId, JobStatus status, boolean dryRun, int total) {}
    public record Active(String jobId, int total, int done) {}
    public record Snapshot(String jobId, JobStatus status, boolean dryRun, boolean deploy,
            Instant startedAt, Instant finishedAt, int total, int done, TenantRef sourceTenant,
            TenantRef targetTenant, List<TransportPackage> packages, List<Item> items, TransportResponse result) {
        TransportResponse response(JobStatus terminal, Instant end, List<ArtifactResult> completed, TemplateRef template) {
            int successes = (int) completed.stream().filter(r -> r.status() == ArtifactStatus.SUCCESS).count();
            var summary = new TransportSummary(completed.size(), successes, completed.size() - successes);
            return new TransportResponse(jobId, packages, dryRun, deploy, startedAt, end, summary, completed,
                    sourceTenant, targetTenant, template, terminal);
        }
    }

    private final String id = UUID.randomUUID().toString();
    private final Clock clock;
    private final Instant startedAt;
    private final TransportRequest request;
    private final List<TransportPackage> packages;
    private final List<Item> items;
    private final ArtifactResult[] results;
    private final TemplateRef template;
    private final Consumer<TransportResponse> history;
    private JobStatus status = JobStatus.RUNNING;
    private boolean cancelRequested;
    private int done;
    private TransportResponse result;
    private Consumer<TransportJobStore.SavedJob> persist;

    public TransportRun(Clock clock, TransportRequest request, List<TransportPackage> packages,
                        List<Item> items, TemplateRef template, Consumer<TransportResponse> history) {
        this.clock = clock;
        this.startedAt = clock.instant();
        this.request = request;
        this.packages = new ArrayList<>(packages);
        this.items = new ArrayList<>(items);
        this.results = new ArtifactResult[items.size()];
        this.template = template;
        this.history = history;
    }

    public String id() { return id; }
    public Started started() { return new Started(id, JobStatus.RUNNING, request.dryRun(), results.length); }
    public synchronized Active active() {
        return status == JobStatus.RUNNING ? new Active(id, results.length, done) : null;
    }
    public synchronized Snapshot snapshot() {
        return new Snapshot(id, status, request.dryRun(), request.deploy(), startedAt,
                result == null ? null : result.finishedAt(), items.size(), done, request.source(), request.target(),
                List.copyOf(packages), List.copyOf(items), result);
    }
    synchronized void persistTo(Consumer<TransportJobStore.SavedJob> persist) {
        this.persist = persist;
        save();
    }
    private void save() {
        if (persist != null) {
            List<ArtifactResult> completed = status == JobStatus.RUNNING ? completedResults() : List.of();
            persist.accept(new TransportJobStore.SavedJob(snapshot(), id, template, completed));
        }
    }
    private List<ArtifactResult> completedResults() {
        return Arrays.stream(results).filter(Objects::nonNull).toList();
    }
    public synchronized void cancel() {
        if (status != JobStatus.RUNNING) throw new ErrorResponse.ApiException(ErrorResponse.Code.JOB_NOT_RUNNING);
        cancelRequested = true;
    }
    public synchronized void targetPrepared(int index, TargetPackageStatus target) {
        var pkg = packages.get(index);
        packages.set(index, new TransportPackage(pkg.packageId(), pkg.packageName(), target));
        save();
    }
    public synchronized boolean startItem(int index) {
        if (!cancelRequested) return true;
        items.set(index, items.get(index).at(Stage.SKIPPED, null));
        itemEnded();
        return false;
    }
    public synchronized void stage(int index, Stage stage) {
        // The execution log records the skipped upload, while progress shows only work performed.
        if (request.dryRun() && stage == Stage.UPLOAD) return;
        items.set(index, items.get(index).at(stage, null));
        save();
    }
    public synchronized void completed(int index, ArtifactResult artifact) {
        results[index] = artifact;
        items.set(index, items.get(index).at(Stage.DONE, artifact.status()));
        itemEnded();
    }
    private void itemEnded() {
        done++;
        if (done == items.size()) finish();
        else save();
    }
    // Also called after package preparation for a transport with no artifacts.
    public synchronized TransportResponse finish() {
        if (result == null) finish(cancelRequested ? JobStatus.CANCELLED : JobStatus.COMPLETED);
        return result;
    }
    public synchronized void interrupted() {
        if (result != null) return;
        for (int i = 0; i < results.length; i++) {
            if (results[i] == null) items.set(i, items.get(i).at(Stage.SKIPPED, null));
        }
        done = items.size();
        finish(JobStatus.INTERRUPTED);
    }
    private void finish(JobStatus terminal) {
        result = snapshot().response(history == null ? null : terminal, clock.instant(), completedResults(), template);
        status = terminal;
        if (history != null) {
            try {
                history.accept(result);
            } catch (RuntimeException failure) {
                log.warn("Could not append transport job {} to history", id);
            }
        }
        save();
    }
}
