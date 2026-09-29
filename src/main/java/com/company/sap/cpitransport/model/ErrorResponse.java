package com.company.sap.cpitransport.model;

public record ErrorResponse(String error, String message) {
    public enum Code {
        INVALID_REQUEST, ENVIRONMENT_NOT_CONFIGURED, MAPPING_INVALID,
        PACKAGE_NOT_FOUND, CPI_UNAVAILABLE
    }

    public static class ApiException extends RuntimeException {
        private final Code code;
        public ApiException(Code code) { super(code.name()); this.code = code; }
        public Code code() { return code; }
    }
}
