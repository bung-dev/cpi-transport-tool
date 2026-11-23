package com.company.sap.cpitransport.controller;

import java.time.Clock;
import java.util.List;
import java.util.function.Predicate;
import com.company.sap.cpitransport.template.TemplateService;
import com.company.sap.cpitransport.config.ReadOnlyProperties;
import org.springframework.beans.factory.annotation.Autowired;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.EnvironmentGuard;
import com.company.sap.cpitransport.service.HistoryCriteria;
import com.company.sap.cpitransport.service.TransportService;
import com.company.sap.cpitransport.service.TransportHistoryStore;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

@RestController
public class TransportController implements TransportRequestErrors {
    private final TransportService service;
    private final TransportRequestParser parser;
    private final TransportHistoryStore history;

    private final Clock clock;

    public TransportController(TransportService service, EnvironmentGuard guard, TransportHistoryStore history) {
        this(service, guard, history, new ReadOnlyProperties(true));
    }

    public TransportController(TransportService service, EnvironmentGuard guard, TransportHistoryStore history,
                               ReadOnlyProperties readOnly) {
        this(service, guard, history, readOnly, null, Clock.systemUTC());
    }

    public TransportController(TransportService service, EnvironmentGuard guard, TransportHistoryStore history,
                               ReadOnlyProperties readOnly, TemplateService templates, Clock clock) {
        this(service, new TransportRequestParser(guard, readOnly, templates), history, clock);
    }

    @Autowired
    TransportController(TransportService service, TransportRequestParser parser, TransportHistoryStore history, Clock clock) {
        this.clock = clock;
        this.service = service;
        this.parser = parser;
        this.history = history;
    }

    @PostMapping("/transport")
    public TransportResponse transport(@RequestBody JsonNode body) {
        var parsed = parser.parse(body);
        var response = service.preflightAndExecute(parsed.request());
        if (parsed.template() != null) response = response.withTemplate(parsed.template());
        history.append(response);
        return response;
    }

    @GetMapping("/transport/history")
    public List<TransportResponse> history(@RequestParam(required = false) String date,
                                           @RequestParam(required = false) String mode,
                                           @RequestParam(required = false) String result) {
        if (date == null && mode == null && result == null) return history.findAll();

        Predicate<TransportResponse> filter = t -> true;
        if (date != null) {
            if (!date.equals("today")) invalid();
            filter = HistoryCriteria.startedToday(clock);
        }
        if (mode != null) {
            switch (mode) {
                case "preview" -> filter = filter.and(TransportResponse::dryRun);
                case "real" -> filter = filter.and(t -> !t.dryRun());
                default -> invalid();
            }
        }
        if (result != null) {
            switch (result) {
                case "succeeded" -> filter = filter.and(HistoryCriteria::succeeded);
                case "failed" -> filter = filter.and(HistoryCriteria::failed);
                default -> invalid();
            }
        }
        return history.findAll().stream().filter(filter).toList();
    }

    private static void invalid() { throw new ErrorResponse.ApiException(ErrorResponse.Code.INVALID_REQUEST); }
}
