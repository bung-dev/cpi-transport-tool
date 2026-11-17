package com.company.sap.cpitransport.dashboard;

import java.time.Instant;
import java.util.List;

public record DashboardResponse(List<Node> nodes, List<Edge> edges, List<QueueItem> queue, Today today) {
    public record Node(String id, String name, String origin) {}
    public record Edge(String sourceTenantId, String targetTenantId, List<String> templateIds) {}
    public record QueueItem(String packageId, String atTenantId, String nextTemplateId,
                            String nextTargetTenantId, String arrivedTransportId, Instant arrivedAt, int artifactCount) {}
    public record Today(int previews, int transports, int succeeded, int failed) {}
}
