package com.company.sap.cpitransport.controller;

import java.util.ArrayList;
import com.company.sap.cpitransport.template.TemplateService;
import com.company.sap.cpitransport.config.ReadOnlyProperties;
import org.springframework.beans.factory.annotation.Autowired;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.EnvironmentGuard;
import com.company.sap.cpitransport.service.TransportService;
import com.company.sap.cpitransport.service.TransportHistoryStore;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

@RestController
public class TransportController {
    private final TransportService service;
    private final EnvironmentGuard guard;
    private final TransportHistoryStore history;

    private final ReadOnlyProperties readOnly;
    private final TemplateService templates;

    public TransportController(TransportService service, EnvironmentGuard guard, TransportHistoryStore history) {
        this(service, guard, history, new ReadOnlyProperties(true));
    }

    public TransportController(TransportService service, EnvironmentGuard guard, TransportHistoryStore history,
                               ReadOnlyProperties readOnly) {
        this(service, guard, history, readOnly, null);
    }

    @Autowired
    public TransportController(TransportService service, EnvironmentGuard guard, TransportHistoryStore history,
                               ReadOnlyProperties readOnly, TemplateService templates) {
        this.templates = templates;
        this.service = service;
        this.guard = guard;
        this.history = history;
        this.readOnly = readOnly;
    }

    @PostMapping("/transport")
    public TransportResponse transport(@RequestBody JsonNode body) {
        if (!body.isObject() || !validId(body.get("packageId"))) invalid();
        var ids = new ArrayList<String>();
        var selected = body.get("artifactIds");
        if (selected != null) {
            if (!selected.isArray() || selected.size() > 100) invalid();
            for (var id : selected) {
                if (!validId(id)) invalid();
                ids.add(id.asString());
            }
        }
        boolean dryRun = flag(body, "dryRun");
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
        var response = service.preflightAndExecute(new TransportRequest(body.get("packageId").asString(), ids, dryRun, deploy, source, target));
        if (template != null) response = response.withTemplate(template);
        history.append(response);
        return response;
    }

    @GetMapping("/transport/history")
    public java.util.List<TransportResponse> history() {
        return history.findAll();
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

    @ExceptionHandler({HttpMessageNotReadableException.class,
            org.springframework.web.HttpMediaTypeNotSupportedException.class})
    public ResponseEntity<ErrorResponse> unreadable() {
        return ResponseEntity.badRequest().body(new ErrorResponse("INVALID_REQUEST", "Invalid request"));
    }

}
