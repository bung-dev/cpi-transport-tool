package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.template.TemplateService;
import com.company.sap.cpitransport.template.TemplateView;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.DeserializationFeature;

@RestController
@RequestMapping("/templates")
public class TemplateController {
    private final TemplateService templates;
    private final ObjectMapper json;

    public TemplateController(TemplateService templates, ObjectMapper json) {
        this.templates = templates;
        this.json = json;
    }

    @GetMapping
    public List<TemplateView> list() { return templates.list(); }

    @PostMapping
    public ResponseEntity<TemplateView> create(HttpServletRequest request) {
        return ResponseEntity.status(201).body(templates.create(() -> body(request)));
    }

    @PutMapping("/{id}")
    public TemplateView update(@PathVariable String id, HttpServletRequest request) {
        return templates.update(id, () -> body(request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        templates.delete(id);
        return ResponseEntity.noContent().build();
    }

    private JsonNode body(HttpServletRequest request) {
        try {
            byte[] bytes = request.getInputStream().readNBytes(65_537);
            if (bytes.length > 65_536) throw new ApiException(Code.INVALID_REQUEST);
            return json.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(bytes);
        } catch (IOException | tools.jackson.core.JacksonException ignored) {
            throw new ApiException(Code.INVALID_REQUEST);
        }
    }
}
