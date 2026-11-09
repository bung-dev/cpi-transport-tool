// 브라우저 E2E 설정. 앱(http://localhost:8080)과 로컬 스텁(18081/18082)은 미리 떠 있어야 한다.
// 묶음(specs/<이름>)마다 앱 구성이 다르다. README.md의 묶음 표와 tools/app.py를 본다.
'use strict';
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const artifactDir = process.env.QA_ARTIFACT_DIR || path.join(__dirname, '.artifacts', 'manual');
process.env.QA_ARTIFACT_DIR = artifactDir;

module.exports = defineConfig({
  testDir: path.join(__dirname, 'specs'),
  outputDir: path.join(artifactDir, 'pw-output'),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 120000,
  reporter: [['list'], ['json', { outputFile: path.join(artifactDir, 'pw-report.json') }]],
  use: {
    baseURL: 'http://localhost:8080',
    channel: process.env.PW_CHANNEL || 'msedge',
    headless: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    viewport: { width: 1280, height: 900 },
    timezoneId: 'Asia/Seoul',
    locale: 'ko-KR',
  },
});
