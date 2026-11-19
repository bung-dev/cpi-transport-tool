package com.company.sap.cpitransport.template;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

public record TemplateView(String id, String name, String sourceTenantId, String targetTenantId,
                           Instant createdAt, Instant updatedAt, boolean usable,
                           @JsonInclude(JsonInclude.Include.NON_NULL) String unusableReason) {}
