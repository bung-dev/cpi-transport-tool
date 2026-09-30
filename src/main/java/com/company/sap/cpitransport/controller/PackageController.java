package com.company.sap.cpitransport.controller;

import java.util.List;
import com.company.sap.cpitransport.model.ArtifactSummary;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.service.PackageQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PackageController {
    private final PackageQueryService service;
    public PackageController(PackageQueryService service) { this.service = service; }

    @GetMapping("/packages")
    public List<ArtifactSummary> packages() { return service.packages(); }

    @GetMapping("/packages/{packageId}/artifacts")
    public List<ArtifactSummary> artifacts(@PathVariable("packageId") String packageId) {
        if (!packageId.matches("^[A-Za-z0-9_.-]{1,100}$")) {
            throw new ApiException(Code.INVALID_REQUEST);
        }
        return service.artifacts(packageId);
    }
}
