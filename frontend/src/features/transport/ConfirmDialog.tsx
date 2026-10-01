import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';

interface Props {
  packageId: string;
  /** 선택한 아티팩트 수. 0이면 패키지 전체 */
  artifactCount: number;
  deploy: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** 연 버튼이 화면에서 없어졌을 때 포커스를 보낼 요소(실행 카드의 실행 버튼) */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}

// REQ-005 AC-3, REQ-009 AC-1: 실제 이관 확인 대화상자(role=dialog, aria-modal).
export function ConfirmDialog({ packageId, artifactCount, deploy, busy, onConfirm, onCancel, fallbackFocusRef }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // 열기 전에 포커스가 있던 요소(이관 실행 버튼)를 기억했다가 닫힐 때 돌려준다.
    // AI-NOTE: 포커스 복귀는 preventScroll로 한다. 닫히는 순간 결과가 나타나므로, 복귀가 화면을 스크롤하면 결과 영역의 시작이 뷰포트 밖으로 밀린다 (근거: REQ-105 AC-7, REQ-107 AC-5, D-018 ③)
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      // 연 버튼이 그대로 있으면 그 버튼으로, 없어졌으면("이 구성으로 실제 이관"으로 열어 실제 이관 결과로 바뀐 경우) 실행 카드의 실행 버튼으로 돌려준다.
      // 정리 함수는 DOM 갱신 뒤에 돌므로 opener.isConnected가 최종 상태를 말해 준다. 둘 다 스크롤하지 않는다(REQ-107 AC-5, D-018 ③).
      const target = opener?.isConnected ? opener : fallbackFocusRef?.current;
      target?.focus({ preventScroll: true });
    };
    // 마운트·언마운트 때만 돈다. fallbackFocusRef는 ref 객체라 안정적이다.
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
    <div className="fixed inset-0 z-10 flex animate-dialog-fade items-center justify-center bg-scrim p-4" onKeyDown={onKeyDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[440px] min-w-0 animate-dialog-pop rounded-xl bg-canvas p-6 shadow-overlay"
      >
        <h2 id={titleId} className="mb-3 text-lg font-semibold">
          실제 이관 확인
        </h2>
        <Callout tone="warning">PRD에 업로드합니다</Callout>
        <dl className="mt-3.5 grid gap-2">
          <SummaryRow label="대상 패키지" valueClass="font-mono text-[13px]">
            {packageId}
          </SummaryRow>
          <SummaryRow label="아티팩트 수">{artifactCount === 0 ? '전체' : artifactCount}</SummaryRow>
          <SummaryRow label="배포">{deploy ? '예' : '아니오'}</SummaryRow>
        </dl>
        {/* 폭 640px 미만에서는 버튼이 세로로 쌓이고 DOM 순서(취소 → 실행)를 뒤집어 "실행"이 위에 온다 */}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} className="w-full sm:w-auto" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button variant="primary" className="w-full sm:w-auto" onClick={onConfirm} disabled={busy}>
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

function SummaryRow({ label, valueClass = '', children }: { label: string; valueClass?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <dt className="pt-px text-xs text-ink-tertiary">{label}</dt>
      <dd className={`break-all ${valueClass}`}>{children}</dd>
    </div>
  );
}
