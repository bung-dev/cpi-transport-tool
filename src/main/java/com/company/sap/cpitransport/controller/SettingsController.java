package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.model.ConcurrencySettings;
import com.company.sap.cpitransport.settings.SettingsService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/settings")
public class SettingsController {
    private final SettingsService settings;

    public SettingsController(SettingsService settings) {
        this.settings = settings;
    }

    @GetMapping
    public ConcurrencySettings current() {
        return settings.current();
    }

    @PutMapping
    public ConcurrencySettings update(@RequestBody(required = false) byte[] body) {
        return settings.update(body);
    }
}
