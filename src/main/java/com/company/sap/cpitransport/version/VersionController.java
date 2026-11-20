package com.company.sap.cpitransport.version;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class VersionController {
    private final AppVersion version;

    public VersionController(AppVersion version) {
        this.version = version;
    }

    @GetMapping("/version")
    public AppVersion current() {
        return version;
    }
}
