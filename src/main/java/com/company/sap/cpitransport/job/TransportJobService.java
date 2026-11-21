package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.TransportHistoryStore;
import com.company.sap.cpitransport.service.TransportService;
import jakarta.annotation.PreDestroy;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Service;

@Service
public class TransportJobService {
    private static final int SHUTDOWN_WAIT_SECONDS = 10;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final TransportService transport;
    private final TransportHistoryStore history;
    private final TransportJobStore store;
    private final Map<String, TransportRun> running = new HashMap<>();
    private TransportRun realJob;

    public TransportJobService(TransportService transport, TransportHistoryStore history, TransportJobStore store) {
        this.transport = transport;
        this.history = history;
        this.store = store;
    }

    public TransportRun.Started start(TransportRequest request, TemplateRef template) {
        var prepared = transport.prepare(request);
        synchronized (this) {
            if (executor.isShutdown()) throw new RejectedExecutionException("Transport jobs are shutting down");
            if (!request.dryRun() && active() != null) throw new AlreadyRunning(realJob.id());
            var run = prepared.newRun(template, history::append);
            run.persistTo(store::save);
            running.put(run.id(), run);
            if (!request.dryRun()) realJob = run;
            executor.execute(() -> {
                try {
                    prepared.execute(run);
                } catch (RuntimeException failure) {
                    run.interrupted();
                } finally {
                    synchronized (this) {
                        running.remove(run.id());
                        if (realJob == run) realJob = null;
                    }
                }
            });
            return run.started();
        }
    }

    public TransportResponse retrySource(String transportId) {
        synchronized (this) {
            var run = running.get(transportId);
            if (run != null && run.active() != null) throw new AlreadyRunning(transportId);
        }
        var original = history.findAll().stream().filter(row -> transportId.equals(row.transportId()))
                .findFirst().orElseThrow(() -> new ErrorResponse.ApiException(ErrorResponse.Code.TRANSPORT_NOT_FOUND));
        if (original.dryRun()) throw new ErrorResponse.ApiException(ErrorResponse.Code.RETRY_NOT_ALLOWED);
        return original;
    }

    public TransportRun.Snapshot snapshot(String id) {
        return store.require(id);
    }

    public synchronized void cancel(String id) {
        var run = running.get(id);
        if (run == null) {
            store.require(id);
            throw new ErrorResponse.ApiException(ErrorResponse.Code.JOB_NOT_RUNNING);
        }
        run.cancel();
    }

    public synchronized TransportRun.Active active() {
        return realJob == null ? null : realJob.active();
    }

    @PreDestroy
    void close() {
        synchronized (this) {
            executor.shutdown();
            running.values().forEach(TransportRun::beginShutdown);
        }
        try {
            if (executor.awaitTermination(SHUTDOWN_WAIT_SECONDS, TimeUnit.SECONDS)) return;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } finally {
            // Drain queued progress before handing the jobs file to the next application context.
            store.close();
        }
        synchronized (this) {
            // A worker may return after another application context has recovered the jobs file.
            running.values().forEach(TransportRun::stopSaving);
            executor.shutdownNow();
        }
    }

    public static final class AlreadyRunning extends ErrorResponse.ApiException {
        private final String jobId;
        AlreadyRunning(String jobId) {
            super(ErrorResponse.Code.JOB_ALREADY_RUNNING);
            this.jobId = jobId;
        }
        public String jobId() { return jobId; }
    }
}
