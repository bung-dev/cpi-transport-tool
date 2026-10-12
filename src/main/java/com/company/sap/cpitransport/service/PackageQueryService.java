package com.company.sap.cpitransport.service;

import java.util.List;
import com.company.sap.cpitransport.client.CpiApiClient;
import com.company.sap.cpitransport.client.CpiCallException;
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
        return packages("DEV");
    }

    public List<ArtifactSummary> packages(String tenantId) {
        requireTenant(tenantId);
        return client.listPackages(tenantId).stream()
                .map(p -> new ArtifactSummary(p.id(), p.name(), p.version())).toList();
    }

    public List<ArtifactSummary> artifacts(String packageId) {
        return artifacts("DEV", packageId);
    }

    public List<ArtifactSummary> artifacts(String tenantId, String packageId) {
        requireTenant(tenantId);
        try {
            if (client.getPackage(tenantId, packageId).isEmpty()) {
                throw new ApiException(Code.PACKAGE_NOT_FOUND);
            }
            return client.listArtifacts(tenantId, packageId).stream()
                    .map(a -> new ArtifactSummary(a.id(), a.name(), a.version())).toList();
        } catch (CpiCallException failure) {
            // A token-endpoint 404 is an authentication failure, not a missing package.
            if (Integer.valueOf(404).equals(failure.httpStatus())
                    && !failure.isTokenStageFailure()) {
                throw new ApiException(Code.PACKAGE_NOT_FOUND);
            }
            throw failure;
        }
    }

    private void requireTenant(String tenantId) {
        guard.resolve(tenantId);
        var missing = guard.missingKeys(tenantId);
        if (!missing.isEmpty()) throw new EnvironmentNotConfiguredException(missing);
    }
}
