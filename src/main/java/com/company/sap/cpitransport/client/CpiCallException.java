package com.company.sap.cpitransport.client;

public class CpiCallException extends RuntimeException {
    private final Integer httpStatus;
    private final boolean tokenStageFailure;
    public CpiCallException(Integer httpStatus, String summary) {
        this(httpStatus, summary, false);
    }
    public CpiCallException(Integer httpStatus, String summary, boolean tokenStageFailure) {
        super(summary);
        this.httpStatus = httpStatus;
        this.tokenStageFailure = tokenStageFailure;
    }
    public Integer httpStatus() { return httpStatus; }
    /** True when the failure came from the OAuth token request, not from the CPI resource call. */
    public boolean isTokenStageFailure() { return tokenStageFailure; }
}
