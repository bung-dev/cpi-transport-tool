package com.company.sap.cpitransport.service;

import java.util.List;
import com.company.sap.cpitransport.client.CpiApiClient;
import com.company.sap.cpitransport.client.CpiCallException;
import com.company.sap.cpitransport.client.CpiEnvironment;
import com.company.sap.cpitransport.config.CpiProperties.Environment;
import com.company.sap.cpitransport.model.ArtifactSummary;
import com.company.sap.cpitransport.model.EnvironmentNotConfiguredException;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import org.springframework.stereotype.Service;

@Service
public class PackageQueryService {
    private final EnvironmentGuard guard;
    private final CpiApiClient client;
    public PackageQueryService(EnvironmentGuard guard, CpiApiClient client) {
        this.guard = guard;
        this.client = client;
    }

    public List<ArtifactSummary> packages() {
        requireDev();
        return client.listPackages(CpiEnvironment.DEV).stream()
                .map(p -> new ArtifactSummary(p.id(), p.name(), p.version())).toList();
    }

    public List<ArtifactSummary> artifacts(String packageId) {
        requireDev();
        try {
            if (client.getPackage(CpiEnvironment.DEV, packageId).isEmpty()) {
                throw new ApiException(Code.PACKAGE_NOT_FOUND);
            }
            return client.listArtifacts(CpiEnvironment.DEV, packageId).stream()
                    .map(a -> new ArtifactSummary(a.id(), a.name(), a.version())).toList();
        } catch (CpiCallException failure) {
            // AI-NOTE: The existing executor exposes token failure origin only through this
            // fixed summary. Keep token 404 distinct from a package resource 404.
            if (Integer.valueOf(404).equals(failure.httpStatus())
                    && !"CPI authentication failed".equals(failure.getMessage())) {
                throw new ApiException(Code.PACKAGE_NOT_FOUND);
            }
            throw failure;
        }
    }

    private void requireDev() {
        var missing = guard.missingKeys(Environment.DEV);
        if (!missing.isEmpty()) throw new EnvironmentNotConfiguredException(missing);
    }
}
