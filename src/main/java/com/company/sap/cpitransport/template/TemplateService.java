package com.company.sap.cpitransport.template;

import com.company.sap.cpitransport.audit.AuditChange;
import com.company.sap.cpitransport.audit.AuditStore;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.model.TemplateRef;
import com.company.sap.cpitransport.tenant.TenantRegistry;
import jakarta.annotation.PostConstruct;
import org.slf4j.LoggerFactory;
import java.time.Clock;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
public class TemplateService {
    private final TemplateStore store;
    private final TenantRegistry tenants;
    private final AuditStore audit;
    private final Clock clock;

    public TemplateService(TemplateStore store, TenantRegistry tenants, AuditStore audit, Clock clock) {
        this.store = store;
        this.tenants = tenants;
        this.audit = audit;
        this.clock = clock;
    }

    @PostConstruct
    void upgradeTemplates() {
        try {
            for (var t : store.deleteLegacyTemplates()) {
                audit.append(new AuditChange("template", "deleted", t.id(), t.name(), "업그레이드로 삭제"));
            }
        } catch (ApiException failure) {
            // Keep startup available; template APIs report the unreadable store.
            LoggerFactory.getLogger(TemplateService.class).warn("Template store upgrade failed");
        }
    }

    // Serialize template operations with the entire cascade, including rollback.
    // This monitor is separate from the registry monitor used by tenant caches.
    public synchronized List<TemplateView> list() {
        var entries = store.findAll();
        var ids = new HashSet<String>();
        tenants.list().forEach(t -> ids.add(t.id()));
        return entries.stream().map(t -> view(t, ids)).toList();
    }

    public TemplateRef resolve(String id, String sourceId, String targetId) {
        var template = list().stream().filter(t -> t.id().equals(id)).findFirst()
                .orElseThrow(() -> new ApiException(Code.TEMPLATE_NOT_FOUND));
        if (!template.usable() || !template.sourceTenantId().equals(sourceId)
                || !template.targetTenantId().equals(targetId)) throw new ApiException(Code.TEMPLATE_MISMATCH);
        return new TemplateRef(template.id(), template.name());
    }

    public synchronized TemplateView create(Supplier<JsonNode> body) { return save(null, body); }
    public synchronized TemplateView update(String id, Supplier<JsonNode> body) { return save(id, body); }

    private TemplateView save(String id, Supplier<JsonNode> bodyReader) {
        // Lock order: template service, registry, then template store.
        synchronized (tenants) {
            var saved = new ArrayList<StoredTemplate>();
            store.update(entries -> {
                var previous = id == null ? null : require(entries, id);
                var body = bodyReader.get();
                if (body == null || !body.isObject()) throw new ApiException(Code.INVALID_REQUEST);
                String name = required(body, "name").strip();
                if (name.isBlank() || name.codePointCount(0, name.length()) > 60) throw new ApiException(Code.INVALID_REQUEST);
                String source = required(body, "sourceTenantId"), target = required(body, "targetTenantId");
                if (source.equals(target) || tenants.find(source).isEmpty() || tenants.find(target).isEmpty())
                    throw new ApiException(Code.INVALID_REQUEST);
                String folded = name.toLowerCase(Locale.ROOT);
                if (entries.stream().anyMatch(t -> !t.id().equals(id) && t.name().toLowerCase(Locale.ROOT).equals(folded)))
                    throw new ApiException(Code.TEMPLATE_NAME_DUPLICATE);
                var now = clock.instant();
                var replacement = new StoredTemplate(id == null ? UUID.randomUUID().toString() : id,
                        name, source, target, previous == null ? now : previous.createdAt(), now);
                var next = new ArrayList<>(entries);
                if (previous == null) next.add(replacement); else next.set(next.indexOf(previous), replacement);
                saved.add(replacement);
                return next;
            });
            var result = saved.getFirst();
            record(result, id == null ? "created" : "updated");
            return view(result, Set.of(result.sourceTenantId(), result.targetTenantId()));
        }
    }

    public synchronized void delete(String id) {
        synchronized (tenants) {
            var deleted = new ArrayList<StoredTemplate>();
            store.update(entries -> {
                var previous = require(entries, id);
                var next = new ArrayList<>(entries);
                next.remove(previous);
                deleted.add(previous);
                return next;
            });
            record(deleted.getFirst(), "deleted");
        }
    }

    public synchronized void deleteTenant(String id) {
        // Validate first; a template write failure must leave the tenant intact.
        var original = new ArrayList<StoredTemplate>();
        var deleted = new ArrayList<StoredTemplate>();
        synchronized (tenants) {
            tenants.requireDeletable(id);
            store.update(entries -> {
                original.addAll(entries);
                var next = new ArrayList<StoredTemplate>();
                for (var t : entries) {
                    if (t.sourceTenantId().equals(id) || t.targetTenantId().equals(id)) deleted.add(t);
                    else next.add(t);
                }
                return next;
            });
        }
        // Tenant cache invalidation must run outside the registry monitor (REQ-301).
        // Keep the service monitor through commit/rollback so create/update cannot leave dangling templates.
        try {
            tenants.delete(id);
        } catch (ApiException failure) {
            store.update(entries -> original);
            throw failure;
        }
        deleted.forEach(t -> record(t, "deleted"));
    }

    private void record(StoredTemplate t, String action) {
        audit.append(new AuditChange("template", action, t.id(), t.name(), "Template " + action));
    }

    private static StoredTemplate require(List<StoredTemplate> entries, String id) {
        return entries.stream().filter(t -> t.id().equals(id)).findFirst()
                .orElseThrow(() -> new ApiException(Code.TEMPLATE_NOT_FOUND));
    }

    private static String required(JsonNode body, String field) {
        var value = body.get(field);
        if (value == null || !value.isString() || value.asString().isBlank()) throw new ApiException(Code.INVALID_REQUEST);
        return value.asString();
    }

    private static TemplateView view(StoredTemplate t, Set<String> tenantIds) {
        String reason = !tenantIds.contains(t.sourceTenantId()) ? "SOURCE_TENANT_MISSING"
                : !tenantIds.contains(t.targetTenantId()) ? "TARGET_TENANT_MISSING" : null;
        return new TemplateView(t.id(), t.name(), t.sourceTenantId(), t.targetTenantId(),
                t.createdAt(), t.updatedAt(), reason == null, reason);
    }
}
