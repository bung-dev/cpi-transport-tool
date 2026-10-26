package com.company.sap.cpitransport.service;

import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import static org.assertj.core.api.Assertions.assertThat;

class DeployHostExclusionTests {
    @ParameterizedTest(name = "REQ-309 AC-4: {0} host {1} is excluded from subdomain replacement in API and token URLs")
    @CsvSource({"localhost,localhost", "IPv4,127.0.0.1", "IPv6,[::1]", "dotless,singlehost"})
    @DisplayName("REQ-309 AC-4: localhost IPv4 IPv6 and dotless hosts are excluded from subdomain replacement")
    void excludedHosts(String kind, String host) {
        String text = "localhost LOCALHOST 127.0.0.1 127 ::1 [::1] singlehost SINGLEHOST";
        String url = "http:" + "//" + host;
        byte[] body = text.getBytes(StandardCharsets.UTF_8);
        assertThat(DeployErrorDetail.mask(body, List.of(), url, null, List.of())).isEqualTo(text);
        assertThat(DeployErrorDetail.mask(body, List.of(), null, url + "/oauth/token", List.of())).isEqualTo(text);
        assertThat(DeployErrorDetail.mask(body, List.of(), url, url + "/oauth/token", List.of())).isEqualTo(text);
        assertThat(DeployErrorDetail.mask("dummytenant DUMMYTENANT".getBytes(StandardCharsets.UTF_8), List.of(),
                "https://dummytenant.example.localhost", null, List.of())).isEqualTo("<subdomain> <subdomain>");
    }
}
