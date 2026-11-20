# 변경 기록

버전 규칙과 병합 절차는 [README의 "버전"](README.md#버전)에 있습니다. 버전은 main 병합 커밋에서 올리고, 그 커밋에 `vX.Y.Z` 태그를 붙입니다.

## 미출시

## 0.2.0 — 2026-11-20

- `feat/20261120-r1-wording` 화면 문구·표기 정리(R-1): 결과 바로가기 이름만, 결과 화면 구성 값 표기 Externalized Parameters, 실제 이관 단계 "실제 이관 실행". 대시보드 오늘 숫자를 누르면 같은 조건의 이관 이력(`GET /transport/history?date&mode&result`, 조건 줄·조건 해제), summary 없는 이력 기록 표시

## 0.1.0 — 2026-11-20

- `claude/r1a-versioning-228015` 버전 관리 도입: 버전·커밋을 화면 아래, `GET /version`, 기동 로그 한 줄에 표시. 빌드 정보는 `build.gradle` 하나에서 정함. Dockerfile의 jar 이름 고정 제거, `CHANGELOG.md`와 병합 때 버전·태그 절차 추가

## 0.1.0 이전

태그 없이 병합된 변경입니다(오래된 것이 아래).

- 2026-11-20 `R-2` 패키지 안 iFlow 외 오브젝트 종류 조사(조사)
- 2026-11-20 `claude/spike-transport-module-api-96b61a` cTMS·Content Agent 이관 API 조사와 벤치마킹 제안(조사)
- 2026-11-20 `feat/transport-speedup` 구성 값 PUT 제거, iFlow 동시 처리, 동시 처리 설정 탭
- 2026-11-19 `feat/package-autocreate-multi` 여러 패키지 이관과 대상 패키지 자동 생성, 템플릿은 경로만
- 2026-11-18 `feat/remove-value-mapping` 값 치환 제거, 원본 그대로 업로드와 구성 값 복사
- 2026-11-17 `fix/no-tenant-start` 개발 서버 프록시 누락(테넌트 등록 404), 테넌트 0개 시작 화면, 감사 파일 읽기 실패 오류 코드
- 2026-11-17 `docs/readme-refresh` README 새 화면 기준 재작성
- 2026-11-17 `feat/ui-refresh` 화면 전면 개편(셸·대시보드·이관 마법사)과 템플릿·감사 기록·대시보드 API
- 2026-11-10 `feat/workflow-v3` E2E 시나리오 이전과 시간 민감 테스트 수정
- 2026-10-28 `chore/small-cleanup` Docker 매핑 기본값, REF 무시
- 2026-10-28 `chore/docker-compose` Docker 실행 추가
- 2026-10-28 `wf/20261020-defect-fix` 테넌트 등록·연결 상태·읽기 전용 모드·배포 오류 상세 등 결함 수정과 보강
- 2026-09-30 `wf/20260929-frontend-ui` 화면(React) 추가
- 2026-09-30 `wf/20260928-cpi-transport` 첫 이관 기능(패키지·iFlow 이관, 미리보기, 배포)
