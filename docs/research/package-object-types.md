# 패키지 안 iFlow 외 오브젝트 이관 조사 (로드맵 R-2)

- 조사일: 2026-11-20 (트랙 E 탐색, 로드맵 R-2)
- 앞선 조사: [transport-module-api.md](transport-module-api.md) · [content-agent-api.md](content-agent-api.md) · [ctms-benchmark.md](ctms-benchmark.md)
- 표기: **확인됨** = SAP 공식 도움말 원문에서 직접 읽음 / **공개 도구** = SAP 문서가 아닌 공개 소스 코드(FlashPipe, SAP Project Piper)에서 읽음 / **추정** = 정황으로 판단 / **확인 못함** = 공개 자료로는 찾지 못함
- 실제 SAP 테넌트에는 접속하지 않았다. SAP Business Accelerator Hub의 Integration Content 명세는 로그인이 필요해 이번에는 읽지 못했다. SAP 도움말은 도움말 원문을 공개한 GitHub 저장소(SAP-docs/btp-integration-suite)에서 읽었다.

## 1. 결론 요약

- **공개 OData(`/api/v1`)로 옮길 수 있는 종류는 iFlow, 밸류 매핑, 스크립트 컬렉션, 메시지 매핑이다.** 공식 도움말에 리소스가 있다(**확인됨**). 데이터 타입·메시지 타입도 엔터티가 있다(**공개 도구**: 도움말 목록에는 없음).
- **함수 라이브러리, 가져온 아카이브(Imported Archives), REST/SOAP API 아티팩트는 공개 OData API 근거를 찾지 못했다(확인 못함).** 함수 라이브러리는 메시지 매핑이 참조하는 종속물로만 도움말에 나온다.
- **종류마다 되는 동작이 다르다.** 도움말 기준으로 메시지 매핑은 "읽기·생성·삭제", 스크립트 컬렉션은 "생성·업로드·리소스 추가·배포"만 적혀 있고 갱신(PUT)은 적혀 있지 않다. 공개 도구는 메시지 매핑·스크립트 컬렉션 PUT 갱신을 쓰고, 밸류 매핑은 "삭제 후 생성"으로 갱신한다.
- **패키지 통째 이관 경로도 공식 문서에 있다.** `GET /IntegrationPackages('{Id}')/$value`(zip 내려받기)와 `POST /IntegrationPackages`(`PackageContent` base64, `?Overwrite=true`)다(**확인됨**). 종류를 가리지 않고 한 번에 옮기지만, 초안(draft) 아티팩트가 있거나 configure-only 패키지면 내려받기가 실패하고, 덮어쓰기·병합 규칙이 화면 가져오기와 같은지는 **확인 못함**.
- **기존 실행기로는 대부분 호출된다**(5절, 로컬 WireMock). 안 되는 것은 **DELETE**(CSRF 토큰을 붙이지 않음)와 **`$batch`**(multipart/mixed)다.
- R-6 제안: **종류별 이관(iFlow 방식 확장)을 기본으로, 순서는 스크립트 컬렉션·메시지 매핑·밸류 매핑 → iFlow**. 패키지 통째 이관은 실제 테넌트 확인 뒤 별도 선택지로 둔다(6절).

## 2. 종류별 정리

### 2.1 공식 도움말에 적힌 리소스 (**확인됨**)

출처: SAP Help "Integration Content" 리소스 표.

| 리소스 | 도움말이 적은 동작 |
|---|---|
| `IntegrationPackages` | 생성·갱신·삭제·읽기 |
| `IntegrationDesigntimeArtifacts` (iFlow) | 읽기·내려받기·생성·업로드·배포·삭제. configure-only 패키지와 잠긴 아티팩트에서는 삭제 불가 |
| iFlow `Configurations` | 읽기·갱신 |
| `ValueMappingDesigntimeArtifacts` | 읽기·내려받기·생성·업로드·배포, 항목 삭제. 예시 요청 문서에는 "value mapping design time artifacts의 구성 읽기·갱신"도 있다 |
| `MessageMappingDesigntimeArtifacts` | **읽기·생성·삭제** |
| `ScriptCollectionDesigntimeArtifacts` | **생성·업로드·리소스 추가·배포** |
| `IntegrationRuntimeArtifacts` | 읽기·배포·배포 해제. 런타임 직접 배포는 BUNDLE 유형(iFlow·밸류 매핑·OData 서비스)만 |
| `BuildAndDeployStatus` | 배포 진행 상태(SUCCESS/FAIL/DEPLOYING/FAIL_ON_LICENSE_ERROR) |
| `IntegrationAdapterDesigntimeArtifacts` | 가져오기·배포·삭제(**Cloud Foundry만**) |
| Custom Tags | 테넌트 수준 사용자 태그. 필수 태그가 있으면 값 없이 패키지를 만들 수 없다 |

### 2.2 종류별 호출 형식

경로는 `/api/v1` 아래. `{T}`는 `ScriptCollection`·`ValueMapping`·`MessageMapping`·`DataType`·`MessageType`·`FaultMessageType`. 이 공통 형식은 **공개 도구**(FlashPipe `design.go`)에서 읽었고, 도움말에 엔터티 이름(위 표)만 있다.

| 동작 | 경로·본문 | 근거 |
|---|---|---|
| 패키지별 목록 | `GET /IntegrationPackages('{pkg}')/{T}DesigntimeArtifacts` (`Id`·`Name`·`Version`) | 공개 도구 |
| 한 건 | `GET /{T}DesigntimeArtifacts(Id='{id}',Version='active')` (404 = 없음) | 공개 도구 |
| 내려받기 | `GET /{T}DesigntimeArtifacts(Id='{id}',Version='active')/$value` → zip | 공개 도구 |
| 생성 | `POST /{T}DesigntimeArtifacts` JSON `{Name, Id, PackageId, Description?, ArtifactContent(zip base64)}` → 201 | 공개 도구. 밸류 매핑은 "값 매핑 XML이 아닌 zip을 base64로" 넣어야 한다는 커뮤니티 글 있음 |
| 갱신 | `PUT /{T}DesigntimeArtifacts(Id='{id}',Version='active')` JSON `{ArtifactContent}` → 200. `Id`·`PackageId`를 넣으면 메시지 매핑 갱신이 실패하고, `Id`는 zip 안 `MANIFEST.MF`의 `Bundle-SymbolicName`과 같아야 함 | 공개 도구(코드 주석) |
| 밸류 매핑 갱신 | PUT을 쓰지 않고 **DELETE 후 POST** | 공개 도구 |
| 삭제 | `DELETE /{T}DesigntimeArtifacts(Id='{id}',Version='active')` → 200 | 공개 도구 |
| 배포 | `POST /Deploy{T}DesigntimeArtifact?Id='{id}'&Version='active'` → 202(본문 = 작업 ID) | 공개 도구. iFlow는 같은 형식이 지금 도구에서 쓰임 |
| 배포 상태 | `GET /BuildAndDeployStatus(TaskId='{task}')` 또는 `GET /IntegrationRuntimeArtifacts('{id}')` | 도움말(상태 값) + SAP Project Piper(iFlow) |

### 2.3 종류별 판단

| 종류 | 목록·내려받기 | 생성 | 갱신 | 배포 | 구성 값 | 메모 |
|---|---|---|---|---|---|---|
| iFlow (지금) | 됨 | 됨 | PUT | 필요 시 | 있음(번들에 포함, ADR-025) | — |
| 스크립트 컬렉션 | 됨 | 됨(**확인됨**) | PUT(**공개 도구**, 도움말에는 없음) | 배포 함수 있음(**확인됨**). 다른 iFlow가 참조하므로 **iFlow보다 먼저 배포해야 할 것(추정)** | 없음(**추정**) | 다른 패키지의 iFlow도 참조할 수 있다(**확인됨**: 참조 화면이 다른 패키지 목록을 보여 줌) |
| 메시지 매핑 | 됨 | 됨(**확인됨**) | 도움말에는 갱신이 없다. PUT은 **공개 도구**만 근거 | 화면 문서: "쓰기 전에 먼저 배포해야 한다"(**확인됨**). API 배포 함수는 **공개 도구** | 없음(**추정**) | 함수 라이브러리·메시지 타입을 참조할 수 있다. 대상 테넌트 플랜이 그것들을 지원하지 않으면 매핑을 쓸 수 없다(**확인됨**) |
| 밸류 매핑 | 됨(**확인됨**) | 됨(**확인됨**) | DELETE 후 POST(**공개 도구**). 값 단위 `UpsertValMaps` 함수와 `$batch`도 있음(**확인됨**) | 배포 가능(**확인됨**), 런타임 BUNDLE 유형 | 도움말 예시 요청에 "구성 읽기·갱신"(**확인됨**, 형식은 **확인 못함**) | 구성된(`IsConfigured`) 스키마는 바꿀 수 없음(**확인됨**). 공개 도구 주석: API가 `metainfo.prop`(설명)을 돌려주지 않음 |
| 데이터 타입·메시지 타입·폴트 메시지 타입 | 됨 | 됨 | PUT | **배포 없음**(공개 도구가 "지원 안 함"으로 건너뜀) | 없음 | 도움말 리소스 표에는 없음(**공개 도구**만 근거). 테넌트 플랜에 따라 없을 수 있음(**추정**, 위 메시지 매핑 주의 문장) |
| 함수 라이브러리 | **확인 못함** | **확인 못함** | — | — | — | 메시지 매핑의 종속물로만 문서에 나옴. 공개 도구도 다루지 않음 |
| 가져온 아카이브, REST/SOAP API, OData API 프로젝트 | **확인 못함** | — | — | — | — | OData API 프로젝트는 iFlow로 생성된다는 도움말 문장이 있어 iFlow 목록에 나올 수도 있음(**추정**). API 프록시는 CPI가 아니라 API Management(`/apiportal`) 쪽 |
| 통합 어댑터(사용자 어댑터) | `IntegrationAdapterDesigntimeArtifacts` | 가져오기 | — | 배포 | — | CF만(**확인됨**). 패키지 이관 대상으로 넣을지는 별도 판단 |

### 2.4 순서·의존 관계

- **패키지 먼저**: 모든 종류 생성 본문에 `PackageId`가 있다. 지금처럼 대상 패키지 확인·생성 뒤에 올린다. 사용자 태그(Custom Tags)가 필수로 설정된 대상 테넌트에서는 태그 값 없이 패키지 생성이 실패할 것(**추정**, 도움말: 필수 태그 없이 저장 못 함).
- **참조물 먼저**: iFlow가 스크립트 컬렉션·메시지 매핑을 참조하므로, 대상에 그것들이 없거나 배포 전이면 iFlow 배포가 실패할 것(**추정**). 순서 제안: 데이터·메시지 타입 → 스크립트 컬렉션·메시지 매핑(+배포) → 밸류 매핑(+배포) → iFlow(+배포).
- **패키지 밖 참조**: 스크립트 컬렉션은 다른 패키지의 것을 참조할 수 있다(**확인됨**). 이 도구가 고른 패키지만 옮기면 다른 패키지 참조물은 빠진다. API로 iFlow의 참조 목록을 얻는 방법은 **확인 못함**(zip 안 내용을 읽어야 할 것, **추정**).
- **같은 Id가 다른 패키지에 있을 때**: 화면 가져오기는 "Uniqueness Conflict"로 실패한다(**확인됨**). 종류별 API도 Id가 테넌트에서 유일할 것(**추정**, 지금 iFlow 조회가 패키지 없이 `Id`로 함).

## 3. 패키지 통째 이관 (참고 선택지)

| 항목 | 내용 | 근거 |
|---|---|---|
| 내려받기 | `GET /IntegrationPackages('{Id}')/$value` → zip. 초안 아티팩트가 하나라도 있으면 실패. configure-only 패키지는 내려받기 불가 | 확인됨 |
| 가져오기 | `POST /IntegrationPackages` JSON `{"PackageContent": "<zip base64>"}`. 같은 이름 패키지가 있으면 실패, `?Overwrite=true`로 덮어씀 | 확인됨 |
| 화면 가져오기 규칙 | 기존 패키지의 구성 값은 덮어쓰지 않음. 대상에만 있는 아티팩트는 남김(병합). 다른 패키지에 같은 아티팩트가 있으면 실패 | 확인됨(화면). API `Overwrite`가 같은지는 **확인 못함** |
| 배포 | 가져오기는 디자인 영역만. 배포는 종류별로 따로 해야 함 | 추정 |

장점은 종류를 가리지 않는 것(함수 라이브러리 등 API가 없는 종류도 포함될 가능성, **추정**). 단점은 iFlow별 결과·선택 이관이 안 되고, 원본 구성 값이 따라가지 않을 수 있으며(위 화면 규칙), ADR-023·025(원본 구성 값 그대로 복사)와 맞는지 실제 확인이 필요하다는 것이다.

## 4. 지금 코드와의 차이

- `CpiApiClient`는 iFlow 경로만 이름으로 갖고 있다(`listArtifacts`, `downloadArtifact`, `createArtifact`, `updateArtifact`, `deploy`, `getRuntimeStatus`). 경로 문자열의 `IntegrationDesigntimeArtifacts`를 종류 이름으로 바꾸면 대부분 그대로 쓸 수 있다.
- `CpiHttpExecutor`는 POST·PUT에만 CSRF 토큰을 붙인다. DELETE는 토큰 없이 보내므로 실제 테넌트에서는 `403 X-CSRF-Token: Required`가 날 것(**추정**: 도움말은 POST·PUT·DELETE 모두 토큰이 필요하다고 함). 403 재시도도 POST·PUT만 한다.
- 본문은 항상 `application/json`이다. `$batch`(multipart/mixed)는 보낼 수 없다.
- 배포 대기(`DeployService`)는 `IntegrationRuntimeArtifacts('{id}')` 상태를 본다. 스크립트 컬렉션·메시지 매핑이 이 런타임 목록에 나오는지는 **확인 못함**(도움말은 런타임 직접 배포를 BUNDLE 유형으로 한정).

## 5. "테스트" — 로컬 스텁으로 확인한 것

`src/test/java/com/company/sap/cpitransport/client/PackageObjectTypesSpikeTests.java` (WireMock, 더미 자격증명, 6개 통과). 기존 `CpiHttpExecutor`를 그대로 썼다.

| 확인 | 결과 | R-6에서 할 일 |
|---|---|---|
| 종류별 목록 `IntegrationPackages('{pkg}')/{T}DesigntimeArtifacts` (페이지 조회) | 됨 | 클라이언트에 종류 인자 추가 |
| 종류별 내려받기 `$value` | 됨(iFlow와 같은 `Accept`, 바이너리 그대로) | — |
| 종류별 생성 POST(base64 본문), `Deploy{T}DesigntimeArtifact` 호출 | 됨(CSRF 한 번 받아 재사용) | — |
| DELETE(밸류 매핑 갱신 = 삭제 후 생성) | **안 됨**. CSRF 토큰 없이 보내 403에서 멈춤 | 실행기 쓰기 메서드에 DELETE 포함 |
| 밸류 매핑 `$batch` | **안 됨**. 본문이 항상 `application/json` | 값 단위 갱신을 쓸 때만 필요. 아티팩트 단위 이관이면 불필요 |
| 패키지 통째 `GET .../$value`, `POST /IntegrationPackages?Overwrite=true` | 됨 | 3절 선택지를 고를 때만 |

## 6. R-6 범위 제안

권장: **종류별 이관(iFlow 방식 확장)**. 지금 결과 화면·이력·구성 값 처리(ADR-023·025)를 그대로 쓰고 종류만 늘린다.

1. 1차 종류: **스크립트 컬렉션, 메시지 매핑, 밸류 매핑**(도움말에 리소스가 있는 것). 데이터·메시지 타입은 R-6 시작 전에 실제 테넌트에서 엔터티가 있는지 본 뒤 넣는다. 함수 라이브러리·아카이브·REST/SOAP API는 제외하고, 미리보기에서 "옮기지 않는 종류"로 보여 줄지 정한다(목록 API가 없으면 존재도 알 수 없음).
2. 클라이언트: 경로를 종류별로 만드는 함수 하나로 묶는다(`{T}DesigntimeArtifacts`). 실행기는 DELETE에 CSRF 토큰과 403 재시도를 넣는다.
3. 처리 순서: 패키지 → 스크립트 컬렉션·메시지 매핑 → 밸류 매핑 → iFlow. 배포 켬이면 앞 종류를 배포·확인한 뒤 iFlow를 배포한다. R-3(비동기 작업)의 진행 단계에 종류를 넣는다.
4. 갱신: 스크립트 컬렉션·메시지 매핑은 PUT(본문 `ArtifactContent`만), 실패하면 오류로 보이고 자동 삭제 후 재생성은 하지 않는다(대상 런타임이 끊길 수 있음). 밸류 매핑은 삭제 후 생성이 필요한데, 삭제와 생성 사이에 실패하면 대상에서 사라지므로 사람 결정이 필요하다(아래).
5. 결과·이력: 아티팩트 결과에 종류 필드를 더한다. 예전 이력은 iFlow로 읽는다.

R-6 정렬 인터뷰에서 사람이 정할 것:

- 밸류 매핑 갱신 방식(삭제 후 생성 허용 / 이미 있으면 건너뛰고 알림 / 값 단위 `UpsertValMaps`).
- 패키지 밖 참조물(다른 패키지의 스크립트 컬렉션)을 알릴지·막을지.
- 데이터·메시지 타입 포함 여부(테넌트 플랜 확인 뒤).
- 패키지 통째 이관(3절)을 따로 PoC할지.

R-6 시작 전에 사람이 실제 테넌트에서 확인할 것(조회만, 7절): 종류별 목록 응답 모양, 스크립트 컬렉션·메시지 매핑이 `IntegrationRuntimeArtifacts`에 나오는지, 데이터·메시지 타입 엔터티 유무, 밸류 매핑 zip 안 구성 값 형식.

## 7. 사람이 직접 확인하는 절차 (선택)

> 개발 테넌트에서 조회(GET)만 권한다. 생성·삭제·배포는 대상 테넌트를 바꾸므로 시험용 패키지로만, 사람 확인 뒤에 한다.
> 자격증명은 터미널 환경 변수로만 넣고 파일·이력에 남기지 않는다.

1. 토큰(Process Integration Runtime `api` 키):

```bash
TOKEN=$(curl -s -u "$CPI_CLIENT_ID:$CPI_CLIENT_SECRET" -d grant_type=client_credentials "$CPI_TOKEN_URL" | jq -r .access_token)
```

2. 종류별 목록(패키지 하나):

```bash
for T in ScriptCollection ValueMapping MessageMapping DataType MessageType; do echo "== $T"; curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" "$CPI_API_URL/api/v1/IntegrationPackages('<패키지 ID>')/${T}DesigntimeArtifacts" | jq -c '.d.results[]? | {Id, Version}'; done
```

3. 배포된 스크립트 컬렉션·메시지 매핑이 런타임 목록에 나오는지:

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" "$CPI_API_URL/api/v1/IntegrationRuntimeArtifacts('<스크립트 컬렉션 ID>')" | jq .
```

4. 볼 것: 404인 종류(엔터티 없음), 응답 필드 이름, 밸류 매핑 zip(`$value`) 안에 구성 값 파일이 있는지.

## 출처

- SAP Help — Integration Content (리소스 표, CSRF 규칙): https://help.sap.com/docs/cloud-integration/sap-cloud-integration/integration-content (원문 https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ci/Development/integration-content-d1679a8.md)
- SAP Help — Integration Package Example Requests (패키지 `$value`, `PackageContent`, `Overwrite`): https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ci/Development/integration-package-example-requests-24a39f0.md
- SAP Help — Value Mapping Example Requests (`UpsertValMaps`, `$batch`, 구성): https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ci/Development/value-mapping-example-requests-1425fe5.md
- SAP Help — Build and Deploy Status: https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ci/Development/build-and-deploy-status-d8934e0.md
- SAP Help — Importing / Exporting Integration Packages (병합, Uniqueness Conflict, configure-only): https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ci/Development/importing-integration-packages-b6a1a61.md · https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ci/Development/exporting-integration-packages-95c0299.md
- SAP Help — Working with an Integration Package (화면에서 배포·구성·내려받기 가능한 종류): https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ci/Development/working-with-an-integration-package-c433ce2.md
- SAP Help — Creating Message Mapping as an Artifact (먼저 배포, 함수 라이브러리·메시지 타입 플랜 제약): https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ci/Development/creating-message-mapping-as-an-artifact-1d52a7b.md
- SAP Help — Consuming a Script Collection (다른 패키지 참조): https://github.com/SAP-docs/btp-integration-suite/blob/main/docs/ci/Development/consuming-a-script-collection-1b801fa.md
- SAP Community — Create value mapping using API (zip base64): https://groups.community.sap.com/t5/technology-blogs-by-members/create-value-mapping-using-api/ba-p/13559626
- FlashPipe (공개 도구) `internal/api/design.go`, `valuemap.go`, `msgmap.go`, `script.go`, `datatype.go`, `messagetype.go`, `integrationpackage.go`: https://github.com/engswee/flashpipe/tree/main/internal/api
- SAP Project Piper `integrationArtifactDeploy.go`, `integrationArtifactUpload.go` (iFlow만): https://github.com/SAP/jenkins-library/tree/master/cmd
- SAP Business Accelerator Hub — Integration Content (로그인 필요, 이번에 읽지 못함): https://api.sap.com/api/IntegrationContent/resource
