package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.config.ReadOnlyProperties;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.EnvironmentGuard;
import com.company.sap.cpitransport.template.TemplateService;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;

@Component
public class TransportRequestParser {
    record Parsed(TransportRequest request, TemplateRef template) {}

    private final EnvironmentGuard guard;
    private final ReadOnlyProperties readOnly;
    private final TemplateService templates;

    public TransportRequestParser(EnvironmentGuard guard, ReadOnlyProperties readOnly, TemplateService templates) {
        this.guard = guard;
        this.readOnly = readOnly;
        this.templates = templates;
    }

    TransportRequest retryRequest(TransportResponse original) {
        var idsByPackage = new HashMap<String, List<String>>();
        for (var result : original.results()) {
            if (result.status() == ArtifactStatus.FAILED) {
                idsByPackage.computeIfAbsent(result.packageId(), key -> new ArrayList<>()).add(result.artifactId());
            }
        }
        if (original.skipped() != null) {
            for (var item : original.skipped()) {
                idsByPackage.computeIfAbsent(item.packageId(), key -> new ArrayList<>()).add(item.artifactId());
            }
        }

        var body = JsonNodeFactory.instance.objectNode();
        body.put("deploy", original.deploy());
        if (original.sourceTenant() != null) body.put("sourceTenantId", original.sourceTenant().id());
        if (original.targetTenant() != null) body.put("targetTenantId", original.targetTenant().id());
        var packages = body.putArray("packages");
        var create = body.putArray("createPackages");
        for (var pkg : original.packages()) {
            var ids = idsByPackage.get(pkg.packageId());
            if (ids == null) continue;
            var selected = packages.addObject().put("packageId", pkg.packageId()).putArray("artifactIds");
            ids.forEach(selected::add);
            var targetStatus = pkg.targetPackage();
            if (targetStatus == TargetPackageStatus.CREATE_FAILED || targetStatus == TargetPackageStatus.NOT_FOUND
                    || targetStatus == TargetPackageStatus.NOT_CHECKED) {
                create.add(pkg.packageId());
            }
        }
        if (packages.isEmpty()) throw new ErrorResponse.ApiException(ErrorResponse.Code.NOTHING_TO_RETRY);
        return parse(body, original.transportId()).request();
    }

    Parsed parse(JsonNode body) {
        return parse(body, null);
    }

    private Parsed parse(JsonNode body, String retryOf) {
        if (!body.isObject()) invalid();
        var packages = new ArrayList<PackageSelection>();
        if (body.has("packages")) {
            var selected = body.get("packages");
            if (body.has("packageId") || !selected.isArray() || selected.isEmpty()) invalid();
            for (var entry : selected) packages.add(selection(entry));
        } else {
            packages.add(selection(body));
        }
        var packageIds = new java.util.HashSet<String>();
        for (var selected : packages) if (!packageIds.add(selected.packageId())) invalid();
        boolean dryRun = flag(body, "dryRun");
        var previewId = body.get("previewId");
        if (previewId != null && !previewId.isString()) invalid();
        var createPackages = new ArrayList<String>();
        if (body.has("createPackages")) {
            var create = body.get("createPackages");
            if (!create.isArray()) invalid();
            for (var id : create) {
                if (!validId(id) || !packageIds.contains(id.asString())) invalid();
                createPackages.add(id.asString());
            }
        }
        boolean deploy = flag(body, "deploy");
        String sourceId = tenantId(body, "sourceTenantId", "DEV");
        String targetId = tenantId(body, "targetTenantId", "PRD");
        TemplateRef template = null;
        if (body.has("templateId")) {
            String templateId = tenantId(body, "templateId", null);
            if (templates == null) throw new ErrorResponse.ApiException(ErrorResponse.Code.TEMPLATE_NOT_FOUND);
            template = templates.resolve(templateId, sourceId, targetId);
        }
        if (sourceId.equals(targetId)) invalid();
        if (!dryRun && readOnly.readOnly()) throw new ErrorResponse.ApiException(ErrorResponse.Code.READ_ONLY_MODE);
        var source = guard.resolve(sourceId);
        var target = guard.resolve(targetId);
        var missing = new ArrayList<>(guard.missingKeys(sourceId));
        if (!dryRun) missing.addAll(guard.missingKeys(targetId));
        if (!missing.isEmpty()) throw new EnvironmentNotConfiguredException(missing);
        return new Parsed(new TransportRequest(packages, createPackages, dryRun, deploy, source, target,
                dryRun || previewId == null ? null : previewId.asString(), retryOf), template);
    }

    private static PackageSelection selection(JsonNode body) {
        if (!body.isObject() || !validId(body.get("packageId"))) invalid();
        List<String> ids = null;
        var selected = body.get("artifactIds");
        if (selected != null && !selected.isNull()) {
            if (!selected.isArray() || selected.size() > 100) invalid();
            ids = new ArrayList<>();
            for (var id : selected) {
                if (!validId(id)) invalid();
                ids.add(id.asString());
            }
        }
        return new PackageSelection(body.get("packageId").asString(), ids, objectIds(body, "scriptCollectionIds"),
                objectIds(body, "messageMappingIds"), objectIds(body, "valueMappingIds"));
    }

    private static List<String> objectIds(JsonNode body, String key) {
        var selected = body.get(key);
        if (selected == null) return null;
        if (!selected.isArray()) invalid();
        var ids = new LinkedHashSet<String>();
        for (var id : selected) {
            if (!validId(id) || !ids.add(id.asString())) invalid();
        }
        return List.copyOf(ids);
    }

    private static String tenantId(JsonNode body, String key, String fallback) {
        var value = body.get(key);
        if (value == null) return fallback;
        if (!value.isString() || value.asString().isBlank()) invalid();
        return value.asString();
    }

    private static boolean validId(JsonNode value) {
        return value != null && value.isString() && value.asString().matches("^[A-Za-z0-9_.-]{1,100}$");
    }

    private static boolean flag(JsonNode body, String name) {
        var value = body.get(name);
        if (value == null) return false;
        if (!value.isBoolean()) invalid();
        return value.asBoolean();
    }

    private static void invalid() { throw new ErrorResponse.ApiException(ErrorResponse.Code.INVALID_REQUEST); }

}
