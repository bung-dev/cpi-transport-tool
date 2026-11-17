"""E2E용 앱 실행기. 스텁 대상 더미 자격증명만 쓴다(실제 테넌트 접속 없음).

  python e2e/tools/app.py --label ro [--read-only true|false|default] [--tenants env|unset]

빌드된 JAR(build/libs/*-SNAPSHOT.jar, bootJar)을 앞에서 실행하고 끝날 때까지 기다린다.
워크플로우 검사 스크립트(.claude/wf3/check.py)가 서비스로 띄우고 끝나면 멈춘다.
실행할 때마다 build/e2e-app/<label>/을 비우고 새 저장소 키·저장 파일·이력 파일을 만든다.
  로그: build/e2e-app/<label>/app-<label>.log   이력: history-<label>.jsonl  (lib/qa.ts의 QA_APP_LOG 규칙)
Java: 환경 변수 E2E_JAVA(없으면 PATH의 java). 앱은 Java 25 toolchain으로 빌드된다.
"""
import argparse
import base64
import glob
import os
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PORTS = {"dev": 18081, "prd": 18082}
STUB_DEPLOY_ARGS = ["--cpi.transport.deploy.poll-interval=1s", "--cpi.transport.deploy.timeout=6s"]


def env_vars(name):
    e = name.upper()
    url = f"http://localhost:{PORTS[name]}"
    return {f"CPI_{e}_API_URL": url, f"CPI_{e}_TOKEN_URL": url + "/oauth/token",
            f"CPI_{e}_CLIENT_ID": f"dummy-{name}-client", f"CPI_{e}_CLIENT_SECRET": f"dummy-{name}-secret"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--read-only", default="default", choices=["true", "false", "default"])
    ap.add_argument("--tenants", default="env", choices=["env", "unset"])
    a = ap.parse_args()
    jars = [j for j in glob.glob(str(ROOT / "build" / "libs" / "*-SNAPSHOT.jar")) if not j.endswith("-plain.jar")]
    if not jars:
        sys.exit("JAR이 없다. 먼저 gradlew bootJar")
    work = ROOT / "build" / "e2e-app" / a.label
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("CPI_")}
    if a.tenants == "env":
        env.update(env_vars("dev"))
        env.update(env_vars("prd"))
    env["CPI_TENANT_STORE_KEY"] = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
    if a.read_only != "default":
        env["CPI_TRANSPORT_READ_ONLY"] = a.read_only
    java = os.environ.get("E2E_JAVA") or shutil.which("java") or "java"
    args = [java, "-jar", jars[0],
            f"--cpi.tenants.store-file={work / 'tenants.enc'}",
            f"--cpi.transport.history.file={work / f'history-{a.label}.jsonl'}",
            f"--cpi.templates.store-file={work / 'templates.json'}",
            f"--cpi.audit.file={work / 'audit.jsonl'}",
            f"--logging.file.name={work / f'app-{a.label}.log'}", *STUB_DEPLOY_ARGS]
    print(f"E2E 앱 시작: label={a.label} read_only={a.read_only} tenants={a.tenants}", flush=True)
    sys.exit(subprocess.call(args, cwd=str(ROOT), env=env))


if __name__ == "__main__":
    main()
