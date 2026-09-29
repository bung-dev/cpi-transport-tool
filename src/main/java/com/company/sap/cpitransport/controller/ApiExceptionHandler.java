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
        return response(failure.code());
    }

    private ResponseEntity<ErrorResponse> response(Code code) {
        int status = switch (code) {
            case INVALID_REQUEST -> 400;
            case ENVIRONMENT_NOT_CONFIGURED -> 503;
            case MAPPING_INVALID -> 422;
            case PACKAGE_NOT_FOUND -> 404;
            case CPI_UNAVAILABLE -> 502;
        };
        String message = switch (code) {
            case INVALID_REQUEST -> "Invalid request";
            case ENVIRONMENT_NOT_CONFIGURED -> "Environment not configured";
            case MAPPING_INVALID -> "Invalid mapping";
            case PACKAGE_NOT_FOUND -> "Package not found";
            case CPI_UNAVAILABLE -> "CPI request failed";
        };
        return ResponseEntity.status(status).body(new ErrorResponse(code.name(), message));
    }
}
