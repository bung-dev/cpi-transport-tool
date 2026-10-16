package com.company.sap.cpitransport.service;

import com.company.sap.cpitransport.client.CpiApiClient;
import com.company.sap.cpitransport.client.CpiCallException;
import com.company.sap.cpitransport.controller.ApiExceptionHandler;
import com.company.sap.cpitransport.model.CpiPackage;
import com.company.sap.cpitransport.model.ErrorResponse;
import com.company.sap.cpitransport.model.ErrorResponse.ApiException;
import com.company.sap.cpitransport.model.ErrorResponse.Code;
import com.company.sap.cpitransport.model.TransportRequest;
import java.time.Clock;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class CpiFailureBoundaryTests {
    enum Query { PACKAGES, ARTIFACT_PACKAGE, ARTIFACT_LIST, TRANSPORT_PACKAGE, TRANSPORT_LIST }

    static Stream<Arguments> failures() {
        return Stream.of(Query.values()).flatMap(query -> Stream.of(
                Arguments.of(query, 403, false),
                Arguments.of(query, 404, false),
                Arguments.of(query, 404, true)));
    }

    @ParameterizedTest(name = "REQ-305 AC-3: {0} HTTP {1} tokenStage={2} discards upstream summary before MVC")
    @MethodSource("failures")
    @DisplayName("REQ-305 AC-3: query and transport preflight failures discard echoed secrets and preserve public errors")
    void req305_ac3_categoricalBoundary(Query query, int status, boolean tokenStage) {
        // Deliberately unknown to the request's masking list, like an echoed store key or another tenant's data.
        String summary = "test-dummy-store-key test-dummy-other-client test-dummy-other-secret "
                + "test-dummy-other-token test-dummy-other-csrf test-dummy-other-session";
        var upstream = new CpiCallException(status, summary, tokenStage);
        var api = mock(CpiApiClient.class);
        var guard = mock(EnvironmentGuard.class);
        when(guard.missingKeys("DEV")).thenReturn(List.of());
        when(api.getPackage("DEV", "Pkg")).thenReturn(Optional.of(new CpiPackage("Pkg", "Package", "1")));
        var packages = new PackageQueryService(guard, api);
        var mappings = mock(MappingFileLoader.class);
        when(mappings.load()).thenReturn(List.of());
        var transport = new TransportService(api, mock(IflwReplacer.class), mock(ExternalParameterReplacer.class),
                mock(DeployService.class), mappings, Clock.systemUTC());
        var request = new TransportRequest("Pkg", List.of("Artifact"), true, false);
        ThrowingCallable operation;
        switch (query) {
            case PACKAGES -> {
                when(api.listPackages("DEV")).thenThrow(upstream);
                operation = () -> packages.packages("DEV");
            }
            case ARTIFACT_PACKAGE -> {
                when(api.getPackage("DEV", "Pkg")).thenThrow(upstream);
                operation = () -> packages.artifacts("DEV", "Pkg");
            }
            case ARTIFACT_LIST -> {
                when(api.listArtifacts("DEV", "Pkg")).thenThrow(upstream);
                operation = () -> packages.artifacts("DEV", "Pkg");
            }
            case TRANSPORT_PACKAGE -> {
                when(api.getPackage("DEV", "Pkg")).thenThrow(upstream);
                operation = () -> transport.preflightAndExecute(request);
            }
            case TRANSPORT_LIST -> {
                when(api.listArtifacts("DEV", "Pkg")).thenThrow(upstream);
                operation = () -> transport.preflightAndExecute(request);
            }
            default -> throw new AssertionError("Unknown query");
        }
        Code expected = query != Query.PACKAGES && status == 404 && !tokenStage
                ? Code.PACKAGE_NOT_FOUND : Code.CPI_UNAVAILABLE;
        assertThatThrownBy(operation).isInstanceOfSatisfying(ApiException.class, failure -> {
            assertThat(failure.code()).isEqualTo(expected);
            assertThat(failure.getMessage()).isEqualTo(expected.name());
            assertThat(failure.toString()).doesNotContain("test-dummy-");
            assertThat(failure.getCause()).isNull();
            assertThat(failure.getSuppressed()).isEmpty();
            var response = new ApiExceptionHandler().api(failure);
            assertThat(response.getStatusCode().value()).isEqualTo(expected == Code.PACKAGE_NOT_FOUND ? 404 : 502);
            assertThat(response.getBody()).isEqualTo(new ErrorResponse(expected.name(),
                    expected == Code.PACKAGE_NOT_FOUND ? "Package not found" : "CPI request failed"));
        });
        // The low-level diagnostic contract is retained, including its summary and status.
        assertThat(upstream.getMessage()).isEqualTo(summary);
        assertThat(upstream.httpStatus()).isEqualTo(status);
        assertThat(upstream.isTokenStageFailure()).isEqualTo(tokenStage);
    }
}
