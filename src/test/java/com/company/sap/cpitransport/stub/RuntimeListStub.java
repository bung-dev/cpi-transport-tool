package com.company.sap.cpitransport.stub;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.MappingBuilder;
import java.util.*;
import tools.jackson.databind.json.JsonMapper;
import static com.github.tomakehurst.wiremock.client.WireMock.*;

/**
 * 20261121-perf-retry REQ-904: 배포 확인은 대상 테넌트의 런타임 목록(GET /api/v1/IntegrationRuntimeArtifacts)을
 * 간격마다 한 번 읽어 판정한다. 테스트 스텁이 쓰는 목록 응답(OData v2 {"d":{"results":[{Id,Status}]}})을 만든다.
 * 목록에 없는 iFlow는 아직 배포 중(대기)이다.
 */
public final class RuntimeListStub {
    public static final String PATH = "/api/v1/IntegrationRuntimeArtifacts";
    private static final JsonMapper JSON = new JsonMapper();

    private RuntimeListStub() {}

    /** 목록 요청(쿼리 문자열과 무관하게 경로로 맞춘다) */
    public static MappingBuilder list() { return get(urlPathEqualTo(PATH)); }

    /** id → Status(STARTED, ERROR, STARTING 등) 순서대로 목록 본문 */
    public static String body(Map<String, String> statuses) {
        var results = new ArrayList<Map<String, String>>();
        statuses.forEach((id, status) -> results.add(Map.of("Id", id, "Status", status)));
        return JSON.writeValueAsString(Map.of("d", Map.of("results", results)));
    }

    /** 항상 같은 목록을 돌려준다 */
    public static void stub(WireMockServer server, Map<String, String> statuses) {
        server.stubFor(list().willReturn(okJson(body(statuses))));
    }

    /** id마다 같은 상태 */
    public static void stub(WireMockServer server, String status, String... ids) {
        var statuses = new LinkedHashMap<String, String>();
        for (String id : ids) statuses.put(id, status);
        stub(server, statuses);
    }

    public static Map<String, String> of(String... idStatus) {
        var statuses = new LinkedHashMap<String, String>();
        for (int i = 0; i + 1 < idStatus.length; i += 2) statuses.put(idStatus[i], idStatus[i + 1]);
        return statuses;
    }
}
