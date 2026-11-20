package com.company.sap.cpitransport.dashboard;

import com.company.sap.cpitransport.dashboard.DashboardResponse.*;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.model.TransportResponse;
import com.company.sap.cpitransport.model.ArtifactResult;
import com.company.sap.cpitransport.model.ArtifactStatus;
import com.company.sap.cpitransport.model.TargetPackageStatus;
import com.company.sap.cpitransport.service.HistoryCriteria;
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
    private record PackageArrival(TransportResponse transport, int artifactCount) {}
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
        var arrivals = new LinkedHashMap<Arrival, PackageArrival>();
        var departures = new HashMap<Departure, Instant>();
        int previews = 0, transports = 0, succeeded = 0, failed = 0;
        var startedToday = HistoryCriteria.startedToday(clock);
        for (var t : records) {
            if (startedToday.test(t)) {
                if (t.dryRun()) previews++;
                else {
                    transports++;
                    if (HistoryCriteria.succeeded(t)) succeeded++;
                    else if (HistoryCriteria.failed(t)) failed++;
                }
            }
            if (t.dryRun()) continue;
            // Histories predating tenant selection used the fixed DEV -> PRD route.
            String source = t.sourceTenant() == null ? "DEV" : t.sourceTenant().id();
            String target = t.targetTenant() == null ? "PRD" : t.targetTenant().id();
            var perPackage = new LinkedHashMap<String, List<ArtifactResult>>();
            var unavailablePackages = new HashSet<String>();
            // Include empty packages in request order, including normalized legacy history.
            if (t.packages() != null) {
                for (var pkg : t.packages()) {
                    perPackage.computeIfAbsent(pkg.packageId(), key -> new ArrayList<>());
                    var status = pkg.targetPackage();
                    if (status != null && status != TargetPackageStatus.EXISTING && status != TargetPackageStatus.CREATED)
                        unavailablePackages.add(pkg.packageId());
                }
            }
            for (var result : t.results()) {
                perPackage.computeIfAbsent(result.packageId(), key -> new ArrayList<>()).add(result);
            }
            for (var entry : perPackage.entrySet()) {
                if (unavailablePackages.contains(entry.getKey())
                        || entry.getValue().stream().anyMatch(r -> r.status() == ArtifactStatus.FAILED)) continue;
                arrivals.merge(new Arrival(entry.getKey(), target), new PackageArrival(t, entry.getValue().size()),
                        (a, b) -> a.transport().startedAt().isBefore(b.transport().startedAt()) ? b : a);
                departures.merge(new Departure(entry.getKey(), source, target), t.startedAt(),
                        (a, b) -> a.isBefore(b) ? b : a);
            }
        }
        var queue = new ArrayList<QueueItem>();
        for (var entry : arrivals.entrySet()) {
            var arrival = entry.getKey();
            var transport = entry.getValue().transport();
            for (var t : selected) {
                if (!t.sourceTenantId().equals(arrival.tenantId())) continue;
                var sentAt = departures.get(new Departure(arrival.packageId(), t.sourceTenantId(), t.targetTenantId()));
                if (sentAt != null && sentAt.isAfter(transport.startedAt())) continue;
                queue.add(new QueueItem(arrival.packageId(), arrival.tenantId(), t.id(), t.targetTenantId(),
                        transport.transportId(), transport.startedAt(), entry.getValue().artifactCount()));
            }
        }
        return new DashboardResponse(nodes, edges, List.copyOf(queue), new Today(previews, transports, succeeded, failed));
    }
}
