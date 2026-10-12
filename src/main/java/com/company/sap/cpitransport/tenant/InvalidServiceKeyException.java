package com.company.sap.cpitransport.tenant;

import java.util.List;

public class InvalidServiceKeyException extends RuntimeException {
    private final List<String> keys;

    public InvalidServiceKeyException(List<String> keys) {
        super(String.join(", ", keys));
        this.keys = List.copyOf(keys);
    }

    public List<String> keys() { return keys; }
}
