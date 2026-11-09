# 브라우저 E2E

v2 run `20261020-defect-fix`의 Playwright 시나리오(`04_qa/e2e`)를 저장소로 옮긴 것이다. 실제 테넌트에는 접속하지 않는다. 앱은 로컬 스텁(DEV 18081, PRD 18082)과 더미 자격증명으로만 뜬다.

## 묶음과 앱 구성

| 묶음 | 앱 구성 | 내용 |
|---|---|---|
| smoke, s01, s07, s10 | 읽기 전용 기본값(켜짐), 테넌트 DEV·PRD | 첫 화면, 키보드 이동, 등록 폼 오류 뒤 입력 비움, 읽기 전용 안내 |
| s02, s04, s05, s06, s08, s09 | 읽기 전용 끔, 테넌트 DEV·PRD | Accept 헤더, 갱신 400 안내, 실패 개수, 이력 표, 대표 사용자 흐름, 이관 탭 |
| s03, s11 | 테넌트 0개 | 테넌트 없을 때 안내 문구 |

## 실행

워크플로우 검사(`python .claude/wf3/check.py`)가 묶음마다 스텁과 앱을 띄우고 끝나면 멈춘다. 손으로 돌릴 때:

```bash
./gradlew bootJar
./gradlew runLocalStubs                                  # 터미널 1
python e2e/tools/app.py --label ro                       # 터미널 2 (묶음 표의 구성에 맞게)
cd e2e && npm ci && QA_APP_LOG=../build/e2e-app/ro/app-ro.log npx playwright test specs/smoke specs/s01 specs/s07 specs/s10
```

브라우저는 기본으로 설치된 Edge(`PW_CHANNEL=msedge`)를 쓴다. 결과와 캡처는 `e2e/.artifacts/`(git 무시)에 남는다.
