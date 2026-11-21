package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.job.TransportJobService;
import com.company.sap.cpitransport.job.TransportRun;
import com.company.sap.cpitransport.model.ErrorResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/transport/jobs")
public class TransportJobController implements TransportRequestErrors {
    private final TransportRequestParser parser;
    private final TransportJobService jobs;

    public TransportJobController(TransportRequestParser parser, TransportJobService jobs) {
        this.parser = parser;
        this.jobs = jobs;
    }

    @PostMapping
    public ResponseEntity<TransportRun.Started> start(@RequestBody JsonNode body) {
        var parsed = parser.parse(body);
        return ResponseEntity.accepted().body(jobs.start(parsed.request(), parsed.template()));
    }

    @PostMapping("/retry")
    public ResponseEntity<TransportRun.Started> retry(@RequestBody JsonNode body) {
        var id = body.path("transportId");
        if (!body.isObject() || !id.isString() || id.asString().isBlank()) {
            throw new ErrorResponse.ApiException(ErrorResponse.Code.INVALID_REQUEST);
        }
        var original = jobs.retrySource(id.asString());
        return ResponseEntity.accepted().body(jobs.start(parser.retryRequest(original), null));
    }

    @GetMapping("/active")
    public ResponseEntity<TransportRun.Active> active() {
        var active = jobs.active();
        return active == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(active);
    }

    @GetMapping("/{id}")
    public TransportRun.Snapshot get(@PathVariable String id) {
        return jobs.snapshot(id);
    }

    @PostMapping("/{id}/cancel")
    public ResponseEntity<Void> cancel(@PathVariable String id) {
        jobs.cancel(id);
        return ResponseEntity.accepted().build();
    }
}
