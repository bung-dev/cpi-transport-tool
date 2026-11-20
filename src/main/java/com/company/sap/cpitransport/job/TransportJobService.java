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
    private final Map<String, TransportRun> jobs = new HashMap<>();
    private TransportRun realJob;

    public TransportJobService(TransportService transport, TransportHistoryStore history) {
        this.transport = transport;
        this.history = history;
    }

    public TransportRun.Started start(TransportRequest request, TemplateRef template) {
        var prepared = transport.prepare(request);
        synchronized (this) {
            if (!request.dryRun() && active() != null) throw new AlreadyRunning(realJob.id());
            var run = prepared.newRun(template, history::append);
            executor.execute(() -> {
                try {
                    prepared.execute(run);
                } catch (RuntimeException failure) {
                    log.warn("Transport job {} interrupted", run.id());
                    run.interrupted();
                }
            });
            jobs.put(run.id(), run);
            if (!request.dryRun()) realJob = run;
            return run.started();
        }
    }

    public synchronized TransportRun require(String id) {
        var run = jobs.get(id);
        if (run == null) throw new ErrorResponse.ApiException(ErrorResponse.Code.JOB_NOT_FOUND);
        return run;
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
