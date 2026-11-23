package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.client.CpiCallException;
import com.company.sap.cpitransport.job.TransportJobService.AlreadyRunning;
import com.company.sap.cpitransport.model.EnvironmentNotConfiguredException;
import com.company.sap.cpitransport.model.ErrorResponse;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(EnvironmentNotConfiguredException.class)
    public ResponseEntity<ErrorResponse> environment(EnvironmentNotConfiguredException failure) {
        return ResponseEntity.status(503).body(new ErrorResponse(
                Code.ENVIRONMENT_NOT_CONFIGURED.name(), String.join(", ", failure.missingKeys())));
    }

    @ExceptionHandler(CpiCallException.class)
    public ResponseEntity<ErrorResponse> cpi(CpiCallException failure) {
        return response(Code.CPI_UNAVAILABLE);
    }

    @ExceptionHandler(AlreadyRunning.class)
    public ResponseEntity<ErrorResponse> alreadyRunning(AlreadyRunning failure) {
        return ResponseEntity.status(409).body(new ErrorResponse(failure.code().name(),
                message(failure.code()), failure.jobId()));
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ErrorResponse> api(ApiException failure) {
        if (failure.status() != null) {
            return ResponseEntity.status(failure.status()).body(new ErrorResponse(failure.code().name(),
                    failure.responseMessage() == null ? message(failure.code()) : failure.responseMessage()));
        }
        return response(failure.code());
    }

    private ResponseEntity<ErrorResponse> response(Code code) {
        int status = switch (code) {
            case INVALID_REQUEST, INVALID_SERVICE_KEY, TEMPLATE_MISMATCH, RETRY_NOT_ALLOWED, NOTHING_TO_RETRY -> 400;
            case ENVIRONMENT_NOT_CONFIGURED -> 503;
            case PACKAGE_NOT_FOUND, TENANT_NOT_FOUND, TEMPLATE_NOT_FOUND, JOB_NOT_FOUND, TRANSPORT_NOT_FOUND -> 404;
            case TEMPLATE_STORE_UNREADABLE, AUDIT_STORE_UNREADABLE -> 500;
            case CPI_UNAVAILABLE -> 502;
            case TEMPLATE_NAME_DUPLICATE, TENANT_NAME_DUPLICATE, TENANT_READ_ONLY, TENANT_STORE_NOT_CONFIGURED,
                    TENANT_STORE_UNREADABLE, READ_ONLY_MODE, JOB_ALREADY_RUNNING, JOB_NOT_RUNNING -> 409;
        };
        return ResponseEntity.status(status).body(new ErrorResponse(code.name(), message(code)));
    }

    private String message(Code code) {
        return switch (code) {
            case READ_ONLY_MODE -> "Read-only mode: real transport is disabled";
            case JOB_NOT_FOUND -> "Job not found";
            case TRANSPORT_NOT_FOUND -> "Transport not found";
            case RETRY_NOT_ALLOWED -> "A preview cannot be retried as a real transport";
            case NOTHING_TO_RETRY -> "No failed or skipped iFlows to retry";
            case JOB_NOT_RUNNING -> "Job is no longer running";
            case JOB_ALREADY_RUNNING -> "A real transport job is already running";
            case INVALID_REQUEST -> "Invalid request";
            case ENVIRONMENT_NOT_CONFIGURED -> "Environment not configured";
            case PACKAGE_NOT_FOUND -> "Package not found";
            case CPI_UNAVAILABLE -> "CPI request failed";
            case INVALID_SERVICE_KEY -> "Invalid service key";
            case TENANT_NAME_DUPLICATE -> "Tenant name already exists";
            case TENANT_NOT_FOUND -> "Tenant not found";
            case TENANT_READ_ONLY -> "Tenant is read only";
            case TENANT_STORE_NOT_CONFIGURED -> "Tenant store not configured";
            case TENANT_STORE_UNREADABLE -> "Tenant store unreadable";
            case TEMPLATE_NAME_DUPLICATE -> "Template name already exists";
            case TEMPLATE_NOT_FOUND -> "Template not found";
            case TEMPLATE_MISMATCH -> "Template does not match the requested route";
            case TEMPLATE_STORE_UNREADABLE -> "Template store unreadable";
            case AUDIT_STORE_UNREADABLE -> "Audit store unreadable";
        };
    }
}
