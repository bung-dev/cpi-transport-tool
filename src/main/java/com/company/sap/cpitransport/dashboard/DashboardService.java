package com.company.sap.cpitransport.dashboard;

import com.company.sap.cpitransport.dashboard.DashboardResponse.*;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.model.TransportResponse;
import com.company.sap.cpitransport.service.TransportHistoryStore;
import com.company.sap.cpitransport.template.TemplateService;
import com.company.sap.cpitransport.tenant.TenantRegistry;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {
    private final TenantRegistry tenants;
    private final TemplateService templates;
    private final TransportHistoryStore history;
    private final Clock clock;

    public DashboardService(TenantRegistry tenants, TemplateService templates, TransportHistoryStore history, Clock clock) {
        this.tenants = tenants;
        this.templates = templates;
        this.history = history;
        this.clock = clock;
    }

    private record Route(String source, String target) {}
    private record Arrival(String packageId, String tenantId) {}
    private record Departure(String packageId, String source, String target) {}

    public DashboardResponse get(String templateId) {
        var allTemplates = templates.list();
        if (templateId != null && allTemplates.stream().noneMatch(t -> t.id().equals(templateId)))
            throw new ApiException(Code.TEMPLATE_NOT_FOUND);
        var selected = allTemplates.stream().filter(t -> t.usable() && (templateId == null || t.id().equals(templateId))).toList();
        var nodes = tenants.list().stream().map(t -> new Node(t.id(), t.name(), t.source())).toList();
        var routes = new LinkedHashMap<Route, List<String>>();
        for (var t : selected) routes.computeIfAbsent(new Route(t.sourceTenantId(), t.targetTenantId()),
                key -> new ArrayList<>()).add(t.id());
        var edges = routes.entrySet().stream().map(e -> new Edge(e.getKey().source(), e.getKey().target(),
                List.copyOf(e.getValue()))).toList();

        var records = history.findAll();
        var arrivals = new LinkedHashMap<Arrival, TransportResponse>();
        var departures = new HashMap<Departure, Instant>();
        int previews = 0, transports = 0, succeeded = 0, failed = 0;
        var zone = ZoneId.systemDefault();
        var today = LocalDate.ofInstant(clock.instant(), zone);
        for (var t : records) {
            if (LocalDate.ofInstant(t.startedAt(), zone).equals(today)) {
                if (t.dryRun()) previews++;
                else {
                    transports++;
                    if (t.summary() != null && t.summary().failed() == 0) succeeded++;
                    else if (t.summary() != null && t.summary().failed() > 0) failed++;
                }
            }
            if (t.dryRun() || t.summary() == null || t.summary().failed() != 0) continue;
            // Histories predating tenant selection used the fixed DEV -> PRD route.
            String source = t.sourceTenant() == null ? "DEV" : t.sourceTenant().id();
            String target = t.targetTenant() == null ? "PRD" : t.targetTenant().id();
            // Keep the existing whole-transport success rule for this slice.
            for (var selectedPackage : t.packages()) {
                arrivals.merge(new Arrival(selectedPackage.packageId(), target), t,
                        (a, b) -> a.startedAt().isBefore(b.startedAt()) ? b : a);
                departures.merge(new Departure(selectedPackage.packageId(), source, target), t.startedAt(),
                        (a, b) -> a.isBefore(b) ? b : a);
            }
        }
        var queue = new ArrayList<QueueItem>();
        for (var entry : arrivals.entrySet()) {
            var arrival = entry.getKey();
            var transport = entry.getValue();
            for (var t : selected) {
                if (!t.sourceTenantId().equals(arrival.tenantId())
                        || t.packageId() != null && !t.packageId().isBlank() && !t.packageId().equals(arrival.packageId())) continue;
                var sentAt = departures.get(new Departure(arrival.packageId(), t.sourceTenantId(), t.targetTenantId()));
                if (sentAt != null && sentAt.isAfter(transport.startedAt())) continue;
                queue.add(new QueueItem(arrival.packageId(), arrival.tenantId(), t.id(), t.targetTenantId(),
                        transport.transportId(), transport.startedAt(), transport.summary().total()));
            }
        }
        return new DashboardResponse(nodes, edges, List.copyOf(queue), new Today(previews, transports, succeeded, failed));
    }
}
