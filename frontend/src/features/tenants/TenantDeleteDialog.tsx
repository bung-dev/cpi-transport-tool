import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui/Button';
import { ErrorAlert } from '../../components/ErrorAlert';
import type { ApiError } from '../../api/errors';
export function TenantDeleteDialog({ name, busy, error, onCancel, onConfirm }: {
  name: string; busy: boolean; error?: ApiError; onCancel: () => void; onConfirm: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  function keyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onCancel(); }
    if (e.key !== 'Tab') return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  return createPortal(<div className="fixed inset-0 z-10 flex items-center justify-center bg-scrim p-4" onKeyDown={keyDown}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-[440px] min-w-0 rounded-xl bg-canvas p-6 shadow-overlay">
      <h2 id={titleId} className="mb-3 text-lg font-semibold">테넌트 삭제 확인</h2>
      <p className="break-all">{name}의 앱 등록을 삭제합니다.</p>
      {error && <ErrorAlert error={error} />}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button ref={cancelRef} disabled={busy} onClick={onCancel}>취소</Button>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>삭제</Button>
      </div>
      {busy && <p role="status">삭제 중</p>}
    </div>
  </div>, document.body);
}
