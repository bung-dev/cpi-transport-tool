package com.company.sap.cpitransport.model;

import com.fasterxml.jackson.annotation.JsonInclude;

public record ErrorResponse(String error, String message, @JsonInclude(JsonInclude.Include.NON_NULL) String jobId) {
    public ErrorResponse(String error, String message) { this(error, message, null); }

    public enum Code {
        INVALID_REQUEST, ENVIRONMENT_NOT_CONFIGURED,
        PACKAGE_NOT_FOUND, CPI_UNAVAILABLE, INVALID_SERVICE_KEY, TENANT_NAME_DUPLICATE,
        TENANT_NOT_FOUND, TENANT_READ_ONLY, TENANT_STORE_NOT_CONFIGURED, TENANT_STORE_UNREADABLE, READ_ONLY_MODE,
        TEMPLATE_NAME_DUPLICATE, TEMPLATE_NOT_FOUND, TEMPLATE_MISMATCH, TEMPLATE_STORE_UNREADABLE,
        AUDIT_STORE_UNREADABLE, JOB_NOT_FOUND, JOB_ALREADY_RUNNING, JOB_NOT_RUNNING,
        TRANSPORT_NOT_FOUND, RETRY_NOT_ALLOWED, NOTHING_TO_RETRY
    }

    public static class ApiException extends RuntimeException {
        private final Code code;
        private final Integer status;
        private final String responseMessage;
        public ApiException(Code code) { this(code, null, null); }
        public ApiException(Code code, Integer status, String message) {
            super(message == null ? code.name() : message);
            this.code = code;
            this.status = status;
            this.responseMessage = message;
        }
        public Code code() { return code; }
        public Integer status() { return status; }
        public String responseMessage() { return responseMessage; }
    }
}
