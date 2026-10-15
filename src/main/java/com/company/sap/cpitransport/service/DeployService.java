package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.CpiApiClient;
import com.company.sap.cpitransport.client.CpiCallException;
import com.company.sap.cpitransport.client.Sleeper;
import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.DeployStatus;
import com.company.sap.cpitransport.model.ArtifactError;
import java.util.List;
import static com.company.sap.cpitransport.service.DeployOutcome.DeployFailure.*;
import java.time.Clock;
import java.time.Duration;
import org.springframework.stereotype.Service;

@Service
public class DeployService {
    private final CpiApiClient api;
    private final Clock clock;
    private final Sleeper sleeper;
    private final TransportProperties.Deploy settings;

    public DeployService(CpiApiClient api, TransportProperties properties, Clock clock, Sleeper sleeper) {
        this.api = api;
        this.clock = clock;
        this.sleeper = sleeper;
        this.settings = properties.deploy();
        if (settings.pollInterval().isZero() || settings.pollInterval().isNegative()
                || settings.timeout().isZero() || settings.timeout().isNegative()) {
            throw new IllegalArgumentException("Deployment durations must be positive");
        }
    }

    public DeployStatus deployAndWait(String id) { return deployAndWait("PRD", id); }

    public DeployStatus deployAndWait(String targetTenantId, String id) {
        return deployAndWaitOutcome(targetTenantId, id).status();
    }

    public DeployOutcome deployAndWaitOutcome(String targetTenantId, String id) {
        try {
            api.deploy(targetTenantId, id);
            var deadline = clock.instant().plus(settings.timeout());
            // Poll first after one interval; the deadline is exclusive.
            // Cap the last wait when timeout is not divisible by the interval.
            while (clock.instant().isBefore(deadline)) {
                Duration remaining = Duration.between(clock.instant(), deadline);
                if (remaining.isNegative() || remaining.isZero()) break;
                sleeper.sleep(remaining.compareTo(settings.pollInterval()) < 0
                        ? remaining : settings.pollInterval());
                if (!clock.instant().isBefore(deadline)) break;
                String status = api.getRuntimeStatus(targetTenantId, id).orElse("");
                if (!clock.instant().isBefore(deadline)) break;
                if ("STARTED".equals(status)) return new DeployOutcome(DeployStatus.STARTED, NONE);
                if ("ERROR".equals(status)) return new DeployOutcome(DeployStatus.ERROR, RUNTIME_ERROR);
            }
            return new DeployOutcome(DeployStatus.TIMEOUT, NONE);
        } catch (CpiCallException failure) {
            return new DeployOutcome(DeployStatus.ERROR, CALL_FAILED);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            return new DeployOutcome(DeployStatus.ERROR, CALL_FAILED);
        }
    }
    public ArtifactError errorDetail(String tenantId, String id, List<String> sensitiveValues) {
        var response = api.getDeployErrorInformation(tenantId, id);
        String detail = response.status() == 200 ? DeployErrorDetail.mask(response.body(), response.secrets(),
                response.apiUrl(), response.tokenUrl(), sensitiveValues) : null;
        return new ArtifactError("DEPLOY_FAILED", "DEPLOY: CPI deployment ERROR", detail, response.status());
    }

}