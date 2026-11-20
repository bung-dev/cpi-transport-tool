package com.company.sap.cpitransport.version;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.springframework.boot.info.BuildProperties;

public record AppVersion(String version, String commit, @JsonInclude(JsonInclude.Include.ALWAYS) String buildTime) {
    static AppVersion from(BuildProperties build) {
        if (build == null) {
            return new AppVersion("dev", "unknown", null);
        }
        String commit = build.get("commit");
        Instant time = build.getTime();
        return new AppVersion(build.getVersion(),
                commit == null || commit.isBlank() ? "unknown" : commit,
                time == null ? null : time.truncatedTo(ChronoUnit.SECONDS).toString());
    }

    String startupLine() {
        return "CPI Transport Tool %s (커밋 %s, 빌드 %s)".formatted(
                version, commit, buildTime == null ? "정보 없음" : buildTime);
    }
}
