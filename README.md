# CPI Transport Tool

DEV iFlow를 PRD로 이관하고 매핑 파일로 Content Modifier와 Externalized Parameter를 치환하는 REST 도구입니다. 아래 절차는 실제 테넌트 없이 localhost WireMock과 더미 자격증명만 사용합니다.

## 사전 조건

- 저장소 루트에서 실행합니다. Gradle Wrapper와 JDK 25 toolchain이 필요합니다. PATH의 Java 21로 앱을 직접 실행하지 않습니다.
- DEV 18081, PRD 18082, 앱 8080 포트가 비어 있어야 합니다.
- 터미널 3개를 사용합니다: 스텁, 앱, API 호출. 각 서버는 포그라운드로 실행하고 해당 터미널에서 Ctrl+C로 정지합니다.
- 테스트: PowerShell ` .\gradlew.bat test`, Git Bash `./gradlew test`.

## 1. 스텁 기동 (터미널 1)

PowerShell 5.1:

```powershell
.\gradlew.bat runLocalStubs
```

Git Bash:

```bash
./gradlew runLocalStubs
```

`Local CPI stubs: DEV=http://localhost:18081 PRD=http://localhost:18082` 출력으로 확인합니다. DEV 원본 ZIP은 `build/local-stubs/dev-zips/<ArtifactId>.zip`에 생성됩니다.

## 2. 앱 기동 (터미널 2)

DEV+PRD 설정, 예제 YAML 매핑, 로컬 이력·로그 경로를 지정합니다. JSON 매핑을 쓰려면 `examples/mapping-example.json`으로 바꿉니다. 두 파일의 매핑 내용은 같습니다.

PowerShell 5.1:

```powershell
$env:CPI_DEV_API_URL = 'http://localhost:18081'
$env:CPI_DEV_TOKEN_URL = 'http://localhost:18081/oauth/token'
$env:CPI_DEV_CLIENT_ID = 'dummy-dev-client'
$env:CPI_DEV_CLIENT_SECRET = 'dummy-dev-secret'
$env:CPI_PRD_API_URL = 'http://localhost:18082'
$env:CPI_PRD_TOKEN_URL = 'http://localhost:18082/oauth/token'
$env:CPI_PRD_CLIENT_ID = 'dummy-prd-client'
$env:CPI_PRD_CLIENT_SECRET = 'dummy-prd-secret'
New-Item -ItemType Directory -Force build/local-stubs | Out-Null
$env:CPI_TRANSPORT_MAPPINGFILE = 'examples/mapping-example.yml'
$env:CPI_TRANSPORT_HISTORY_FILE = 'build/local-stubs/history.jsonl'
$env:LOGGING_FILE_NAME = 'build/local-stubs/app.log'
.\gradlew.bat bootRun
```

Git Bash:

```bash
export CPI_DEV_API_URL=http://localhost:18081
export CPI_DEV_TOKEN_URL=http://localhost:18081/oauth/token
export CPI_DEV_CLIENT_ID=dummy-dev-client
export CPI_DEV_CLIENT_SECRET=dummy-dev-secret
export CPI_PRD_API_URL=http://localhost:18082
export CPI_PRD_TOKEN_URL=http://localhost:18082/oauth/token
export CPI_PRD_CLIENT_ID=dummy-prd-client
export CPI_PRD_CLIENT_SECRET=dummy-prd-secret
mkdir -p build/local-stubs
export CPI_TRANSPORT_MAPPINGFILE=examples/mapping-example.yml
export CPI_TRANSPORT_HISTORY_FILE=build/local-stubs/history.jsonl
export LOGGING_FILE_NAME=build/local-stubs/app.log
./gradlew bootRun
```

DEV만 설정하려면 앱을 정지하고 위 DEV·매핑·이력 설정을 유지한 채 다음 명령으로 PRD 환경 변수를 해제하고 다시 실행합니다. DEV 조회는 가능하며 PRD가 필요한 이관은 환경 미설정 오류가 됩니다.

```powershell
$env:CPI_PRD_API_URL = $null
$env:CPI_PRD_TOKEN_URL = $null
$env:CPI_PRD_CLIENT_ID = $null
$env:CPI_PRD_CLIENT_SECRET = $null
.\gradlew.bat bootRun
```

```bash
unset CPI_PRD_API_URL CPI_PRD_TOKEN_URL CPI_PRD_CLIENT_ID CPI_PRD_CLIENT_SECRET
./gradlew bootRun
```

## 3. 준비 확인과 이관 (터미널 3)

DEV+PRD 앱의 `Started CpiTransportToolApplication` 로그를 확인한 뒤 실행합니다. 준비 확인은 HTTP 200이어야 합니다. PowerShell의 `curl` 별칭 대신 `curl.exe`를 사용하며 JSON은 파일로 전달합니다.

PowerShell 5.1:

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:18082/__admin/mappings
curl.exe -s -o NUL -w "%{http_code}" http://localhost:8080/transport/history
Set-Content -Path build/local-stubs/body-transport.json -Value '{"packageId":"PkgTransportDemo"}' -Encoding Ascii -NoNewline
curl.exe -s -o build/local-stubs/transport-response.json -w "%{http_code}" -X POST http://localhost:8080/transport -H "Content-Type: application/json" --data-binary "@build/local-stubs/body-transport.json"
Get-Content build/local-stubs/transport-response.json
```

Git Bash:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:18082/__admin/mappings
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/transport/history
printf '%s' '{"packageId":"PkgTransportDemo"}' > build/local-stubs/body-transport.json
curl -s -o build/local-stubs/transport-response.json -w '%{http_code}\n' -X POST http://localhost:8080/transport -H 'Content-Type: application/json' --data-binary @build/local-stubs/body-transport.json
cat build/local-stubs/transport-response.json
```

초기 상태에서 예제 이관은 HTTP 200, 응답의 `APPLIED` 1건 이상, 업로드 요청 2건을 기대합니다. 드라이런은 본문에 `"dryRun":true`를 추가합니다(업로드 없음).

## 4. 업로드 ZIP 확인

PowerShell 5.1:

```powershell
.\gradlew.bat extractUploadedArtifacts
# 포트를 변경해서 스텁을 실행한 경우:
.\gradlew.bat extractUploadedArtifacts --args="18082"
curl.exe -s http://localhost:18082/__admin/requests -o build/local-stubs/prd-requests.json
```

Git Bash:

```bash
./gradlew extractUploadedArtifacts
./gradlew extractUploadedArtifacts --args='18082'
curl -s http://localhost:18082/__admin/requests -o build/local-stubs/prd-requests.json
```

PRD 포트 인자의 기본값은 18082이며 호스트는 localhost로 고정됩니다. 관리 API는 `GET http://localhost:18082/__admin/requests`입니다. 도구는 생성 POST와 아티팩트 업데이트 PUT의 `ArtifactContent`를 Base64 디코드합니다. 파라미터 PUT 등은 제외합니다.

- ZIP: `build/local-stubs/uploads/<순번>-<ArtifactId>.zip`
- 추출한 `.iflw`: `build/local-stubs/uploads/<순번>-<ArtifactId>/<엔트리 경로>`
- 표: `SOURCE / ARTIFACT / ENTRY / BYTES / SHA-256 / FILE`. `[ZIP]` 행은 ZIP 전체, 나머지는 압축 해제한 각 엔트리의 실제 크기와 SHA-256입니다. `UPLOAD`와 `DEV` 행에서 동일한 엔트리를 비교합니다.
- `IF_Order_Sync`의 `.iflw` 이외 엔트리 SHA-256은 DEV 원본과 같아야 합니다. ZIP 전체 해시는 재압축 때문에 다를 수 있습니다.
- 원본이 없으면 `DEV MISSING`을 표시합니다. 업로드가 없으면 `Upload requests: 0`입니다. 실패한 업로드 시도와 재시도도 각각 기록하므로 요청 건수는 성공 건수와 다를 수 있습니다.
- 실행마다 현재 저널을 시간순으로 읽습니다. 같은 출력 이름은 덮어쓰며 이전 실행의 다른 파일은 삭제하지 않습니다. 현재 실행 결과는 출력 표를 기준으로 확인합니다.

## 5. 요청 저널·시나리오 초기화와 정지

다음 명령은 로컬 스텁의 요청 기록과 상태를 초기화합니다. 기본 매핑은 유지합니다. 토큰 요청 수를 확인할 때는 앱 재기동 → 저널 초기화 → API 호출 순서로 진행합니다(앱의 토큰 캐시는 저널 초기화로 지워지지 않음).

PowerShell 5.1:

```powershell
curl.exe -s -X DELETE http://localhost:18081/__admin/requests
curl.exe -s -X DELETE http://localhost:18082/__admin/requests
curl.exe -s -X POST http://localhost:18081/__admin/scenarios/reset
curl.exe -s -X POST http://localhost:18082/__admin/scenarios/reset
```

Git Bash:

```bash
curl -s -X DELETE http://localhost:18081/__admin/requests
curl -s -X DELETE http://localhost:18082/__admin/requests
curl -s -X POST http://localhost:18081/__admin/scenarios/reset
curl -s -X POST http://localhost:18082/__admin/scenarios/reset
```

앱·스텁 터미널에서 Ctrl+C로 정지합니다. 잔여 프로세스가 있으면 `netstat -ano`로 8080, 18081, 18082를 LISTEN하는 PID를 확인하고, 자신이 실행한 java 프로세스만 정지합니다.

Git Bash:

```bash
netstat -ano | grep -E ':(8080|18081|18082) .*LISTENING'
taskkill //PID <PID> //T //F
```

PowerShell:

```powershell
netstat -ano | Select-String -Pattern ":8080|:18081|:18082"
taskkill /PID <PID> /T /F
```

## 6. 화면(프론트엔드)

웹 화면은 `frontend/`(Vite + React + TypeScript + Tailwind CSS v4)에 있고, 빌드 결과는 실행형 JAR 안에 들어가 `http://localhost:8080/`에서 열립니다. 화면은 같은 출처의 API(`/packages`, `/transport`, `/transport/history`)만 호출합니다.

### 6-1. 사전 조건

- Node.js 24 이상(확인한 버전 v24.14.0)과 npm.
- `./gradlew bootJar`와 `./gradlew build`는 `frontend/`에서 `npm ci`와 `npm run build`를 실행하므로 Node와 npm 레지스트리 접근이 필요합니다.
- `./gradlew test`와 `./gradlew bootRun`은 Node를 실행하지 않습니다.
- PATH의 `java`가 25가 아니면 `./gradlew -q javaToolchains`에서 `Language Version: 25` 항목의 `Location`을 확인하고, 그 아래 `bin/java`(PowerShell은 `bin\java.exe`)를 씁니다.

### 6-2. 개발 (개발 서버 5173)

개발 서버는 `/packages`와 `/transport`로 시작하는 요청을 `http://localhost:8080`으로 프록시하므로, 백엔드를 2절대로 먼저 기동합니다.

PowerShell 5.1:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

다른 터미널에서 `npm.cmd test`(단위 테스트), `npm.cmd run build`(타입 검사 + 빌드)를 실행합니다. 개발 서버는 `http://localhost:5173/`에서 열립니다.

Git Bash:

```bash
cd frontend
npm ci
npm run dev
```

다른 터미널에서 `npm test`, `npm run build`를 실행합니다.

### 6-3. 배포 형태로 실행 (실행형 JAR)

`bootJar`가 프론트 빌드를 포함해 JAR를 만듭니다. 환경 변수는 2절과 같고, 매핑·이력·로그는 아래처럼 인자로 지정합니다. 스텁(1절)을 먼저 띄웁니다.

PowerShell 5.1 (환경 변수 `CPI_*`는 2절 PowerShell 예시대로 먼저 설정):

```powershell
.\gradlew.bat bootJar
& "<JDK25 경로>\bin\java.exe" -jar build\libs\cpi-transport-tool-0.0.1-SNAPSHOT.jar --cpi.transport.mapping-file=examples/mapping-example.yml --cpi.transport.history.file=build/local-stubs/history.jsonl --logging.file.name=build/local-stubs/app.log
```

Git Bash (환경 변수 `CPI_*`는 2절 Git Bash 예시대로 먼저 설정):

```bash
./gradlew bootJar
<JDK25 경로>/bin/java -jar build/libs/cpi-transport-tool-0.0.1-SNAPSHOT.jar --cpi.transport.mapping-file=examples/mapping-example.yml --cpi.transport.history.file=build/local-stubs/history.jsonl --logging.file.name=build/local-stubs/app.log
```

브라우저로 `http://localhost:8080/`을 엽니다. 정지는 5절을 따릅니다.

### 6-4. bootRun으로 화면 보기

`./gradlew bootRun`은 `frontend/dist`가 있을 때만 화면을 제공하고, 없으면 API만 제공합니다. 화면이 필요하면 먼저 프론트를 빌드합니다.

PowerShell 5.1:

```powershell
.\gradlew.bat frontendBuild
.\gradlew.bat bootRun
```

Git Bash:

```bash
./gradlew frontendBuild
./gradlew bootRun
```
