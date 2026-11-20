# syntax=docker/dockerfile:1
# 실제 테넌트 사용을 위한 앱 이미지. 스텁은 넣지 않는다(테스트 전용).

FROM node:24-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM eclipse-temurin:25-jdk AS backend
WORKDIR /src
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
RUN ./gradlew --no-daemon --quiet dependencies > /dev/null
COPY src/main src/main
COPY --from=frontend /src/frontend/dist frontend/dist
# 프론트는 위 단계에서 빌드했으므로 Gradle의 npm 작업은 건너뛴다.
# 커밋은 빌드 정보에 넣으려고 .git 중 HEAD·refs/heads·packed-refs만 잠깐 빌려 읽는다(.dockerignore가 나머지를 뺀다).
# .git이 없거나(저장소 밖) 파일이면(git worktree) 커밋은 unknown이고 빌드는 그대로 된다. jar 이름(버전)은 적지 않는다.
RUN --mount=type=bind,target=/ctx \
    if [ -d /ctx/.git ]; then cp -r /ctx/.git .git; fi \
    && ./gradlew --no-daemon bootJar -x frontendInstall -x frontendBuild \
    && cp build/libs/cpi-transport-tool-*.jar /src/app.jar

FROM eclipse-temurin:25-jre
RUN useradd --create-home app \
    && mkdir -p /home/app/.cpi-transport-tool \
    && chown app:app /home/app/.cpi-transport-tool
COPY --from=backend /src/app.jar /app/app.jar
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
