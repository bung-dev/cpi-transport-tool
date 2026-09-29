package com.company.sap.cpitransport.client;

public class CpiCallException extends RuntimeException {
    private final Integer httpStatus;
    public CpiCallException(Integer httpStatus, String summary) {
        super(summary);
        this.httpStatus = httpStatus;
    }
    public Integer httpStatus() { return httpStatus; }
}
