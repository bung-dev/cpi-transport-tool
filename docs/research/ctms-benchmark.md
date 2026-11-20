# cTMS·Content Agent 벤치마킹: 이 도구를 어떻게 발전시킬까

- 작성일: 2026-11-19 (트랙 E 탐색)
- 앞선 조사: [transport-module-api.md](transport-module-api.md), [content-agent-api.md](content-agent-api.md)
- 표기: **확인됨** = 원문·코드에서 직접 읽음 / **추정** = 정황으로 판단. 속도 수치는 2026-11-19 실제 테넌트 실측(iFlow 40개)을 기준으로 한 **계산값**이며 측정값이 아니다.

## 1. 한 줄 결론

cTMS의 **API를 쓰는 것**보다 **설계 개념을 가져오는 것**이 이득이 크다. 가져올 만한 것은 다섯 가지다.

1. **비동기 작업 + 큐**
2. **한 번 만든 묶음을 다음 환경까지 그대로 쓰기**(build once, deploy many)
3. **배포를 먼저 다 걸고 나중에 한꺼번에 상태 확인**
4. **Transport Request(묶음) 단위의 추적·재시도**
5. **대상 환경별 구성 값 덮어쓰기**(MTA extension descriptor에 해당)

가져오지 말 것은 MTAR·CF 배포 같은 무거운 인프라와 패키지 단위 이관이다. 이 도구의 강점(iFlow 단위, 미리보기, 빠른 단일 사용자 흐름)과 맞지 않는다.

## 2. cTMS가 실제로 하는 일 (개념 정리)

| cTMS 개념 | 내용 | 근거 |
|---|---|---|
| 노드·라우트 | 환경을 노드로, 이관 방향을 라우트로 정의 | 블로그 Step 3~4 (**확인됨**) |
| Transport Request(TR) | 내용물(MTAR)을 담은 불변 묶음. 설명·소유자(`transportUser`)가 붙음 | Content Agent 명세 `ContentExportRequest` (**확인됨**) |
| 노드별 가져오기 큐 | 내보내면 다음 노드의 큐에 쌓이고, 기본은 사람이 "Import Selected/All"로 가져옴 | 블로그 Step 11, SAP Learning (**확인됨**) |
| 전달(forward) | 한 노드로 가져오면 다음 노드 큐로 자동으로 넘어감. 전달 시점은 설정으로 바뀜(가져오기 전/후 등) | 블로그 Step 11 (**확인됨**), 모드 이름은 커뮤니티 자료(**추정**) |
| 자동·예약 가져오기 | 노드별로 큐에 들어오면 자동으로 가져오거나 일정에 따라 가져옴 | SAP 로드맵 블로그 (**확인됨**) |
| TR 추적 화면 | TR 하나가 거친 모든 노드의 가져오기 상태를 한눈에(초록=성공, 빨강=오류) | SAP 블로그 "transport request centric view" (**확인됨**) |
| 비동기 작업 | 요청하면 작업 ID를 바로 돌려주고 상태(`INITIAL`/`RUNNING`/`FINISHED`/`ERROR`)·로그를 따로 조회 | Content Agent 명세 (**확인됨**) |
| 항목별 결과 등급 | `SUCCESS`/`WARNING`/`SKIPPED`/`CONTENT_ERROR`(고쳐야 재시도 의미 있음)/`SEVERE_ERROR`(재시도 가능) | Content Agent 명세 `DeployStatus` (**확인됨**) |
| 환경별 설정 | MTA extension descriptor로 노드마다 다른 설정값을 붙여 가져옴 | SAP 로드맵 블로그 (**확인됨**) |
| 역할 분리 | 내보내기·가져오기·랜드스케이프 관리 역할이 따로 있음(예: `ImportOperator`) | 도움말·블로그 댓글 (**확인됨**) |

## 3. 지금 도구와 비교

| 영역 | 지금 도구 (코드 확인) | cTMS 방식 | 차이 |
|---|---|---|---|
| 실행 방식 | `POST /transport` 한 번이 끝날 때까지 HTTP 요청을 붙잡음(`TransportController`). 끝나야 이력에 남음 | 작업 ID를 바로 반환하고 상태 조회 | 진행률 없음, 새로고침하면 결과를 잃음, 취소 불가, 긴 이관에서 타임아웃 위험 |
| 원본 읽기 | 미리보기와 실제 이관이 각각 원본에서 다시 내려받음 | 한 번 만든 MTAR을 QA·PRD에 그대로 씀 | 같은 내용을 두 번 내려받음. QA에서 검증한 것과 PRD에 가는 것이 같다는 보장이 없음 |
| 배포 | iFlow마다 배포를 건 뒤 **최소 1회 폴링 간격(기본 5초)을 기다리고** 다음 iFlow로 감(`DeployService.deployAndWaitOutcome`) | 한꺼번에 가져오고 상태를 모아서 봄 | 배포를 켜면 iFlow 40개에 최소 200초(순차 기준, 계산값) |
| 다음 환경으로 넘기기 | 대시보드 "대기 항목" → "전달"을 누르면 마법사가 열림(자동 실행 없음) | 다음 노드 큐에 자동 적재, 사람은 가져오기만 누름 | 개념은 이미 비슷함. 묶음·큐가 없어서 매번 다시 고르고 다시 미리보기 |
| 이력 | 이관 단위 JSONL, 결과 화면 재조회 | TR 단위로 모든 노드의 상태를 추적 | "이 변경이 지금 어디까지 갔나"를 한 화면에서 못 봄 |
| 실패 처리 | 결과 화면에서 실패 개수 표시 | 결과를 등급으로 나누고, 실패한 것만 다시 가져오기 | 실패한 iFlow만 다시 돌리는 버튼이 없음 |
| 구성 값 | 원본 값을 그대로 복사(매핑 기능은 없앰) | 노드별 extension descriptor | 환경마다 다른 값(URL·계정)을 다룰 수단이 없음 |

## 4. 제안

### 4.1 성능

진행 중인 변경(구성 값 PUT 제거, iFlow 동시 처리 4개)을 적용하면, 실측 단계 시간(내려받기 0.75초 + 구성 값 읽기 0.37초 + 대상 확인 0.15초 + 업로드 0.36초 ≈ iFlow당 1.6초)으로 계산해 iFlow 40개가 약 65초(순차), 동시 4개면 약 17초다. 배포를 끄면 이것만으로 충분히 빠르다. 그다음 병목은 아래 순서다.

| 순위 | 제안 | 기대 효과 (계산값·추정) | 크기 |
|---|---|---|---|
| P1 | **배포를 먼저 모두 걸고, 상태는 한 번에 모아서 폴링** (cTMS의 "가져오기 → 상태 조회" 분리) | 배포 켠 40개 기준 최소 대기 200초(순차) → 폴링 몇 바퀴(수십 초)로 줄어들 것 | 중 |
| P1 | **미리보기에서 내려받은 묶음을 실제 이관에 재사용** (스냅숏) | 실제 이관에서 내려받기·구성 값 읽기(iFlow당 약 1.1초) 생략 | 중 |
| P2 | **스냅숏을 다음 환경 전달에도 재사용**(build once, deploy many) | QA→PRD 전달 시 원본 다시 읽지 않음. 속도보다 "QA에서 본 것이 PRD에 간다"는 보장이 핵심 | 중 |
| P3 | **바뀐 것만 보내기**: 원본·대상 버전(또는 묶음 해시)이 같으면 업로드 건너뜀 | 반복 이관에서 업로드·배포 대부분 생략. cTMS에는 없는 우리 쪽 아이디어 | 소~중 |

스냅숏은 서비스 키처럼 민감하지 않지만 구성 값에 비밀값이 섞일 수 있으므로, 이력 파일과 같은 수준(로컬 볼륨, 공유 전 확인)으로 다루고 보존 기간을 둔다.

### 4.2 UI/UX·사용자 친화

| 순위 | 제안 | 화면에서 보이는 모습 | 비고 |
|---|---|---|---|
| P1 | **비동기 작업 + 진행 화면** | 실행을 누르면 바로 "작업 #12 진행 중 18/40"이 나오고 iFlow별로 대기→내려받기→업로드→배포 단계가 채워짐. 새로고침·다른 화면으로 가도 이어서 보임. 취소 버튼 | 백로그의 "진행 표시"·"비동기 큐 탭"과 같은 것. 백엔드는 작업 표 + 실행 스레드 풀 + `GET /jobs/{id}`(폴링 또는 SSE) |
| P1 | **결과 등급 나누기 + "실패한 것만 다시"** | 성공 / 경고 / 건너뜀 / 고쳐야 함(내용 오류, 잠김 등) / 다시 시도 가능(일시 오류) | Content Agent의 `CONTENT_ERROR`·`SEVERE_ERROR` 구분을 그대로 빌림. 잠김(Draft) 안내는 이미 있음 |
| P2 | **Transport Request(이관 묶음)** | 이관마다 제목·설명·티켓 번호를 붙이고, 묶음 상세에서 DEV→QA→PRD 각 단계의 상태를 한 줄로(초록/빨강) | cTMS의 TR 추적 화면. 지금 이력과 대시보드를 묶음 기준으로 다시 엮는 것 |
| P2 | **다음 환경 큐** | 대시보드 "대기 항목"을 환경별 큐로: 체크해서 "선택 가져오기 / 모두 가져오기". 묶음 스냅숏을 쓰므로 다시 고를 필요 없음 | 지금 "전달" 버튼의 발전형. 자동 실행은 하지 않는 지금 원칙 유지 |
| P3 | **대상 환경별 구성 값 덮어쓰기(프로필)** | 템플릿(경로)마다 "이 대상에서는 이 키를 이 값으로" 표. 미리보기에서 덮어쓴 값이 보임 | MTA extension descriptor에 해당. 백로그 "미리보기에서 Externalized Parameters 편집"과 합칠 수 있음. 예전 매핑 기능을 없앤 이유를 먼저 확인할 것 |
| P3 | **완료 알림** | 작업이 끝나면 브라우저 알림·탭 제목 배지 | 비동기 작업이 생긴 뒤에만 의미 있음 |
| 보류 | 자동·예약 가져오기, 역할 분리·승인 | — | 이 도구는 한 PC(127.0.0.1)에서 한 사람이 쓰는 도구라 지금은 과함. 여러 사람이 쓰게 되면 다시 검토 |

### 4.3 가져오지 않을 것

- **MTAR/MTA·CF Deploy Service·Content Agent 연동**: 서브계정마다 서비스·Destination·권한이 늘고, 패키지 단위로 묶여 iFlow 선택·미리보기 장점이 사라진다(앞 두 문서).
- **패키지 단위 이관만 허용하는 모델**: 이 도구의 차별점이 iFlow 단위다.

## 5. 진행 순서 제안

1. 지금: `feat/transport-speedup`(구성 값 PUT 제거, 동시 처리)을 끝내고 같은 iFlow 40개로 다시 잰다.
2. 다음 변경 하나: **비동기 작업 + 진행 화면 + 배포 일괄 폴링**. 사용자가 느끼는 개선이 가장 크고, 뒤의 큐·묶음·재시도가 모두 이 위에 올라간다.
3. 그다음: 스냅숏(미리보기 재사용 → 다음 환경 재사용) + 실패한 것만 다시.
4. 이후: Transport Request 묶음·환경별 큐, 환경별 구성 값 프로필.

## 출처

- 앞 두 문서의 출처 전부(SAP Help Content Agent 사용자 안내서, Business Accelerator Hub `contentagentapi` 명세, TiaXu 블로그)
- SAP Community — SAP Cloud Transport Management now offers transport request centric view: https://groups.community.sap.com/t5/technology-blogs-by-sap/sap-cloud-transport-management-now-offers-transport-request-centric-view/ba-p/13585296
- SAP Community — SAP Cloud Platform Transport Management roadmap (June 2020, 자동 가져오기·MTA extension descriptor): https://groups.community.sap.com/t5/technology-blogs-by-sap/sap-cloud-platform-transport-management-roadmap-as-of-june-2020/ba-p/13440787
- SAP Learning — Handling Delivery with Transports(가져오기 큐, 기본 수동 가져오기): https://learning.sap.com/courses/exploring-devops-with-sap-btp/handling-delivery-with-transports_d9fe865e-4d83-44d7-acf5-2195bfd43fe5
- 코드: `TransportController.transport`(동기 실행), `DeployService.deployAndWaitOutcome`(iFlow마다 배포 후 대기), `TransportService`(원본 내려받기), README "대시보드·대기 항목"
