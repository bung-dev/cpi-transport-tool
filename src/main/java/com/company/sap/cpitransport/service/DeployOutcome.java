package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.model.DeployStatus;

public record DeployOutcome(DeployStatus status, DeployFailure failure) {
    public enum DeployFailure { NONE, RUNTIME_ERROR, CALL_FAILED }
}
