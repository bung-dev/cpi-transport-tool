package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.audit.AuditEntry;
import com.company.sap.cpitransport.audit.AuditStore;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.model.TenantRef;
import com.company.sap.cpitransport.service.TransportHistoryStore;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class AuditController {
    private final AuditStore audit;
    private final TransportHistoryStore history;

    public AuditController(AuditStore audit, TransportHistoryStore history) {
        this.audit = audit;
        this.history = history;
    }

    @GetMapping("/audit")
    public List<AuditEntry> list(@RequestParam(defaultValue = "all") String category) {
        if (!Set.of("all", "tenant", "template", "transport").contains(category))
            throw new ApiException(Code.INVALID_REQUEST);
        var entries = new ArrayList<AuditEntry>();
        if (!category.equals("transport")) {
            audit.findAll().stream().filter(e -> category.equals("all") || category.equals(e.category()))
                    .forEach(entries::add);
        }
        if (category.equals("all") || category.equals("transport")) {
            for (var t : history.findAll()) {
                String detail = name(t.sourceTenant(), "DEV") + " -> " + name(t.targetTenant(), "PRD")
                        + ": succeeded " + (t.summary() == null ? 0 : t.summary().succeeded())
                        + ", failed " + (t.summary() == null ? 0 : t.summary().failed());
                entries.add(new AuditEntry(t.transportId(), t.startedAt(), "transport",
                        t.dryRun() ? "preview" : "transport", t.transportId(), t.packageId(), detail));
            }
        }
        entries.sort(Comparator.comparing(AuditEntry::time).reversed());
        return List.copyOf(entries);
    }

    private static String name(TenantRef tenant, String fallback) {
        return tenant == null ? fallback : tenant.name();
    }
}
