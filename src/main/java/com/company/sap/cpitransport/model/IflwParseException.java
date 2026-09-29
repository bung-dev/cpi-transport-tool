package com.company.sap.cpitransport.model;

public class IflwParseException extends RuntimeException {
    public IflwParseException() {
        // Parser messages and causes may contain document values; do not retain them.
        super("Unable to process iFlow archive (IFLW_PARSE_ERROR)");
    }
}
