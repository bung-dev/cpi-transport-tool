package com.company.sap.cpitransport.client;

import java.time.Duration;

@FunctionalInterface
public interface Sleeper {
    void sleep(Duration duration) throws InterruptedException;
}
