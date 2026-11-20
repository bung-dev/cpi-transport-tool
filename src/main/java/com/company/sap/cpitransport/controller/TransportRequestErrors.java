package com.company.sap.cpitransport.controller;

import com.company.sap.cpitransport.model.ErrorResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;

interface TransportRequestErrors {
    @ExceptionHandler({HttpMessageNotReadableException.class,
            HttpMediaTypeNotSupportedException.class})
    default ResponseEntity<ErrorResponse> unreadable() {
        return ResponseEntity.badRequest().body(new ErrorResponse("INVALID_REQUEST", "Invalid request"));
    }
}
