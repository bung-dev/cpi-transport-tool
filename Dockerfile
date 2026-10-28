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
RUN ./gradlew --no-daemon bootJar -x frontendInstall -x frontendBuild

FROM eclipse-temurin:25-jre
RUN useradd --create-home app \
    && mkdir -p /home/app/.cpi-transport-tool \
    && chown app:app /home/app/.cpi-transport-tool
COPY --from=backend /src/build/libs/cpi-transport-tool-0.0.1-SNAPSHOT.jar /app/app.jar
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
