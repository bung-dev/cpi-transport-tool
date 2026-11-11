package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.dashboard.DashboardResponse;
import com.company.sap.cpitransport.dashboard.DashboardService;
import org.springframework.web.bind.annotation.*;

@RestController
public class DashboardController {
    private final DashboardService dashboard;
    public DashboardController(DashboardService dashboard) { this.dashboard = dashboard; }

    @GetMapping("/dashboard")
    public DashboardResponse get(@RequestParam(required = false) String templateId) {
        return dashboard.get(templateId);
    }
}
