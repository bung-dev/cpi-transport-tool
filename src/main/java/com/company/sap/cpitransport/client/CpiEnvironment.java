package com.company.sap.cpitransport.client;

import com.company.sap.cpitransport.config.CpiProperties.Environment;

public enum CpiEnvironment {
    DEV, PRD;

    public Environment configurationEnvironment() {
        return Environment.valueOf(name());
    }
}
