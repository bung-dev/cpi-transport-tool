package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.client.CpiCallException;
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
            case INVALID_REQUEST, INVALID_SERVICE_KEY -> 400;
            case ENVIRONMENT_NOT_CONFIGURED -> 503;
            case MAPPING_INVALID -> 422;
            case PACKAGE_NOT_FOUND, TENANT_NOT_FOUND -> 404;
            case CPI_UNAVAILABLE -> 502;
            case TENANT_NAME_DUPLICATE, TENANT_READ_ONLY, TENANT_STORE_NOT_CONFIGURED,
                    TENANT_STORE_UNREADABLE, READ_ONLY_MODE -> 409;
        };
        return ResponseEntity.status(status).body(new ErrorResponse(code.name(), message(code)));
    }

    private String message(Code code) {
        return switch (code) {
            case READ_ONLY_MODE -> "Read-only mode: real transport is disabled";
            case INVALID_REQUEST -> "Invalid request";
            case ENVIRONMENT_NOT_CONFIGURED -> "Environment not configured";
            case MAPPING_INVALID -> "Invalid mapping";
            case PACKAGE_NOT_FOUND -> "Package not found";
            case CPI_UNAVAILABLE -> "CPI request failed";
            case INVALID_SERVICE_KEY -> "Invalid service key";
            case TENANT_NAME_DUPLICATE -> "Tenant name already exists";
            case TENANT_NOT_FOUND -> "Tenant not found";
            case TENANT_READ_ONLY -> "Tenant is read only";
            case TENANT_STORE_NOT_CONFIGURED -> "Tenant store not configured";
            case TENANT_STORE_UNREADABLE -> "Tenant store unreadable";
        };
    }
}
