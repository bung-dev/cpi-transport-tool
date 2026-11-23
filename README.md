# CPI Transport Tool

SAP Cloud Integration(CPI) 패키지를 한 테넌트에서 다른 테넌트로 옮기는 사내용 웹 도구입니다. 미리보기로 바뀔 내용을 먼저 확인하고, 확인창을 거쳐 실제로 옮깁니다.

## 기능

- 등록한 테넌트(서비스 키) 사이에서 패키지 이관. 여러 패키지 선택, 대상에 패키지가 없으면 만들기
- iFlow, 스크립트 컬렉션, 메시지 매핑, 밸류 매핑 이관. 배포는 선택
- 미리보기 → 실제 이관. 진행 화면, 취소, 실패분만 다시 이관
- 템플릿(원본 → 대상 경로), 대시보드, 이관·감사 이력

## 시작하기 (Docker)

필요한 것: Docker Engine과 Compose 플러그인. 앱은 이 PC(`127.0.0.1:8080`)에서만 열립니다.

```bash
cp docker.env.example .env
# 테넌트 정보 암호화 키를 만들어 .env에 넣는다(처음 한 번만, 이후 같은 값 유지)
sed -i "s|^CPI_TENANT_STORE_KEY=.*|CPI_TENANT_STORE_KEY=$(openssl rand -base64 32)|" .env
docker compose up -d --build
```

브라우저로 http://localhost:8080 을 엽니다.

| 할 일 | 명령 |
|---|---|
| 로그 보기 | `docker compose logs -f app` |
| 정지 | `docker compose down` |
| 데이터까지 삭제 | `docker compose down -v` (등록 테넌트·이력이 모두 지워짐) |

- 데이터(테넌트, 템플릿, 이력)는 Docker 볼륨 `cpitt-data`에 남습니다.
- 처음에는 **읽기 전용**이라 미리보기만 됩니다. 실제로 옮길 때만 `.env`의 `CPI_TRANSPORT_READ_ONLY=false`로 바꾸고 `docker compose up -d`로 다시 띄웁니다.
- 암호화 키를 잃거나 바꾸면 등록한 테넌트를 다시 등록해야 합니다. `.env`는 git에 올리지 않습니다.

## 테넌트 등록

1. SAP BTP cockpit에서 **Process Integration Runtime**(plan **api**) 인스턴스를 만들고 ClientId/Secret 방식의 서비스 키를 만듭니다.
2. 앱의 **테넌트** 화면 → **테넌트 등록**에서 이름을 적고 서비스 키 JSON을 붙여넣습니다. 키는 암호화되어 저장되고 다시 보이지 않습니다.

서비스 키 파일은 저장소 밖에 두세요.

## 사용

1. **새 이관**: 템플릿(선택) → 패키지 → 아티팩트 → **미리보기 실행**
2. 결과를 확인하고 **이 구성으로 실제 이관** → 확인창에서 **실행**. 배포까지 하려면 확인창의 **배포** 스위치를 켭니다.
3. 진행 화면에서 n/N을 보고, 필요하면 취소합니다. 끝나면 실패한 것만 다시 이관할 수 있습니다.

## 알아 둘 점

- 아티팩트는 원본 그대로 올리고, 구성 값(Externalized Parameters)도 원본 값을 대상에 그대로 넣습니다. 민감 키 값은 결과 화면과 이력 파일에 평문으로 남습니다(로그에는 남지 않음).
- 대상 아티팩트가 SAP 화면에서 편집 중(잠김)이면 업로드가 실패합니다. SAP에서 저장하거나 취소한 뒤 다시 이관하세요.
- 밸류 매핑은 대상에서 지운 뒤 다시 만듭니다.
- 배포 실패 상세에는 SAP 오류 문구가 그대로 보입니다. 비밀값처럼 보이는 글자는 가리지만 공유 전에 직접 확인하세요.
- 브라우저 완료 알림(설정 탭)은 실제 브라우저에서 동작하지 않는 것으로 확인됐습니다.

## 개발

- 백엔드: Spring Boot(`src/`), JDK 25. 화면: React + TypeScript + Vite(`frontend/`), Node.js 24 이상. 화면 빌드 결과는 실행형 JAR에 함께 들어갑니다.
- 백엔드 테스트: `./gradlew test`
- 화면 테스트·빌드: `cd frontend && npm ci && npm test && npm run build`
- 실행형 JAR: `./gradlew bootJar` → `build/libs/cpi-transport-tool-<버전>.jar`
- 버전은 `build.gradle`의 `version` 하나에서 정합니다. 화면 맨 아래, `GET /version`, 기동 로그에서 버전과 커밋을 볼 수 있습니다.
