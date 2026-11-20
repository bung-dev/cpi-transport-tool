package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.TransportHistoryStore;
import com.company.sap.cpitransport.service.TransportService;
import jakarta.annotation.PreDestroy;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class TransportJobService {
    private static final Logger log = LoggerFactory.getLogger(TransportJobService.class);
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
            if (!request.dryRun() && active() != null) throw new AlreadyRunning(realJob.id());
            var run = prepared.newRun(template, history::append);
            run.persistTo(store::save);
            running.put(run.id(), run);
            if (!request.dryRun()) realJob = run;
            executor.execute(() -> {
                try {
                    prepared.execute(run);
                } catch (RuntimeException failure) {
                    log.warn("Transport job {} interrupted", run.id());
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
        executor.close();
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
