package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import org.springframework.web.bind.annotation.RequestParam;
import java.util.List;
import com.company.sap.cpitransport.model.ArtifactSummary;
import com.company.sap.cpitransport.model.ArtifactType;
import com.company.sap.cpitransport.service.PackageQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PackageController {
    private final PackageQueryService service;
    public PackageController(PackageQueryService service) { this.service = service; }

    public List<ArtifactSummary> packages() { return service.packages(); }

    @GetMapping("/packages")
    public List<ArtifactSummary> packages(@RequestParam(value = "tenantId", defaultValue = "DEV") String tenantId) { return service.packages(tenantId); }

    @GetMapping("/packages/target-status")
    public List<PackageQueryService.TargetStatus> targetStatus(
            @RequestParam(value = "tenantId", defaultValue = "PRD") String tenantId,
            @RequestParam(value = "packageIds", required = false) String packageIds) {
        if (packageIds == null) throw new ApiException(Code.INVALID_REQUEST);
        var ids = List.of(packageIds.split(",", -1));
        var unique = new java.util.HashSet<String>();
        for (String id : ids) {
            if (!id.matches("^[A-Za-z0-9_.-]{1,100}$") || !unique.add(id))
                throw new ApiException(Code.INVALID_REQUEST);
        }
        return service.targetStatus(tenantId, ids);
    }

    public List<ArtifactSummary> artifacts(String packageId) { return artifacts(packageId, "DEV"); }

    public List<ArtifactSummary> artifacts(String packageId, String tenantId) {
        return artifacts(packageId, tenantId, null);
    }

    @GetMapping("/packages/{packageId}/artifacts")
    public List<ArtifactSummary> artifacts(@PathVariable("packageId") String packageId,
            @RequestParam(value = "tenantId", defaultValue = "DEV") String tenantId,
            @RequestParam(value = "type", required = false) String type) {
        if (!packageId.matches("^[A-Za-z0-9_.-]{1,100}$")) {
            throw new ApiException(Code.INVALID_REQUEST);
        }
        ArtifactType artifactType;
        try {
            artifactType = type == null ? ArtifactType.INTEGRATION_FLOW : ArtifactType.valueOf(type);
        } catch (IllegalArgumentException invalidType) {
            throw new ApiException(Code.INVALID_REQUEST);
        }
        return service.artifacts(tenantId, packageId, artifactType);
    }
}
