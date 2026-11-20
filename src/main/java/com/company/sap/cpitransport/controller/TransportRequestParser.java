package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.config.ReadOnlyProperties;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.EnvironmentGuard;
import com.company.sap.cpitransport.template.TemplateService;
import java.util.ArrayList;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

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

    Parsed parse(JsonNode body) {
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
        return new Parsed(new TransportRequest(packages, createPackages, dryRun, deploy, source, target), template);
    }

    private static PackageSelection selection(JsonNode body) {
        if (!body.isObject() || !validId(body.get("packageId"))) invalid();
        var ids = new ArrayList<String>();
        var selected = body.get("artifactIds");
        if (selected != null && !selected.isNull()) {
            if (!selected.isArray() || selected.size() > 100) invalid();
            for (var id : selected) {
                if (!validId(id)) invalid();
                ids.add(id.asString());
            }
        }
        return new PackageSelection(body.get("packageId").asString(), ids);
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
