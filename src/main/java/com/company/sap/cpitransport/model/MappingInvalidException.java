package com.company.sap.cpitransport.model;

public class MappingInvalidException extends ErrorResponse.ApiException {
    private final String detail;
    public MappingInvalidException(String detail) {
        super(ErrorResponse.Code.MAPPING_INVALID);
        this.detail = detail;
    }
    @Override
    public String getMessage() { return detail; }
}
