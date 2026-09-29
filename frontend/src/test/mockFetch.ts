import { vi } from 'vitest';

type Handler = (init?: RequestInit) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** "METHOD /path" → 핸들러. 등록되지 않은 요청은 실제 네트워크 대신 throw 한다(REQ-010 AC-2). */
export function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const h = routes[key];
    if (!h) throw new Error(`mock 없음: ${key}`);
    return h(init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const PACKAGES = [
  { id: 'PkgTransportDemo', name: 'Transport Demo', version: '1.0.0' },
  { id: 'PkgFaultDemo', name: 'Fault Demo', version: '1.0.0' },
  { id: 'PkgNotInPrd', name: 'Not In PRD', version: '1.0.0' },
];

export const ARTIFACTS = [
  { id: 'IF_Order_Sync', name: 'Order Sync', version: '1.0.3' },
  { id: 'IF_Customer_Push', name: 'Customer Push', version: '2.1.0' },
];
