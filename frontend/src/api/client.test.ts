import { afterEach, describe, expect, it, vi } from 'vitest';
import { getArtifacts, getHistory, getPackages, postTransport } from './client';
import { toApiError, type ApiError } from './errors';

function mockFetch(impl: () => Promise<Response>) {
  const fn = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => impl());
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return toApiError(e);
  }
  throw new Error('rejected 되어야 한다');
}

afterEach(() => vi.unstubAllGlobals());

describe('오류 정규화', () => {
  it.each([
    [400, 'INVALID_REQUEST', '요청 값이 올바르지 않습니다', 'Invalid request'],
    [503, 'ENVIRONMENT_NOT_CONFIGURED', '서버 연결 설정이 없습니다', 'CPI_DEV_API_URL, CPI_DEV_CLIENT_ID'],
    [422, 'MAPPING_INVALID', '매핑 파일이 올바르지 않습니다', 'mapping broken at line 1'],
    [404, 'PACKAGE_NOT_FOUND', '패키지를 찾을 수 없습니다', 'Package not found'],
    [502, 'CPI_UNAVAILABLE', 'CPI에 연결할 수 없습니다', 'CPI unavailable'],
  ])('REQ-008 AC-1: %i %s 는 한국어 제목과 서버 message 원문', async (status, code, title, message) => {
    mockFetch(async () => new Response(JSON.stringify({ error: code, message }), { status }));
    expect(await failure(getPackages())).toEqual({ title, message });
  });

  it('REQ-008 AC-2: JSON이 아닌 본문(HTML 500)은 알 수 없는 오류(HTTP 500)', async () => {
    mockFetch(async () => new Response('<html>boom</html>', { status: 500, headers: { 'Content-Type': 'text/html' } }));
    expect(await failure(getPackages())).toEqual({ title: '알 수 없는 오류(HTTP 500)' });
  });

  it('REQ-008 AC-2: 모르는 코드(418 TEAPOT)는 알 수 없는 오류(HTTP 418)', async () => {
    mockFetch(async () => new Response(JSON.stringify({ error: 'TEAPOT', message: 'x' }), { status: 418 }));
    expect(await failure(getHistory())).toEqual({ title: '알 수 없는 오류(HTTP 418)' });
  });

  it('REQ-008 AC-2: 빈 본문(502)과 message가 문자열이 아닌 본문도 알 수 없는 오류', async () => {
    mockFetch(async () => new Response('', { status: 502 }));
    expect(await failure(getPackages())).toEqual({ title: '알 수 없는 오류(HTTP 502)' });
    mockFetch(async () => new Response(JSON.stringify({ error: 'INVALID_REQUEST', message: 1 }), { status: 400 }));
    expect(await failure(getPackages())).toEqual({ title: '알 수 없는 오류(HTTP 400)' });
  });

  it('REQ-008 AC-2: 성공 응답의 JSON 파싱 실패는 알 수 없는 오류(HTTP 200)', async () => {
    mockFetch(async () => new Response('not json', { status: 200 }));
    expect(await failure(getPackages())).toEqual({ title: '알 수 없는 오류(HTTP 200)' });
  });

  it('REQ-008 AC-2: fetch가 reject되면 서버에 연결할 수 없습니다', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await failure(getPackages())).toEqual({ title: '서버에 연결할 수 없습니다' });
  });
});

describe('API 클라이언트 URL', () => {
  it('REQ-002 AC-4: 호출 URL은 모두 /로 시작하는 상대 경로이고 packageId는 인코딩된다', async () => {
    const fn = mockFetch(async () => new Response('[]', { status: 200 }));
    await getPackages();
    await getArtifacts('Pkg A/b?c');
    await getHistory();
    await postTransport({ packageId: 'P', dryRun: true, deploy: false });
    const urls = fn.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      '/packages',
      '/packages/Pkg%20A%2Fb%3Fc/artifacts',
      '/transport/history',
      '/transport',
    ]);
    expect(urls.every((u) => u.startsWith('/') && !u.startsWith('//'))).toBe(true);
    const post = fn.mock.calls[3][1] as RequestInit;
    expect(post.method).toBe('POST');
    expect(JSON.parse(post.body as string)).toEqual({ packageId: 'P', dryRun: true, deploy: false });
  });
});
