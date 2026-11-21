package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.CpiApiClient;
import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.DeployStatus;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import static com.company.sap.cpitransport.service.DeployOutcome.DeployFailure.*;

/** One runtime-list reader per transport. Each iFlow owns its deadline and final result. */
final class DeployBatch implements AutoCloseable {
    private record Pending(String id, Instant deadline, CompletableFuture<DeployOutcome> outcome) {
        DeployOutcome judge(Instant now, String status) {
            if (!now.isBefore(deadline)) return TIMEOUT;
            if ("STARTED".equals(status)) return STARTED;
            if ("ERROR".equals(status)) return ERROR;
            return null;
        }
    }
    private static final DeployOutcome STARTED = new DeployOutcome(DeployStatus.STARTED, NONE);
    private static final DeployOutcome ERROR = new DeployOutcome(DeployStatus.ERROR, RUNTIME_ERROR);
    private static final DeployOutcome TIMEOUT = new DeployOutcome(DeployStatus.TIMEOUT, NONE);
    private static final DeployOutcome FAILED = new DeployOutcome(DeployStatus.ERROR, CALL_FAILED);

    private final CpiApiClient api;
    private final String tenantId;
    private final TransportProperties.Deploy settings;
    private final Clock clock;
    private final Sleeper sleeper;
    private final ExecutorService reader = Executors.newSingleThreadExecutor(Thread.ofVirtual().factory());
    private final Set<Pending> waiting = new LinkedHashSet<>();

    DeployBatch(CpiApiClient api, String tenantId, TransportProperties.Deploy settings, Clock clock, Sleeper sleeper) {
        this.api = api;
        this.tenantId = tenantId;
        this.settings = settings;
        this.clock = clock;
        this.sleeper = sleeper;
    }

    DeployOutcome deployAndAwait(String id, Runnable releaseSlot) {
        var deadline = clock.instant().plus(settings.timeout());
        api.deploy(tenantId, id);
        var item = new Pending(id, deadline, new CompletableFuture<>());
        register(item);
        releaseSlot.run();
        try {
            return item.outcome().get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return FAILED;
        } catch (ExecutionException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private synchronized void register(Pending item) {
        waiting.add(item);
        if (waiting.size() == 1) reader.execute(this::pollUntilIdle);
    }

    private void pollUntilIdle() {
        int failures = 0;
        var nextPoll = clock.instant().plus(settings.pollInterval());
        try {
            while (true) {
                Instant wakeAt;
                synchronized (this) {
                    wakeAt = waiting.stream().map(Pending::deadline).min(Instant::compareTo).orElseThrow();
                }
                boolean pollDue = !wakeAt.isBefore(nextPoll);
                var delay = Duration.between(clock.instant(), pollDue ? nextPoll : wakeAt);
                if (delay.isPositive()) sleeper.sleep(delay);

                // Only deployments registered before the GET can use its snapshot.
                List<Pending> round;
                synchronized (this) {
                    round = List.copyOf(waiting);
                }
                Map<String, String> statuses = Map.of();
                if (pollDue) {
                    try {
                        statuses = api.listRuntimeStatuses(tenantId);
                        failures = 0;
                    } catch (RuntimeException failure) {
                        failures++;
                    }
                    nextPoll = clock.instant().plus(settings.pollInterval());
                }
                synchronized (this) {
                    var now = clock.instant();
                    if (failures == 3) {
                        failWaiting();
                        return;
                    }
                    for (var item : round) {
                        DeployOutcome outcome = item.judge(now, statuses.get(item.id()));
                        if (outcome != null) {
                            waiting.remove(item);
                            item.outcome().complete(outcome);
                        }
                    }
                    if (waiting.isEmpty()) return;
                }
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            failWaiting();
        } catch (RuntimeException failure) {
            failWaiting();
        }
    }

    private synchronized void failWaiting() {
        waiting.forEach(item -> item.outcome().complete(FAILED));
        waiting.clear();
    }

    @Override public void close() {
        reader.shutdownNow();
        reader.close();
    }
}
