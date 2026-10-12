package com.company.sap.cpitransport.controller;
import com.company.sap.cpitransport.model.TenantStatusResponse;
import com.company.sap.cpitransport.service.TenantStatusService;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/tenants/status")
public class TenantStatusController {
    private final TenantStatusService service;
    public TenantStatusController(TenantStatusService service) { this.service = service; }
    @GetMapping
    public TenantStatusResponse status(@RequestParam(required = false) String tenantId,
                                      @RequestParam(defaultValue = "false") boolean refresh) {
        return service.status(tenantId, refresh);
    }
}
