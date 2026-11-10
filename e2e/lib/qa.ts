// QA 공용 도우미 (run 20261020-defect-fix, slice-01 스텁 묶음).
// 직전 run(20261007-real-transport)의 lib/qa.ts를 복사해 이 run에 맞게 줄였다. 직전 run 파일은 수정하지 않았다.
// - API 호출은 http://localhost:8080 으로만 보낸다. 스텁 조작은 localhost:18081/18082 의 /__admin 중 허용된 것만 쓴다
//   (requests, requests/find, requests/count, mappings 추가·id 삭제, scenarios/reset).
// - 산출물은 process.env.QA_ARTIFACT_DIR 아래에만 쓴다.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const APP = 'http://localhost:8080';
export const STUB: Record<number, string> = { 18081: 'http://localhost:18081', 18082: 'http://localhost:18082' };
export const ART = (): string => process.env.QA_ARTIFACT_DIR as string;

export interface Res {
  status: number;
  text: string;
  json: any;
  headers: Record<string, string>;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function parse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function wrap(r: { status(): number; text(): Promise<string>; headers(): Record<string, string> }): Promise<Res> {
  const text = await r.text();
  return { status: r.status(), text, json: parse(text), headers: r.headers() };
}

export async function call(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  extra: { headers?: Record<string, string>; timeout?: number } = {},
): Promise<Res> {
  const opts: any = { headers: extra.headers ?? {}, timeout: extra.timeout ?? 60000, failOnStatusCode: false };
  if (body !== undefined) opts.data = body;
  const r = await request.fetch(url, { method, ...opts });
  return wrap(r);
}

export const app = (request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', p: string, body?: unknown) =>
  call(request, method, APP + p, body);

// ---------------------------------------------------------------- 서비스 키 (run_instructions 3-4)
export function key(port: 18081 | 18082, host = '127.0.0.1', clientid?: string, clientsecret?: string): any {
  const dev = port === 18081;
  return {
    oauth: {
      url: `http://${host}:${port}`,
      tokenurl: `http://${host}:${port}/oauth/token`,
      clientid: clientid ?? (dev ? 'dummy-dev-client' : 'dummy-prd-client'),
      clientsecret: clientsecret ?? (dev ? 'dummy-dev-secret' : 'dummy-prd-secret'),
      createdate: '2026-01-01T00:00:00Z',
    },
  };
}

// ---------------------------------------------------------------- 등록·임시 매핑 추적
const created: string[] = [];
const tempMaps: Array<{ port: number; id: string }> = [];

export async function registerTenant(request: APIRequestContext, name: string, serviceKey: unknown, keep = false): Promise<string> {
  const r = await app(request, 'POST', '/tenants', { name, serviceKey });
  if (r.status !== 201) throw new Error(`등록 실패 name=${name} status=${r.status} error=${r.json?.error} message=${r.json?.message}`);
  if (!keep) created.push(r.json.id);
  return r.json.id as string;
}
export async function tenantList(request: APIRequestContext): Promise<any[]> {
  const r = await app(request, 'GET', '/tenants');
  expect(r.status, 'GET /tenants 상태').toBe(200);
  return r.json.tenants as any[];
}
export async function findTenant(request: APIRequestContext, name: string): Promise<any | undefined> {
  return (await tenantList(request)).find((t) => t.name === name);
}
export async function dropTenant(request: APIRequestContext, id: string): Promise<Res> {
  const r = await app(request, 'DELETE', `/tenants/${encodeURIComponent(id)}`);
  const i = created.indexOf(id);
  if (i >= 0) created.splice(i, 1);
  return r;
}
export const track = (id: string): void => {
  created.push(id);
};
export async function cleanup(request: APIRequestContext): Promise<void> {
  for (const m of tempMaps.splice(0)) await call(request, 'DELETE', `${STUB[m.port]}/__admin/mappings/${m.id}`).catch(() => undefined);
  for (const id of created.splice(0)) await app(request, 'DELETE', `/tenants/${encodeURIComponent(id)}`).catch(() => undefined);
}
export async function dropTrackedMaps(request: APIRequestContext): Promise<void> {
  for (const m of tempMaps.splice(0)) await call(request, 'DELETE', `${STUB[m.port]}/__admin/mappings/${m.id}`).catch(() => undefined);
}

// ---------------------------------------------------------------- 스텁 조작 (H-3, H-4)
async function readRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!/socket hang up|ECONNRESET/.test(String(e))) throw e;
    return fn();
  }
}
export async function stubFind(request: APIRequestContext, port: number, method: string, urlPathPattern: string): Promise<any[]> {
  const r = await readRetry(() => call(request, 'POST', `${STUB[port]}/__admin/requests/find`, { method, urlPathPattern }));
  if (r.status !== 200) throw new Error(`스텁 ${port} find 실패 ${r.status}`);
  return r.json.requests as any[];
}
export async function stubCount(request: APIRequestContext, port: number, method = 'ANY', urlPathPattern = '.*'): Promise<number> {
  const r = await readRetry(() => call(request, 'POST', `${STUB[port]}/__admin/requests/count`, { method, urlPathPattern }));
  if (r.status !== 200) throw new Error(`스텁 ${port} count 실패 ${r.status}`);
  return r.json.count as number;
}
/** 토큰 외 쓰기 요청(PUT/DELETE/PATCH, 그리고 /oauth/token 이 아닌 POST) 수 */
export async function writeCount(request: APIRequestContext, port: number): Promise<number> {
  let n = 0;
  for (const m of ['PUT', 'DELETE', 'PATCH']) n += await stubCount(request, port, m);
  const posts = await stubFind(request, port, 'POST', '.*');
  n += posts.filter((p) => !String(p.url).startsWith('/oauth/token')).length;
  return n;
}
/** H-3: 두 스텁의 요청 기록 삭제와 시나리오 reset (전체 reset 계열은 쓰지 않는다) */
export async function stubReset(request: APIRequestContext): Promise<void> {
  for (const port of [18081, 18082]) {
    const a = await call(request, 'DELETE', `${STUB[port]}/__admin/requests`);
    const b = await call(request, 'POST', `${STUB[port]}/__admin/scenarios/reset`);
    if (a.status >= 300 || b.status >= 300) throw new Error(`스텁 ${port} 초기화 실패 ${a.status}/${b.status}`);
  }
}
export async function addMap(request: APIRequestContext, port: number, mapping: unknown): Promise<string> {
  const r = await call(request, 'POST', `${STUB[port]}/__admin/mappings`, mapping);
  if (r.status !== 201 && r.status !== 200) throw new Error(`임시 매핑 추가 실패 ${port} ${r.status} ${r.text.slice(0, 200)}`);
  tempMaps.push({ port, id: r.json.id });
  return r.json.id as string;
}
export async function delMap(request: APIRequestContext, port: number, id: string): Promise<void> {
  await call(request, 'DELETE', `${STUB[port]}/__admin/mappings/${id}`);
  const i = tempMaps.findIndex((m) => m.port === port && m.id === id);
  if (i >= 0) tempMaps.splice(i, 1);
}
export async function mappingCount(request: APIRequestContext, port: number): Promise<number> {
  const r = await call(request, 'GET', `${STUB[port]}/__admin/mappings`);
  return (r.json?.mappings ?? []).length as number;
}

/** 요청 기록 항목에서 헤더 값(대소문자 무시)을 읽는다. 없으면 null, 여러 값이면 배열. */
export function headerOf(req: any, name: string): string | string[] | null {
  const h = req?.headers ?? {};
  for (const k of Object.keys(h)) if (k.toLowerCase() === name.toLowerCase()) return h[k];
  return null;
}
export const acceptOf = (req: any) => headerOf(req, 'Accept');

// ---------------------------------------------------------------- 앱 보조
export async function historyOf(request: APIRequestContext): Promise<any[]> {
  const r = await app(request, 'GET', '/transport/history');
  expect(r.status, 'GET /transport/history 상태').toBe(200);
  return r.json as any[];
}
export function historyFile(): string {
  const log = process.env.QA_APP_LOG as string;
  return log.replace(/app-([^\\/]+)\.log$/, 'history-$1.jsonl');
}

// ---------------------------------------------------------------- 증거 기록
const records: Record<string, any> = {};
export function R(qa: string): any {
  return (records[qa] ??= {});
}
export function flush(): void {
  const dir = ART();
  fs.mkdirSync(dir, { recursive: true });
  for (const [qa, v] of Object.entries(records)) fs.writeFileSync(path.join(dir, `${qa}.json`), JSON.stringify(v, null, 2), 'utf8');
}
export async function after(request: APIRequestContext): Promise<void> {
  await cleanup(request);
  flush();
}
export async function shot(page: Page, name: string, fullPage = true): Promise<void> {
  fs.mkdirSync(ART(), { recursive: true });
  await page.screenshot({ path: path.join(ART(), `${name}.png`), fullPage });
}
export function writeText(name: string, text: string): void {
  fs.mkdirSync(ART(), { recursive: true });
  fs.writeFileSync(path.join(ART(), name), text, 'utf8');
}

/** 번들 다운로드 Accept 기준값 (REQ-311 AC-1) */
export const BUNDLE_ACCEPT = 'application/zip, application/octet-stream, */*';
export const JSON_ACCEPT = 'application/json';
