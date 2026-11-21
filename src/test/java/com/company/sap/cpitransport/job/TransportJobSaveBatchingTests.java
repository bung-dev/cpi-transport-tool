package com.company.sap.cpitransport.job;

import com.company.sap.cpitransport.config.TransportProperties;
import com.company.sap.cpitransport.model.*;
import com.company.sap.cpitransport.service.TransportHistoryStore;
import com.company.sap.cpitransport.service.TransportService.Stage;
import java.nio.file.*;
import java.time.Clock;
import java.time.Duration;
import java.util.*;
import java.util.stream.IntStream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

/**
 * 20261121-perf-retry S2, REQ-905 작업 상태 저장 묶기:
 * 진행 중 변경은 jobs.json에 최대 1초에 한 번(작업 잠금 밖, 호출한 스레드에서 쓰지 않음),
 * 작업 시작·끝·취소 요청은 즉시 저장. 조회(store.require)는 저장 주기와 무관하게 메모리의 최신 상태.
 * 테스트 계약: TransportJobStore.writeCount()(패키지 공개) = 지금까지 jobs.json을 쓴 횟수.
 */
class TransportJobSaveBatchingTests {
    @TempDir Path directory;
    final JsonMapper json = JsonMapper.builder().build();
    final Clock clock = Clock.systemUTC();
    static final int ITEMS = 20;

    TransportJobStore store(Path file) {
        var history = new TransportHistoryStore(new TransportProperties(new TransportProperties.History(directory.resolve("history.jsonl")),
                new TransportProperties.Retry(3, Duration.ofSeconds(1)), new TransportProperties.Deploy(Duration.ofSeconds(1), Duration.ofSeconds(3)),
                List.of("password")), json);
        return new TransportJobStore(file, json, history, clock);
    }

    TransportRun run() {
        var request = new TransportRequest("PKG", IntStream.range(0, ITEMS).mapToObj(i -> "IF_" + i).toList(), false, false);
        var items = IntStream.range(0, ITEMS).mapToObj(i -> new TransportRun.Item("PKG", "IF_" + i, Stage.WAITING, null)).toList();
        return new TransportRun(clock, request, List.of(new TransportPackage("PKG", null, TargetPackageStatus.EXISTING)), items, null, null);
    }

    JsonNode saved(Path file, String jobId) throws Exception {
        for (JsonNode job : json.readTree(Files.readAllBytes(file))) {
            if (job.at("/progress/jobId").asString().equals(jobId)) return job;
        }
        return null;
    }

    @Test
    @DisplayName("REQ-905: starting a job writes jobs.json immediately")
    void req905_startImmediate() throws Exception {
        var file = directory.resolve("start/jobs.json");
        var store = store(file);
        var run = run();
        run.persistTo(store::save);
        assertThat(store.writeCount()).isEqualTo(1);
        assertThat(saved(file, run.id()).at("/progress/status").asString()).isEqualTo("RUNNING");
    }

    @Test
    @DisplayName("REQ-905: a burst of stage changes is written at most once per second and not on the calling thread, while reads see the latest state at once")
    void req905_burstBatched() throws Exception {
        var file = directory.resolve("burst/jobs.json");
        var store = store(file);
        var run = run();
        run.persistTo(store::save);
        int afterStart = store.writeCount();
        long begin = System.nanoTime();
        for (int i = 0; i < ITEMS; i++) {
            run.stage(i, Stage.DOWNLOAD);
            run.stage(i, Stage.TARGET);
            run.stage(i, Stage.UPLOAD);
        }
        long elapsedMillis = (System.nanoTime() - begin) / 1_000_000;
        assertThat(elapsedMillis).as("60 stage changes should not wait for file writes").isLessThan(1000);
        // 호출한 스레드는 파일을 쓰지 않는다: 60번 바뀌어도 바로 늘어난 쓰기는 없다(묶음 쓰기는 1초 뒤 배경에서).
        assertThat(store.writeCount() - afterStart).isEqualTo(0);
        // 조회는 메모리의 최신 상태
        assertThat(store.require(run.id()).items()).extracting(TransportRun.Item::stage).containsOnly(Stage.UPLOAD);

        // 1초 안팎 뒤에 한 번 써서 파일에도 최신 단계가 남는다
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (store.writeCount() == afterStart && System.nanoTime() < deadline) Thread.sleep(20);
        assertThat(store.writeCount() - afterStart).isEqualTo(1);
        var items = saved(file, run.id()).at("/progress/items");
        for (JsonNode item : items) assertThat(item.get("stage").asString()).isEqualTo("UPLOAD");
        Thread.sleep(1500);
        assertThat(store.writeCount() - afterStart).as("no further writes without changes").isEqualTo(1);
    }

    @Test
    @DisplayName("REQ-905: the terminal state is written immediately without waiting for the batch")
    void req905_terminalImmediate() throws Exception {
        var file = directory.resolve("terminal/jobs.json");
        var store = store(file);
        var run = run();
        run.persistTo(store::save);
        for (int i = 0; i < ITEMS; i++) {
            run.stage(i, Stage.DOWNLOAD);
            run.completed(i, new ArtifactResult("PKG", "IF_" + i, null, TransportAction.UPDATED, List.of(), DeployStatus.NOT_REQUESTED, null));
        }
        // finish가 돌아온 직후 파일에 끝 상태가 있다
        var job = saved(file, run.id());
        assertThat(job.at("/progress/status").asString()).isEqualTo("COMPLETED");
        assertThat(job.at("/progress/finishedAt").isNull()).isFalse();
        assertThat(store.require(run.id()).status()).isEqualTo(JobStatus.COMPLETED);
    }

    @Test
    @DisplayName("REQ-905: a cancel request is written immediately")
    void req905_cancelImmediate() throws Exception {
        var file = directory.resolve("cancel/jobs.json");
        var store = store(file);
        var run = run();
        run.persistTo(store::save);
        run.stage(0, Stage.DOWNLOAD);
        int before = store.writeCount();
        run.cancel();
        assertThat(store.writeCount()).isEqualTo(before + 1);
        assertThat(saved(file, run.id()).at("/progress/items/0/stage").asString()).isEqualTo("DOWNLOAD");
    }

    @Test
    @DisplayName("REQ-905 failure: when jobs.json cannot be written the job keeps running and reads still see the latest state")
    void req905_writeFailure() throws Exception {
        var file = directory.resolve("blocked/jobs.json");
        Files.createDirectories(file); // 파일 자리에 폴더가 있어 쓸 수 없다
        var store = store(file);
        var run = run();
        run.persistTo(store::save);
        run.stage(0, Stage.DOWNLOAD);
        run.completed(0, new ArtifactResult("PKG", "IF_0", null, TransportAction.UPDATED, List.of(), DeployStatus.NOT_REQUESTED, null));
        assertThat(store.require(run.id()).items().getFirst().stage()).isEqualTo(Stage.DONE);
        assertThat(store.require(run.id()).done()).isEqualTo(1);
        assertThat(run.snapshot().status()).isEqualTo(JobStatus.RUNNING);
    }
}
