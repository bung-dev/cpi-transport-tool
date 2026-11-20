package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.model.TransportResponse;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.function.Predicate;

public final class HistoryCriteria {
    private HistoryCriteria() {}

    public static Predicate<TransportResponse> startedToday(Clock clock) {
        var zone = ZoneId.systemDefault();
        var today = LocalDate.ofInstant(clock.instant(), zone);
        return transport -> LocalDate.ofInstant(transport.startedAt(), zone).equals(today);
    }

    public static boolean succeeded(TransportResponse transport) {
        return !transport.dryRun() && transport.summary() != null && transport.summary().failed() == 0;
    }

    public static boolean failed(TransportResponse transport) {
        return !transport.dryRun() && transport.summary() != null && transport.summary().failed() > 0;
    }
}
