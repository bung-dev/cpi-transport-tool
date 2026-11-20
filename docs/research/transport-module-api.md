# Cloud Integration Transport Module API 조사 (cTMS·Content Agent 경로)

- 조사일: 2026-11-19 (트랙 E 탐색, 브랜치 `claude/spike-transport-module-api-96b61a`)
- 질문: "SAP cTMS는 별도의 이관 API를 쓴다는데, 우리 도구도 쓸 수 있나?"
- 표기: **확인됨** = 원문에서 직접 읽음 / **추정** = 정황으로 판단 / **확인 못함** = 공개 자료로는 찾지 못함
- 실제 SAP 테넌트에는 접속하지 않았다. 아래 "테스트" 결과는 로컬 WireMock 스텁에서 나온 것이며, 실제 연동이 된다는 증거가 아니다.

## 1. 결론 요약

**비권장. 지금 도구에 넣을 만한 "직접 호출용 이관 API"는 확인되지 않았다.**

- `<oauth.url>/api/1.0/transportmodule/Transport`는 실제로 있는 경로다(SAP 도움말에 나옴, **확인됨**). 하지만 이 경로는 Content Agent Service(CAS)가 Cloud Integration을 **되불러(callback)** 패키지를 받아 가려고 쓰는 서비스 간 엔드포인트다. SAP는 요청·응답 형식을 공개하지 않았고, 외부 클라이언트가 직접 부르는 방법을 문서화하지 않았다(**확인 못함** → 비공개·내부용으로 봐야 함).
- 대상 테넌트에 **가져오는(import)** 방법은 두 가지다. (1) 2022년 블로그 방식: cTMS가 MTAR을 대상 서브계정의 **Cloud Foundry Deploy Service**(`deploy-service.cfapps.<domain>/slprot/<org>/<space>/slp`)에 MTA로 배포하고, 이때 SpaceDeveloper 권한의 CF 기술 사용자가 필요하다(**확인됨**). (2) 현재 도움말 방식: cTMS 대상 노드가 **Content Agent 엔진**을 거쳐 가져오고, 대상 서브계정에도 `CloudIntegration` Destination이 필요하다(**확인됨**). 그래서 이 경로는 가져오기에도 쓰일 가능성이 높지만(**추정**), 어느 쪽이든 직접 부를 형식은 공개돼 있지 않다. *(2026-11-19 정정: 처음에는 (1)만 있다고 적었다. [content-agent-api.md](content-agent-api.md) 2절 참고.)*
- 이 경로를 쓰는 cTMS 흐름은 **패키지 단위**로 이관한다. Content Agent 쪽은 하위 구성요소를 고를 수 있다([content-agent-api.md](content-agent-api.md)).
- 공개·지원되는 대안은 (a) Content Agent 공개 API(Business Accelerator Hub `contentagentapi`, 내보내기·가져오기 모두 있음, **확인됨** — 별도 문서 [content-agent-api.md](content-agent-api.md))와 (b) 지금 쓰는 공개 OData API다.

## 2. 붙여 온 자료의 주장 확인

| 주장 | 판정 | 근거 |
|---|---|---|
| Destination 이름 `CloudIntegration`, URL `<oauth → url>/api/1.0/transportmodule/Transport` | **확인됨** | SAP Help "Create SAP Cloud Integration Destination" 표의 URL 칸: 형식이 `<oauth → url>/api/1.0/transportmodule/Transport`라고 적혀 있음 |
| 인증 OAuth2ClientCredentials, Process Integration Runtime 서비스 키의 Client ID/Secret, Token Service URL = `oauth → tokenurl` (mTLS면 `uaa → certurl`) | **확인됨** | 같은 페이지 |
| 서비스 인스턴스 역할 `WorkspacePackagesRead`·`WorkspacePackagesEdit`·`WorkspacePackagesTransport` | **확인됨** | 같은 페이지 Prerequisites. (블로그 Step 7은 `WorkspacePackagesTransport`만 언급) |
| 서비스 플랜 `api` (Process Integration Runtime, `it-rt`) | **확인됨** | 블로그 Prerequisites·Step 7, CAS 담당자 댓글("it-rt" service and "api" plan) |
| "cTMS는 별도의 이관 API를 쓴다" | **부분적으로만 맞음** | 위 경로는 CAS가 Cloud Integration을 되부르는 서비스 간 엔드포인트다(CAS 담당자 댓글: CAS가 CPI를 되불러 패키지를 끌어와 번들을 만든다). 대상 반영은 CF Deploy Service 또는 Content Agent 엔진을 거친다(정정, 1절). |

## 3. 엔드포인트별 정리

### 3.1 `/api/1.0/transportmodule/Transport` (Cloud Integration 쪽)

| 항목 | 내용 | 판정 |
|---|---|---|
| 호스트 | Process Integration Runtime(`api` 플랜) 서비스 키의 `oauth.url` — 우리 도구의 `apiUrl`과 같은 호스트 | **확인됨**(URL 형식) |
| 호출자 | Content Agent Service (Destination `CloudIntegration`을 통해) | **확인됨**(CAS 담당자 댓글) |
| 메서드·요청 본문·응답 형식 | 공개 문서 없음. Business Accelerator Hub의 Cloud Integration API 목록·SAP Help·Community 어디에도 스키마가 없음 | **확인 못함** |
| 내보내기 형식 | CAS가 결과를 MTAR로 조립한다. Cloud Integration이 이 경로로 무엇을(zip? MTAR 조각?) 돌려주는지는 모름 | MTAR 조립은 **확인됨**, 경로 응답 형식은 **확인 못함** |
| 비동기 여부 | CI → CAS 요청은 "async transport operation"이라고 CAS 담당자가 설명. transportmodule 경로 자체가 비동기인지는 모름 | **추정** |
| import 엔드포인트 | 대상 서브계정에도 `CloudIntegration` Destination이 필요하다고 도움말에 있어, Content Agent가 이 경로로 가져오기를 하는 것으로 보임. 형식은 비공개 | 필요 조건은 **확인됨**, 경로의 import 동작은 **추정** |
| 구성 값·보안 파라미터 | 공개 자료에 언급 없음. MTA 배포 시 구성 값(externalized parameters)이 어떻게 처리되는지 문서 근거를 찾지 못함 | **확인 못함** |
| 대상 패키지 자동 생성 | cTMS import 후 "CI package will be available in the CI tenant" — 패키지가 대상에 생긴다 | **확인됨**(블로그 Step 11) |
| 배포(deploy) 여부 | 블로그의 "imported (deployed)"는 MTA를 CF 스페이스에 배포한다는 뜻이고, iFlow 런타임 배포까지 하는지는 원문에 없음 | **확인 못함** |
| 공개·지원 API 여부 | 직접 호출용으로 문서화돼 있지 않음. Destination 설정값으로만 등장 | **추정: 내부용** |

### 3.2 Content Agent Service API (공개, 참고)

SAP 공식 오픈소스 Project Piper의 `integrationArtifactTransport` 단계 소스(`cmd/integrationArtifactTransport.go`)에서 **확인됨**:

- 인증: **CAS 서비스 키**(Process Integration Runtime 키가 아님)
- `POST {casHost}/v1/contentResources/export` — JSON 본문에 `exportMode: "TransportManagementService"`, `exportMediaType: "MTAR"`, `contentResources[]`(`type: "CloudIntegration"`, `subType: "package"`, 패키지 `id`·`resourceID`·`name`·`version`). 성공 시 **202 + `processId`**
- `GET {casHost}/v1/operations/{processId}` — `state`: `INITIAL`/`RUNNING`/`FINISHED`/`ERROR`/`ABORTED`
- `GET {casHost}/v1/operations/{processId}/logs` — 오류 상세
- Piper 문서: "integrationArtifactTransport step only supports Integration Package transport" → **패키지 단위만**
- Piper는 **내보내기 + cTMS 큐 적재**만 쓴다. Content Agent API 전체(가져오기 V2 포함)는 [content-agent-api.md](content-agent-api.md)에 정리했다.

## 4. 이 도구에 적용 가능성

| 관점 | 현재 도구(OData V2) | transportmodule 직접 호출 | CAS API + cTMS |
|---|---|---|---|
| 인증 | 테넌트별 서비스 키(client credentials) | 같은 키·같은 호스트로 **요청은 보낼 수 있음**(아래 테스트). 역할 `WorkspacePackagesTransport` 추가 필요 | CAS 키 + cTMS 키 + 대상 CF 기술 사용자(SpaceDeveloper) |
| 무엇을 보내야 하나 | 문서화됨 | **모름**(스키마 비공개) | 문서화됨(Piper 기준) |
| 대상 반영 | iFlow별 업로드·배포 | 형식 비공개라 직접 import 불가로 봄 | Content Agent 가져오기(Import V2) 또는 CF Deploy Service 경유 |
| iFlow 단위 선택 | 됨 | 알 수 없음 | 하위 구성요소 선택 있음(동작 확인 못함) |
| 결과 표시·감사 | iFlow별 결과·이력 | 알 수 없음 | 작업 상태 + 로그, cTMS 이력. iFlow별 결과는 없음 |
| 속도 | 실측 40개 417초 중 84%가 구성 값 PUT → PUT 제거로 크게 줄 것 | 측정 불가 | 측정 자료 없음(**확인 못함**). 비동기 + MTA 배포라 빠르다는 근거도 없음 |
| 위험 | 공개 API | 비공개 경로 변경·지원 거부 위험, 잘못된 호출의 영향 예측 불가 | 구성 요소 3개 추가, 운영 권한 범위 확대 |

판단:

- **transportmodule 직접 호출: 비권장.** 형식이 비공개라 구현 근거가 없고, 시행착오로 형식을 알아내는 것은 운영 테넌트에 비공개 API를 시험하는 일이 된다. import 경로도 아니다.
- **Content Agent API: 조건부(지금은 비권장).** 판단 근거는 [content-agent-api.md](content-agent-api.md) 4절에 따로 정리했다.
- **속도 개선은 현재 진행 중인 방식(구성 값 PUT 제거, iFlow 동시 처리)이 맞는 방향이다.** 새 API로 갈아탈 근거가 없다.

## 5. "테스트" — 로컬 스텁으로 확인한 것

`src/test/java/com/company/sap/cpitransport/client/TransportModuleApiSpikeTests.java` (WireMock, 더미 자격증명, 4개 통과)

| 확인 | 결과 |
|---|---|
| 같은 OAuth 토큰·같은 `apiUrl` 호스트로 `/api/1.0/transportmodule/Transport` GET | 됨. `CpiHttpExecutor.execute`는 `/`로 시작하는 상대 경로를 받으므로 `/api/v1` 밖 경로도 부를 수 있다 |
| POST | 됨. 다만 실행기는 쓰기 전에 **`/api/v1/`에서 CSRF를 받아오고**, 본문을 **항상 `application/json`**으로 보낸다. MTAR·multipart 업로드가 필요하다면 실행기를 고쳐야 한다. transportmodule이 CSRF를 요구하는지는 **확인 못함** |
| 바이너리(MTAR 가정) 응답 | 바이트 그대로 돌려받음 |
| 403(역할 누락 가정) | 재시도 없이 `CpiCallException(403)` |

이 테스트는 "기존 클라이언트로 요청을 **보낼 수는** 있다"까지만 보여 준다. 스텁의 본문·상태 코드는 가정이다.

## 6. 사람이 자기 테넌트에서 확인하는 절차 (선택)

> 운영 테넌트가 아닌 개발 테넌트에서, 조회(GET)만 하는 것을 권한다. 비공개 경로에 POST는 보내지 않는다.
> 자격증명은 터미널 환경 변수로만 넣고 파일·이력에 남기지 않는다.

1. BTP 콕핏 → 개발 서브계정 → Process Integration Runtime 인스턴스(`api` 플랜)의 역할에 `WorkspacePackagesRead`·`WorkspacePackagesEdit`·`WorkspacePackagesTransport`가 있는지 확인. 없으면 별도 인스턴스를 만들고 그 키를 쓴다(기존 키의 역할을 바꾸지 않는다).
2. 토큰 받기:

```bash
TOKEN=$(curl -s -u "$CLIENT_ID:$CLIENT_SECRET" -d grant_type=client_credentials "$TOKEN_URL" | jq -r .access_token)
```

3. 경로가 열려 있는지 조회:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" "$OAUTH_URL/api/1.0/transportmodule/Transport"
```

4. 기대 응답 해석(전부 **추정**):
   - `401` — 토큰 문제(URL·키 확인)
   - `403` — 역할 누락(1단계 확인)
   - `404`/`405` — 경로는 있으나 GET이 아니거나 하위 경로가 필요. 형식이 비공개이므로 여기서 멈춘다
   - `200` — 응답 본문을 저장소 밖에 보관해 공유(자격증명·토큰이 섞이지 않았는지 먼저 확인)

5. Content Agent API 확인 절차는 [content-agent-api.md](content-agent-api.md) 6절에 있다.

## 7. 다음 단계 제안

- 지금은 아무 것도 도입하지 않는다. 진행 중인 속도 개선 후 실측을 다시 잰다.
- 속도 개선 후에도 느리면, Content Agent API를 PoC로 비교한다([content-agent-api.md](content-agent-api.md)).
- 원하면 SAP에 지원 문의: "`/api/1.0/transportmodule/Transport`를 고객 클라이언트가 직접 호출하는 것이 지원되는가" (CAS 큐 `BC-CP-LCM-CAS`).

## 출처

- SAP Help — Create SAP Cloud Integration Destination: https://help.sap.com/docs/content-agent-service/user-guide/create-sap-cloud-integration-destination
- SAP Help — Using Integration Suite Applications (CAS가 MTAR로 조립): https://help.sap.com/docs/content-agent-service/user-guide/content-assembly-for-sap-integration-suite-applications
- SAP Community (TiaXu, 2022-03-25) — TMS - Transport SAP Cloud Integration Content with TMS and CAS (Step 2 CF Deploy Service Destination, Step 7~8, CAS 담당자 댓글 2024-09-20): https://community.sap.com/t5/technology-blog-posts-by-sap/tms-transport-sap-cloud-integration-ci-cpi-content-with-transport/ba-p/13537586
- SAP Developers 튜토리얼 — Enable the transport (`WorkspacePackagesTransport` 역할): https://developers.sap.com/tutorials/btp-transport-management-cpi-06-enable-the-transport.html
- SAP Developers 튜토리얼 그룹(사용자 제시): https://developers.sap.com/tutorials/group-transport-sap-integration-suite-content-using-sap-cloud-transport-management-service-and-sap-content-agent-service/
- SAP Project Piper `integrationArtifactTransport` 소스·문서: https://github.com/SAP/jenkins-library/blob/master/cmd/integrationArtifactTransport.go , https://github.com/SAP/jenkins-library/blob/master/documentation/docs/steps/integrationArtifactTransport.md
