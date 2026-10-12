package com.company.sap.cpitransport.model;

public record ErrorResponse(String error, String message) {
    public enum Code {
        INVALID_REQUEST, ENVIRONMENT_NOT_CONFIGURED, MAPPING_INVALID,
        PACKAGE_NOT_FOUND, CPI_UNAVAILABLE, INVALID_SERVICE_KEY, TENANT_NAME_DUPLICATE,
        TENANT_NOT_FOUND, TENANT_READ_ONLY, TENANT_STORE_NOT_CONFIGURED, TENANT_STORE_UNREADABLE
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
