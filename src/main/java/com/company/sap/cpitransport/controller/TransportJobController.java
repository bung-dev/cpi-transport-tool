package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.job.TransportJobService;
import com.company.sap.cpitransport.job.TransportRun;
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

    @GetMapping("/active")
    public ResponseEntity<TransportRun.Active> active() {
        var active = jobs.active();
        return active == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(active);
    }

    @GetMapping("/{id}")
    public TransportRun.Snapshot get(@PathVariable String id) {
        return jobs.require(id).snapshot();
    }

    @PostMapping("/{id}/cancel")
    public ResponseEntity<Void> cancel(@PathVariable String id) {
        jobs.require(id).cancel();
        return ResponseEntity.accepted().build();
    }
}
