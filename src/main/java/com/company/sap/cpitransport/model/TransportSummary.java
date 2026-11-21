package com.company.sap.cpitransport.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Objects;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record TransportSummary(int total, int succeeded, int failed,
        Integer fixRequired, Integer retryable, Integer skipped) {
    public TransportSummary(int total, int succeeded, int failed) {
        this(total, succeeded, failed, null, null, null);
    }

    // Preserve aggregate-count equality across history versions with and without grade counts.
    @Override
    public boolean equals(Object other) {
        return other instanceof TransportSummary summary
                && total == summary.total && succeeded == summary.succeeded && failed == summary.failed;
    }

    @Override
    public int hashCode() {
        return Objects.hash(total, succeeded, failed);
    }
}
