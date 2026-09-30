import { useCallback, useEffect, useState } from 'react';
import { toApiError, type ApiError } from '../api/errors';

export type Remote<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; error: ApiError };

/**
 * key가 바뀌거나 retry가 호출될 때마다 load를 실행한다.
 * 응답 경합: 이전 요청의 응답은 cleanup 플래그로 버려서 마지막 요청의 응답만 반영한다.
 * 반환 상태는 현재 key의 것만 노출한다(key가 바뀐 직후 한 번의 렌더에서 이전 key의 데이터를 보이지 않음).
 */
export function useRemote<T>(load: () => Promise<T>, key: string): { state: Remote<T>; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; value: Remote<T> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setResult({ key, attempt, value: { status: 'ok', data } });
      },
      (e: unknown) => {
        if (!cancelled) setResult({ key, attempt, value: { status: 'error', error: toApiError(e) } });
      },
    );
    return () => {
      cancelled = true;
    };
    // load는 key로 식별한다(호출마다 새 함수가 만들어져도 재조회하지 않는다).
  }, [key, attempt]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt((a) => a + 1);
  }, []);

  const state: Remote<T> =
    result && result.key === key && result.attempt === attempt ? result.value : { status: 'loading' };
  return { state, retry };
}
