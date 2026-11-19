# SAP Content Agent Service API 조사

- 조사일: 2026-11-19 (트랙 E 탐색, 브랜치 `claude/spike-transport-module-api-96b61a`)
- 앞선 조사: [transport-module-api.md](transport-module-api.md) (Cloud Integration 쪽 `transportmodule` 경로)
- 표기: **확인됨** = 원문(공식 명세·도움말·SAP 공식 코드)에서 직접 읽음 / **추정** = 정황으로 판단 / **확인 못함** = 공개 자료로는 찾지 못함
- 실제 SAP 서비스에는 접속하지 않았다. OpenAPI 명세는 사용자가 SAP Business Accelerator Hub에 로그인한 뒤 브라우저에서 읽었다(저장소에는 원문을 넣지 않음).

## 1. 결론 요약

**공개·지원 API다. 다만 지금 도구에는 조건부(현 시점 비권장).**

- SAP Business Accelerator Hub에 **"SAP Content Agent Service" REST API(`contentagentapi`, OpenAPI 3.0, 버전 1.0.1)**가 공개돼 있다(**확인됨**). 내보내기(export), 작업 상태·로그 조회, 내보낸 파일 다운로드, **가져오기(Import V2: 파일 업로드 → 배포 리소스 생성 → 상태·로그)**까지 있다.
- Cloud Integration 패키지는 지원 콘텐츠 유형이고, **패키지 안의 하위 구성요소(iFlow, 값 매핑, 스크립트 컬렉션 등)를 골라 보내는 것**도 도움말과 명세에 나온다(**확인됨**: 도움말 표·`components[]` 필드). 단, API로 iFlow만 골라 보냈을 때 실제 동작은 **확인 못함**.
- 그러나 도구가 그대로 쓰기는 어렵다.
  - **서비스·키가 다르다.** 호스트는 `content-agent-engine.cfapps.<region>`, 키는 Content Agent 서비스 키(`uaa` 블록)이며, 원본·대상 서브계정마다 Content Agent 인스턴스와 `CloudIntegration` Destination(위 `transportmodule` 경로)을 따로 갖춰야 한다.
  - **기존 실행기로는 쓰기 호출이 안 된다**(로컬 테스트로 확인, 5절).
  - **비동기·MTAR 단위**라 iFlow별 결과·이력 표시가 지금보다 거칠어지고, 구성 값·보안 파라미터 처리는 문서로 확인되지 않는다.
  - 속도가 빨라진다는 근거는 없다(측정 자료 **확인 못함**).

## 2. 앞 문서 정정

[transport-module-api.md](transport-module-api.md)에서 "대상 반영은 CF Deploy Service로만 한다"고 썼던 것은 **틀렸다**. 블로그(2022)의 CF Deploy Service 방식 외에, 도움말에 다음이 있다(**확인됨**):

- cTMS **대상 노드 Destination이 Content Agent 엔진**(`https://content-agent-engine.cfapps.<dc>.hana.ondemand.com`)을 가리키게 해서 가져올 수 있다. 필요 역할: `ImportOperator` 또는 Content Agent Admin(Create Cloud Transport Management Target Node Destination).
- "Similar destination is also required to perform import in the target subaccount" — 대상 서브계정에도 `CloudIntegration` Destination이 필요하다(Supported Content Types). 즉 **Content Agent가 대상 Cloud Integration의 `transportmodule` 경로로 가져오기를 한다**고 보는 것이 맞다(**추정**: 경로 이름까지 대상 쪽 문서에 적혀 있지는 않음).

앞 문서도 이에 맞게 고쳤다.

## 3. API 정리 (Hub OpenAPI 명세 기준, **확인됨**)

- 서버: `https://content-agent-engine.cfapps.{region}` (예시 enum: `sap.hana.ondemand.com`, `eu10.hana.ondemand.com`, `us10.hana.ondemand.com`)
- 인증: OAuth2 client credentials, 토큰 URL `https://{subdomain}.authentication.{region}.hana.ondemand.com/oauth/token`
- 스코프: `read`, `contentresources.read`, `export`, `import`, `operations.read`, `activities.read` (+ 다운로드는 `operation.download`)
- 플랜: 도움말 "Consuming APIs" — API는 **Application 플랜**에서만 쓸 수 있다.

| 묶음 | 메서드·경로 | 요점 |
|---|---|---|
| 콘텐츠 | `GET /v1/contentResourceType` | 서브계정에서 켜진 콘텐츠 유형(예: `serviceId: it-rt`, `type: CloudIntegration`) |
| 콘텐츠 | `GET /v1/contentResources` | 목록·메타데이터. `skip`·`top`·`orderby`·`filters`(예: `type eq '...'`). 항목에 `components[]`(iflow 등, `exportable`·`mandatory`)와 `dependencies[]` |
| 내보내기 | `POST /v1/contentResources/export` | JSON. 필수 `id`·`exportMode`(`Download`/`TransportManagementService`)·`exportType`·`contentResources[]`(필수 `resourceID`·`type`·`subType`·`id`, 선택 `version`·`components[]`). `exportMediaType` 기본 `MTAR`(또는 `ZIP`), `sourceNode`, `description`, `transportUser`. 응답 200 `{activityId, processId, state, progress, ...}` |
| 작업 | `GET /v1/operations/{activityId}` | `state`, `progress`, `messages`(쿼리 `messages`) |
| 작업 | `GET /v1/operations/{activityId}/config` | `fileID`, `transportRequestID`, `transportRequestURL`, 노드별 TR 상태 `trStatus.nodes[]` |
| 다운로드 | `GET /v1/operations/{activityId}/file/{fileID}` | `application/octet-stream` (MTAR/zip) |
| 이력 | `GET /v1/activities`, `GET /v1/{contentType}/{contentResourceID}/activities` | 작업 이력: 사용자, 유형(Export/Import), 상태(FINISHED/WARNING/ERROR/ABORTED), TR ID, 대상 리소스 |
| 전송 | `GET /v1/transportModes` | 연결된 cTMS 구성 상태 |
| 가져오기 V2 | `POST /v2/files/upload` | **multipart/form-data** `file`(필수), `namedUser` → 201 `{fileId, fileName}` |
| 가져오기 V2 | `POST /v2/deploys` | JSON `{contents:[{storageType:"FILE", uri:<fileId>, configuration?}], configuration?, namedUser?}` → 201 `DeployEntity{deployResourceId, operationStatus, contents[].deployStatus}`. 한 요청에 콘텐츠 10개 이하 권장 |
| 가져오기 V2 | `GET /v2/deploys/{id}`, `GET /v2/deploys/{id}/logs`, `DELETE /v2/deploys/{id}`, `DELETE /v2/files/{fileId}` | 상태(`INITIAL`/`RUNNING`/`FINISHED`, 콘텐츠별 `SUCCESS`/`WARNING`/`SKIPPED`/`CONTENT_ERROR`/`SEVERE_ERROR`), 로그, 정리. 배포 리소스 DELETE는 `X-CSRF-Token` 헤더 |
| 가져오기(구) | `POST /v1/executeoperations/importMtar` | multipart, **deprecated** → V2 사용 |

참고: Import V2 모양은 cTMS의 배포 API 규약과 같다(cTMS가 대상 노드로 이 API를 부르는 구조로 **추정**).

## 4. 이 도구에 적용 가능성

| 관점 | 현재(OData V2, iFlow별) | Content Agent API |
|---|---|---|
| 지원 | 공개 API | 공개 API(**확인됨**) |
| 준비물 | 테넌트별 Process Integration Runtime 키 | 원본·대상 각각: Content Agent **Application 플랜** 인스턴스·키 + `CloudIntegration` Destination(Process Integration Runtime `api` 키, 역할 `WorkspacePackagesRead/Edit/Transport`). cTMS는 선택(`exportMode: Download` + Import V2로 cTMS 없이 직접 가능해 보임 — **추정**) |
| 흐름 | iFlow 다운로드 → 업로드 → (배포) | export(Download) → 상태 폴링 → 파일 다운로드 → 대상에 upload → deploy → 상태·로그 폴링 |
| 선택 단위 | iFlow | 패키지 + `components[]`로 하위 구성요소 선택 가능(동작은 **확인 못함**) |
| 결과·감사 | iFlow별 결과·이력 | 작업(activity) 단위 상태·로그·이력 API. iFlow별 결과는 로그 문장에서만 얻을 수 있을 것(**추정**) |
| 대상 패키지 생성 | 도구가 생성 | Content Agent가 처리(패키지가 대상에 생김 — 앞 문서 블로그 근거) |
| 구성 값·보안 파라미터 | 도구가 처리(이번 변경으로 PUT 제거) | 문서 근거 없음(**확인 못함**). Destination 유형에 대해 "secrets and passwords를 옮기지 않는다"는 문장만 있음 |
| iFlow 런타임 배포 | 도구가 배포 | 가져오기 뒤 런타임 배포까지 하는지 **확인 못함** |
| 속도 | 실측 iFlow 40개 417초(84%가 구성 값 PUT, 제거 중) | 측정 자료 없음. 서버 측에서 한 번에 처리하니 왕복은 줄겠지만 MTAR 조립·비동기 대기가 더해짐(**추정**) |
| 위험 | — | 서비스 2종·Destination 다수 추가, 운영 권한 확대(Content Agent Admin/ImportOperator), 요금(Application 플랜 엔타이틀먼트) **확인 못함** |

판단:

- **조건부.** 다음이 모두 맞을 때만 검토할 가치가 있다: (1) 원본·대상 서브계정에 Content Agent Application 플랜을 둘 수 있다, (2) 패키지(또는 하위 구성요소) 단위 MTAR 이관과 activity 로그를 감사 근거로 받아들인다, (3) 구성 값·보안 파라미터와 런타임 배포를 도구가 따로 처리해도 된다.
- 지금은 속도 개선(구성 값 PUT 제거, iFlow 동시 처리)의 실측을 먼저 본다. 그래도 느리면 이 API를 PoC로 비교한다.

## 5. "테스트" — 로컬 스텁으로 확인한 것

`src/test/java/com/company/sap/cpitransport/client/ContentAgentApiSpikeTests.java` (WireMock, 더미 자격증명, 3개 통과). Content Agent 호스트를 "테넌트 연결"로 등록했다고 가정하고 `CpiHttpExecutor`로 불렀다.

| 확인 | 결과 | 도입 시 할 일 |
|---|---|---|
| `GET /v1/operations/{id}`, `/config`, `/file/{fileID}` | 됨(토큰·바이너리 그대로) | — |
| `POST /v1/contentResources/export` | **안 됨**. 실행기가 쓰기 전에 CPI OData 루트 `/api/v1/`에서 CSRF를 받으려 하고, Content Agent에는 그 경로가 없어 404로 실패 | Content Agent 전용 클라이언트(CSRF 미사용, 명세상 CSRF 헤더는 배포 리소스 DELETE에만 있음) |
| `POST /v2/files/upload` | **안 됨**. 실행기는 본문을 항상 `application/json`으로 보내는데 명세는 multipart | multipart 전송 지원 |
| 서비스 키 등록 | 테스트 밖에서 확인: `ServiceKeyParser`는 `oauth` 블록(`url`·`tokenurl`·`clientid`·`clientsecret`)만 읽는다. Content Agent 키는 도움말상 `uaa` 블록(`clientid`·`clientsecret`·`url`, 토큰은 `url` + `/oauth/token`) | 키 파서 확장 또는 별도 설정 |

## 6. 사람이 직접 확인하는 절차 (선택)

> 개발 서브계정에서, 조회와 `Download` 내보내기까지만 권한다. 가져오기(Import V2)는 대상 테넌트를 바꾸므로 시험용 테넌트·시험용 패키지로만 하고, 사람 확인 뒤에 한다.
> 자격증명은 터미널 환경 변수로만 넣고 파일·이력에 남기지 않는다.

1. BTP 콕핏에서 Content Agent **Application 플랜** 인스턴스와 서비스 키를 만든다(개발 서브계정). 같은 서브계정에 `CloudIntegration` Destination이 있어야 한다(앞 문서 2절).
2. 토큰:

```bash
TOKEN=$(curl -s -u "$CAS_CLIENT_ID:$CAS_CLIENT_SECRET" -d grant_type=client_credentials "$CAS_UAA_URL/oauth/token" | jq -r .access_token)
```

3. 켜진 유형과 Cloud Integration 패키지 목록:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$CAS_URL/v1/contentResourceType" | jq .
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$CAS_URL/v1/contentResources?filters=type%20eq%20'CloudIntegration'&top=5" | jq .
```

4. (선택) 시험용 패키지 하나를 `Download` 모드로 내보내기 — cTMS에 TR이 생기지 않는다:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$CAS_URL/v1/contentResources/export" -d '{"id":"probe-001","exportMode":"Download","exportType":"Content","exportMediaType":"MTAR","contentResources":[{"resourceID":"<목록의 resourceID>","type":"CloudIntegration","subType":"<목록의 subType>","id":"<패키지 ID>"}]}'
```

5. 상태 → 파일:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$CAS_URL/v1/operations/<activityId>/config" | jq .
```

```bash
curl -s -o probe.mtar -H "Authorization: Bearer $TOKEN" "$CAS_URL/v1/operations/<activityId>/file/<fileID>"
```

6. 볼 것: 걸린 시간, MTAR 안에 구성 값(externalized parameters)이 들어 있는지, `components[]`로 iFlow 하나만 지정했을 때 결과가 달라지는지. `exportType` 값의 허용 범위는 명세에 예시가 없어 **확인 못함** — 400이면 응답 메시지를 본다.

## 출처

- SAP Business Accelerator Hub — SAP Content Agent Service API (`contentagentapi` 1.0.1, 로그인 필요): https://api.sap.com/api/contentagentapi/overview
- SAP Help — Consuming APIs (Application 플랜): https://help.sap.com/docs/content-agent-service/user-guide/consuming-apis
- SAP Help — Supported Content Types (Cloud Integration 하위 구성요소, 대상에도 Destination 필요): https://help.sap.com/docs/content-agent-service/user-guide/supported-content-types
- SAP Help — Create Cloud Transport Management Target Node Destination: https://help.sap.com/docs/content-agent-service/user-guide/create-target-node-destination
- SAP Help — Create SAP Content Agent Service Destination (`uaa` 키, `/oauth/token`): https://help.sap.com/docs/content-agent-service/user-guide/create-destination
- SAP Project Piper `integrationArtifactTransport`: https://github.com/SAP/jenkins-library/blob/master/cmd/integrationArtifactTransport.go
