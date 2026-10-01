import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';

interface Props {
  packageId: string;
  /** 선택한 아티팩트 수. 0이면 패키지 전체 */
  artifactCount: number;
  deploy: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// REQ-005 AC-3, REQ-009 AC-1: 실제 이관 확인 대화상자(role=dialog, aria-modal).
export function ConfirmDialog({ packageId, artifactCount, deploy, busy, onConfirm, onCancel }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // 열기 전에 포커스가 있던 요소(이관 실행 버튼)를 기억했다가 닫힐 때 돌려준다.
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => opener?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (e.key !== 'Tab') return;
    // Tab 순환은 대화상자 안에서만 한다.
    const focusables = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-scrim p-4" onKeyDown={onKeyDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md min-w-0 rounded-lg border border-hairline bg-canvas p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          실제 이관 확인
        </h2>
        <div className="mt-3 flex flex-col gap-1 text-sm break-all">
          <p>
            대상 패키지: <span className="font-mono">{packageId}</span>
          </p>
          <p>아티팩트 수: {artifactCount === 0 ? '전체' : artifactCount}</p>
          <p>배포: {deploy ? '예' : '아니오'}</p>
          <p className="mt-2 font-medium">PRD에 업로드합니다</p>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            실행
          </Button>
        </div>
        {busy && (
          <p role="status" className="mt-3 text-sm text-ink-secondary">
            이관 실행 중
          </p>
        )}
      </div>
    </div>
  );
}
