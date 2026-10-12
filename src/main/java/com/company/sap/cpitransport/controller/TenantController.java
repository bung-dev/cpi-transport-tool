package com.company.sap.cpitransport.controller;

import java.io.IOException;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.model.TenantListResponse;
import com.company.sap.cpitransport.model.TenantView;
import com.company.sap.cpitransport.tenant.TenantRegistry;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/tenants")
public class TenantController {
    private final TenantRegistry registry;
    private final ObjectMapper json;
    public TenantController(TenantRegistry registry, ObjectMapper json) {
        this.registry = registry;
        this.json = json;
    }
    @GetMapping
    public TenantListResponse list() { return registry.snapshot(); }
    @PostMapping
    public ResponseEntity<TenantView> register(HttpServletRequest request) {
        return ResponseEntity.status(201).body(registry.register(body(request)));
    }
    @PutMapping("/{id}")
    public TenantView update(@PathVariable String id, HttpServletRequest request) {
        return registry.update(id, () -> body(request));
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        registry.delete(id);
        return ResponseEntity.noContent().build();
    }
    private JsonNode body(HttpServletRequest request) {
        // AI-NOTE: avoid Spring body converters and their TRACE logging (REQ-305 AC-3).
        try {
            byte[] bytes = request.getInputStream().readNBytes(65_537);
            if (bytes.length > 65_536) throw new ApiException(Code.INVALID_REQUEST);
            JsonNode node = json.reader().with(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readTree(bytes);
            if (node == null || !node.isObject()) throw new ApiException(Code.INVALID_REQUEST);
            return node;
        } catch (IOException | tools.jackson.core.JacksonException ignored) {
            throw new ApiException(Code.INVALID_REQUEST);
        }
    }
}
