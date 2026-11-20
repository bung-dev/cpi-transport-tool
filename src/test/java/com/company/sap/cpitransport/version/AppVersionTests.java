package com.company.sap.cpitransport.version;

import java.util.Properties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.info.BuildProperties;

import static org.assertj.core.api.Assertions.assertThat;

/** 20261120-versioning S1: REQ-002 응답 값, REQ-003 기동 로그 줄 형식. */
class AppVersionTests {

    static BuildProperties build(String version, String commit, String time) {
        Properties entries = new Properties();
        entries.setProperty("version", version);
        if (commit != null) entries.setProperty("commit", commit);
        if (time != null) entries.setProperty("time", time);
        return new BuildProperties(entries);
    }

    @Test
    @DisplayName("REQ-002: build info gives version, commit and build time truncated to seconds in ISO-8601 UTC")
    void fromBuildInfo() {
        var v = AppVersion.from(build("0.1.0", "abc1234", "2026-11-20T10:00:00.123Z"));
        assertThat(v.version()).isEqualTo("0.1.0");
        assertThat(v.commit()).isEqualTo("abc1234");
        assertThat(v.buildTime()).isEqualTo("2026-11-20T10:00:00Z");
    }

    @Test
    @DisplayName("REQ-002: build info without commit reports commit unknown")
    void missingCommit() {
        var v = AppVersion.from(build("0.1.0", null, "2026-11-20T10:00:00Z"));
        assertThat(v.commit()).isEqualTo("unknown");
    }

    @Test
    @DisplayName("REQ-002: without build info the version is dev, commit unknown and build time null")
    void noBuildInfo() {
        var v = AppVersion.from(null);
        assertThat(v.version()).isEqualTo("dev");
        assertThat(v.commit()).isEqualTo("unknown");
        assertThat(v.buildTime()).isNull();
    }

    @Test
    @DisplayName("REQ-003: startup line names version, commit and build time")
    void startupLine() {
        assertThat(AppVersion.from(build("0.1.0", "abc1234", "2026-11-20T10:00:00Z")).startupLine())
                .isEqualTo("CPI Transport Tool 0.1.0 (커밋 abc1234, 빌드 2026-11-20T10:00:00Z)");
    }

    @Test
    @DisplayName("REQ-003: startup line without build info says so")
    void startupLineWithoutBuildInfo() {
        assertThat(AppVersion.from(null).startupLine())
                .isEqualTo("CPI Transport Tool dev (커밋 unknown, 빌드 정보 없음)");
    }
}
