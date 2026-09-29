import { ApiRequestError, networkError, parseErrorBody, unknownError } from './errors';
import type { ArtifactSummary, TransportRequest, TransportResponse } from './types';

// REQ-002 AC-4, REQ-012 AC-2: 같은 출처의 상대 경로만 쓴다. 기준 URL이나 환경 변수 값은 없다.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiRequestError(networkError());
  }
  if (!res.ok) {
    let text = '';
    try {
      text = await res.text();
    } catch {
      // 본문을 못 읽어도 상태 코드로 알 수 없는 오류를 만든다.
    }
    throw new ApiRequestError(parseErrorBody(res.status, text));
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiRequestError(unknownError(res.status));
  }
}

export function getPackages(): Promise<ArtifactSummary[]> {
  return request('/packages');
}

export function getArtifacts(packageId: string): Promise<ArtifactSummary[]> {
  return request(`/packages/${encodeURIComponent(packageId)}/artifacts`);
}

export function postTransport(body: TransportRequest): Promise<TransportResponse> {
  return request('/transport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getHistory(): Promise<TransportResponse[]> {
  return request('/transport/history');
}
