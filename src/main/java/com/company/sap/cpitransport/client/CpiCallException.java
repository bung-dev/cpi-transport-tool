package com.company.sap.cpitransport.client;

public class CpiCallException extends RuntimeException {
    private final Integer httpStatus;
    private final boolean tokenStageFailure;
    private final boolean emptyBody;
    public CpiCallException(Integer httpStatus, String summary) {
        this(httpStatus, summary, false);
    }
    public CpiCallException(Integer httpStatus, String summary, boolean tokenStageFailure) {
        this(httpStatus, summary, tokenStageFailure, false);
    }
    public CpiCallException(Integer httpStatus, String summary, boolean tokenStageFailure, boolean emptyBody) {
        super(summary);
        this.httpStatus = httpStatus;
        this.tokenStageFailure = tokenStageFailure;
        this.emptyBody = emptyBody;
    }
    public Integer httpStatus() { return httpStatus; }
    /** True when the failure came from the OAuth token request, not from the CPI resource call. */
    public boolean isTokenStageFailure() { return tokenStageFailure; }
    /** True when the CPI resource response had no body or only whitespace. The body itself is never kept. */
    public boolean hasEmptyBody() { return emptyBody; }
}
