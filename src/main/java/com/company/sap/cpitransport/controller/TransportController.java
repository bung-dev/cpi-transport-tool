package com.company.sap.cpitransport.controller;

import java.util.ArrayList;
import com.company.sap.cpitransport.config.ReadOnlyProperties;
import org.springframework.beans.factory.annotation.Autowired;
import com.company.sap.cpitransport.config.CpiProperties.Environment;
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

    public TransportController(TransportService service, EnvironmentGuard guard, TransportHistoryStore history) {
        this(service, guard, history, new ReadOnlyProperties(true));
    }

    @Autowired
    public TransportController(TransportService service, EnvironmentGuard guard, TransportHistoryStore history,
                               ReadOnlyProperties readOnly) {
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
        if (!dryRun && readOnly.readOnly()) throw new ErrorResponse.ApiException(ErrorResponse.Code.READ_ONLY_MODE);
        var missing = new ArrayList<>(guard.missingKeys(Environment.DEV));
        if (!dryRun) missing.addAll(guard.missingKeys(Environment.PRD));
        if (!missing.isEmpty()) throw new EnvironmentNotConfiguredException(missing);
        var response = service.preflightAndExecute(new TransportRequest(body.get("packageId").asString(), ids, dryRun, deploy));
        history.append(response);
        return response;
    }

    @GetMapping("/transport/history")
    public java.util.List<TransportResponse> history() {
        return history.findAll();
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

    @ExceptionHandler(MappingInvalidException.class)
    public ResponseEntity<ErrorResponse> mapping(MappingInvalidException failure) {
        return ResponseEntity.status(422).body(new ErrorResponse("MAPPING_INVALID", failure.getMessage()));
    }
}
