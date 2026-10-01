import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
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
    // AI-NOTE: 포커스 복귀는 preventScroll로 한다. 닫히는 순간 결과가 나타나므로, 복귀가 화면을 스크롤하면 결과 영역의 시작이 뷰포트 밖으로 밀린다 (근거: REQ-105 AC-7, REQ-107 AC-5, D-018 ③)
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => opener?.focus({ preventScroll: true });
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

  // AI-NOTE: 대화상자는 document.body에 포털로 그린다. 폭 1024px 이상에서 실행 카드 열이 sticky라 자체 쌓임 맥락을 만들고, 그 안의 z-10은 뒤따르는 결과 카드(relative)보다 위로 올라가지 못한다 (근거: REQ-107 AC-4, 개발 중 브라우저 확인)
  return createPortal(
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
    </div>,
    document.body,
  );
}
