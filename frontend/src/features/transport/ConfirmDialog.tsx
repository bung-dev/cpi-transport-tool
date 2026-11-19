import { getTargetPackageStatus } from '../../api/client';
import type { TransportPackage } from '../../api/types';
import { useRemote } from '../../lib/useRemote';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Switch } from '../../components/ui/Switch';

interface Props {
  targetName?: string;
  packages: TransportPackage[];
  targetTenantId: string;
  /** 미리보기 결과의 전체 아티팩트 수 */
  artifactCount: number;
  deploy: boolean;
  /** 주면 확인창 안에 배포 스위치를 둔다(마법사). 없으면 배포 값을 요약으로만 보인다. */
  onDeployChange?: (deploy: boolean) => void;
  /** "<원본 이름> → <대상 이름>" */
  routeText?: string;
  busy: boolean;
  onConfirm: (createPackages: string[]) => void;
  onCancel: () => void;
  /** 연 버튼이 화면에서 없어졌을 때 포커스를 보낼 요소(실행 카드의 실행 버튼) */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}

// REQ-005 AC-3, REQ-009 AC-1: 실제 이관 확인 대화상자(role=dialog, aria-modal).
export function ConfirmDialog({ packages, targetTenantId, artifactCount, deploy, onDeployChange, routeText, busy, onConfirm, onCancel, fallbackFocusRef, targetName = 'PRD' }: Props) {
  const titleId = useId();
  const ids = packages.map(p => p.packageId);
  const { state, retry } = useRemote(() => getTargetPackageStatus(targetTenantId, ids), JSON.stringify([targetTenantId, ids]));
  const checked = state.status === 'ok' && ids.every(id => state.data.some(p => p.packageId === id));
  const createPackages = checked && state.status === 'ok'
    ? ids.filter(id => state.data.some(p => p.packageId === id && !p.exists)) : [];
  const failed = state.status === 'error' || state.status === 'ok' && !checked;
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
    const focusables = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
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

  // AI-NOTE: 대화상자는 document.body에 포털로 그린다. 처음 이유는 옛 이관 탭의 sticky 실행 카드가 만든 쌓임 맥락 안에서 z-10이 결과 카드 위로 못 올라가던 것이었다. 지금 마법사에도 단계·결과 카드가 쌓임 맥락을 만들 수 있어 포털을 유지한다 (근거: REQ-107 AC-4, ADR-015)
  return createPortal(
    <div className="fixed inset-0 z-10 flex animate-dialog-fade items-center justify-center bg-scrim p-4" onKeyDown={onKeyDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90dvh] overflow-y-auto w-full max-w-[440px] min-w-0 animate-dialog-pop rounded-xl bg-canvas p-6 shadow-overlay"
      >
        <h2 id={titleId} className="mb-3 text-lg font-semibold">
          실제 이관 확인
        </h2>
        <Callout tone="warning">{`${targetName}에 업로드합니다. 되돌릴 수 없습니다`}</Callout>
        <dl className="mt-3.5 grid gap-2">
          {routeText !== undefined && <SummaryRow label="경로">{routeText}</SummaryRow>}
          <SummaryRow label="아티팩트 수">{artifactCount}</SummaryRow>
          {!onDeployChange && <SummaryRow label="배포">{deploy ? '예' : '아니오'}</SummaryRow>}
        </dl>
        <ul aria-label="대상 패키지" className="mt-3.5 grid min-w-0 gap-2">
          {packages.map((p, i) => <li key={p.packageId} aria-labelledby={`${titleId}-package-${i}`} className="min-w-0 break-all">
            <p id={`${titleId}-package-${i}`} className="font-medium break-all">
              {p.packageName && <span>{p.packageName} </span>}<span className="font-mono break-all">{p.packageId}</span>
            </p>
            {checked && <p className="text-sm">{createPackages.includes(p.packageId) ? '대상에 없음 → 새로 만듦' : '있음'}</p>}
          </li>)}
        </ul>
        {createPackages.length > 0 && <p className="mt-3 text-sm">{`패키지 ${createPackages.length}개를 대상에 새로 만듭니다. 이관이 실패해도 만든 패키지는 남습니다`}</p>}
        {failed && <div role="alert" className="mt-3">
          <p>대상 패키지를 확인하지 못했습니다</p>
          <Button onClick={retry}>다시 시도</Button>
        </div>}
        {onDeployChange && (
          <Switch className="mt-3.5" label="배포" description={`이관 후 ${targetName}에 배포합니다`} checked={deploy} disabled={busy}
            onChange={(e) => onDeployChange(e.target.checked)} />
        )}
        {/* 폭 640px 미만에서는 버튼이 세로로 쌓이고 DOM 순서(취소 → 실행)를 뒤집어 "실행"이 위에 온다 */}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} className="w-full sm:w-auto" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button variant="primary" className="w-full sm:w-auto" onClick={() => { if (checked) onConfirm(createPackages); }} disabled={busy || !checked}>
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
