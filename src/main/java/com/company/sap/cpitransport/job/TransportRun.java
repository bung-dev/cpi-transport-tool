package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.TransportService.Stage;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.function.Function;
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
        TransportResponse response(JobStatus terminal, Instant end, List<ArtifactResult> completed,
                                   List<Item> terminalItems, TemplateRef template, String retryOf) {
            int successes = (int) completed.stream().filter(r -> r.status() == ArtifactStatus.SUCCESS).count();
            int fixRequired = (int) completed.stream().filter(r -> r.grade() == ArtifactGrade.FIX_REQUIRED).count();
            int retryable = (int) completed.stream().filter(r -> r.grade() == ArtifactGrade.RETRYABLE).count();
            var skipped = terminalItems.stream().filter(item -> item.stage() == Stage.SKIPPED)
                    .map(item -> new TransportResponse.SkippedItem(item.packageId(), item.artifactId())).toList();
            var summary = new TransportSummary(completed.size(), successes, completed.size() - successes,
                    fixRequired, retryable, skipped.size());
            return new TransportResponse(jobId, packages, dryRun, deploy, startedAt, end, summary, completed,
                    sourceTenant, targetTenant, template, terminal, skipped, retryOf);
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
    private final Consumer<String> completePreview;
    private JobStatus status = JobStatus.RUNNING;
    private boolean cancelRequested;
    private boolean shuttingDown;
    private int done;
    private TransportResponse result;
    private Function<TransportJobStore.SavedJob, CompletableFuture<Void>> persist;

    public TransportRun(Clock clock, TransportRequest request, List<TransportPackage> packages,
                        List<Item> items, TemplateRef template, Consumer<TransportResponse> history) {
        this(clock, request, packages, items, template, history, null);
    }

    public TransportRun(Clock clock, TransportRequest request, List<TransportPackage> packages,
                        List<Item> items, TemplateRef template, Consumer<TransportResponse> history,
                        Consumer<String> completePreview) {
        this.completePreview = completePreview;
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
    void persistTo(Function<TransportJobStore.SavedJob, CompletableFuture<Void>> persist) {
        CompletableFuture<Void> started;
        synchronized (this) {
            this.persist = persist;
            started = save();
        }
        started.join();
    }
    // Publish under the run lock so concurrent stages reach the store in order.
    // Wait for immediate writes only after releasing that lock.
    private CompletableFuture<Void> save() {
        if (persist == null) return CompletableFuture.completedFuture(null);
        List<ArtifactResult> completed = status == JobStatus.RUNNING ? completedResults() : List.of();
        return persist.apply(new TransportJobStore.SavedJob(snapshot(), id, template, completed,
                cancelRequested, request.retryOf()));
    }
    private List<ArtifactResult> completedResults() {
        return Arrays.stream(results).filter(Objects::nonNull).toList();
    }
    synchronized void beginShutdown() {
        shuttingDown = true;
    }
    public synchronized boolean isShuttingDown() {
        return shuttingDown;
    }
    synchronized void stopSaving() {
        persist = null;
    }
    public void cancel() {
        CompletableFuture<Void> saved;
        synchronized (this) {
            if (status != JobStatus.RUNNING) throw new ErrorResponse.ApiException(ErrorResponse.Code.JOB_NOT_RUNNING);
            if (cancelRequested) return;
            cancelRequested = true;
            saved = save();
        }
        saved.join();
    }
    public synchronized void targetPrepared(int index, TargetPackageStatus target) {
        var pkg = packages.get(index);
        if (pkg.targetPackage() == target) return;
        packages.set(index, new TransportPackage(pkg.packageId(), pkg.packageName(), target));
        save();
    }
    public boolean startItem(int index) {
        CompletableFuture<Void> saved;
        synchronized (this) {
            if (shuttingDown) return false;
            if (!cancelRequested) return true;
            items.set(index, items.get(index).at(Stage.SKIPPED, null));
            saved = itemEnded();
        }
        saved.join();
        return false;
    }
    public synchronized void stage(int index, Stage stage) {
        // The execution log records the skipped upload, while progress shows only work performed.
        if (request.dryRun() && stage == Stage.UPLOAD) return;
        if (items.get(index).stage() == stage) return;
        items.set(index, items.get(index).at(stage, null));
        save();
    }
    public void completed(int index, ArtifactResult artifact) {
        CompletableFuture<Void> saved;
        synchronized (this) {
            results[index] = artifact;
            items.set(index, items.get(index).at(Stage.DONE, artifact.status()));
            saved = itemEnded();
        }
        saved.join();
    }
    private CompletableFuture<Void> itemEnded() {
        done++;
        if (done == items.size() && !shuttingDown && result == null) {
            return finish(cancelRequested ? JobStatus.CANCELLED : JobStatus.COMPLETED);
        }
        return save();
    }
    // Also called after package preparation for a transport with no artifacts.
    public TransportResponse finish() {
        CompletableFuture<Void> saved;
        synchronized (this) {
            if (shuttingDown || result != null) return result;
            saved = finish(cancelRequested ? JobStatus.CANCELLED : JobStatus.COMPLETED);
        }
        saved.join();
        return result;
    }
    public void interrupted() {
        CompletableFuture<Void> saved;
        synchronized (this) {
            if (shuttingDown || result != null) return;
            log.warn("Transport job {} interrupted", id);
            for (int i = 0; i < results.length; i++) {
                if (results[i] == null) items.set(i, items.get(i).at(Stage.SKIPPED, null));
            }
            done = items.size();
            saved = finish(JobStatus.INTERRUPTED);
        }
        saved.join();
    }
    private CompletableFuture<Void> finish(JobStatus terminal) {
        if (completePreview != null) completePreview.accept(id);
        result = snapshot().response(history == null ? null : terminal, clock.instant(), completedResults(),
                items, template, request.retryOf());
        status = terminal;
        if (history != null) {
            try {
                history.accept(result);
            } catch (RuntimeException failure) {
                log.warn("Could not append transport job {} to history", id);
            }
        }
        return save();
    }
}
