import { useRef } from 'react';
import { getVersion } from '../../api/client';
import type { VersionResponse } from '../../api/types';
import { useRemote } from '../../lib/useRemote';

export function VersionFooter() {
  // StrictMode에서 effect가 다시 실행되어도 같은 요청을 사용한다.
  const request = useRef<Promise<VersionResponse> | null>(null);
  const { state } = useRemote(() => request.current ??= getVersion(), 'version');

  let label = '';
  if (state.status === 'ok') {
    const { version, commit } = state.data;
    label = `${version === 'dev' ? version : `v${version}`} · ${commit}`;
  } else if (state.status === 'error') {
    label = '버전 정보 없음';
  }

  return (
    <footer className="mx-auto min-h-8 w-full max-w-[1200px] px-4 pb-4 text-xs text-ink-secondary wrap-anywhere md:px-6">
      {label}
    </footer>
  );
}
