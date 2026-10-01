import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

const noop = () => {};

function renderDialog(over: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<ConfirmDialog packageId="PkgA" artifactCount={2} deploy={false} busy={false} onConfirm={onConfirm} onCancel={onCancel} {...over} />);
  return { onConfirm, onCancel, dialog: screen.getByRole('dialog') };
}

describe('확인 대화상자 표현 (REQ-107 AC-4)', () => {
  it('REQ-107 AC-4: scrim 색 전체 화면 배경 위의 canvas 패널(최대 폭 440px, 반경 xl, shadow-overlay)이고 body에 그려진다', () => {
    const { dialog } = renderDialog();
    const scrim = dialog.parentElement as HTMLElement;
    expect(scrim.parentElement).toBe(document.body);
    for (const c of ['fixed', 'inset-0', 'bg-scrim']) expect(scrim.className, c).toContain(c);
    for (const c of ['bg-canvas', 'max-w-[440px]', 'rounded-xl', 'shadow-overlay']) expect(dialog.className, c).toContain(c);
  });

  it('REQ-107 AC-4: 등장 애니메이션은 200ms 이하이고 불투명도와 크기·위치를 바꾸며 움직임 줄이기 전역 규칙이 적용된다', () => {
    const { dialog } = renderDialog();
    expect(dialog.parentElement?.className).toContain('animate-dialog-fade');
    expect(dialog.className).toContain('animate-dialog-pop');
    const css = readFileSync(join(__dirname, '../../index.css'), 'utf8');
    for (const name of ['dialog-fade', 'dialog-pop']) {
      const ms = Number(css.match(new RegExp(`--animate-${name}: ${name} (\\d+)ms`))?.[1]);
      expect(ms, name).toBeGreaterThan(0);
      expect(ms, name).toBeLessThanOrEqual(200);
    }
    expect(css).toMatch(/@keyframes dialog-fade\s*\{[^}]*\{\s*opacity: 0/);
    expect(css).toMatch(/@keyframes dialog-pop\s*\{[^}]*\{[^}]*opacity: 0;[^}]*transform: translateY\(8px\) scale\(0\.98\)/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('REQ-107 AC-4: 제목 "실제 이관 확인"과 warning Callout "PRD에 업로드합니다"가 있다', () => {
    const { dialog } = renderDialog();
    expect(within(dialog).getByRole('heading', { name: '실제 이관 확인' })).toBeInTheDocument();
    const callout = within(dialog).getByText('PRD에 업로드합니다').closest('div[class*="bg-warning-bg"]');
    expect(callout).not.toBeNull();
    expect(callout?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('REQ-107 AC-4: 요약 3줄은 라벨과 값으로 나뉘고 packageId는 고정폭, 아티팩트 수는 선택 수 또는 "전체", 배포는 "예"/"아니오"다', () => {
    const { dialog } = renderDialog({ artifactCount: 3, deploy: true });
    expect(within(dialog).getAllByRole('term').map((t) => t.textContent)).toEqual(['대상 패키지', '아티팩트 수', '배포']);
    const value = (label: string) => within(dialog).getByText(label).nextElementSibling as HTMLElement;
    expect(value('대상 패키지')).toHaveTextContent('PkgA');
    expect(value('대상 패키지').className).toContain('font-mono');
    expect(value('아티팩트 수')).toHaveTextContent('3');
    expect(value('배포')).toHaveTextContent('예');
  });

  it('REQ-107 AC-4: 선택이 0개면 아티팩트 수는 "전체", 배포 꺼짐이면 "아니오"다', () => {
    const { dialog } = renderDialog({ artifactCount: 0, deploy: false });
    expect(within(dialog).getByText('아티팩트 수').nextElementSibling).toHaveTextContent('전체');
    expect(within(dialog).getByText('배포').nextElementSibling).toHaveTextContent('아니오');
  });

  it('REQ-107 AC-4: 버튼은 오른쪽 정렬 "취소"(secondary)와 "실행"(primary)이고 폭 640px 미만에서는 세로로 쌓이며 "실행"이 위다', () => {
    const { dialog } = renderDialog();
    const cancel = within(dialog).getByRole('button', { name: '취소' });
    const run = within(dialog).getByRole('button', { name: '실행' });
    expect(cancel.className).toContain('border-hairline-strong');
    expect(run.className).toContain('bg-primary');
    const row = cancel.parentElement as HTMLElement;
    expect(run.parentElement).toBe(row);
    for (const c of ['flex-col-reverse', 'sm:flex-row', 'sm:justify-end']) expect(row.className, c).toContain(c);
    // DOM 순서는 취소 → 실행이고, 세로로 쌓일 때(flex-col-reverse)는 실행이 위에 보인다
    expect(cancel.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.className).toContain('w-full');
  });
});

describe('확인 대화상자 동작 (REQ-107 AC-5)', () => {
  it('REQ-107 AC-5: role=dialog, aria-modal, 제목과 연결되고 열리면 "취소"에 포커스가 간다', () => {
    const { dialog } = renderDialog();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('실제 이관 확인');
    expect(screen.getByRole('button', { name: '취소' })).toHaveFocus();
  });

  it('REQ-107 AC-5: Tab은 대화상자 안에서 순환하고 Esc와 "취소"로 닫힌다', async () => {
    const { onCancel } = renderDialog();
    const cancel = screen.getByRole('button', { name: '취소' });
    const run = screen.getByRole('button', { name: '실행' });
    await userEvent.tab();
    expect(run).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(run).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('REQ-107 AC-5: 요청 중에는 Esc를 무시하고 두 버튼이 비활성이며 role=status "이관 실행 중"이 보인다', async () => {
    const { onCancel } = renderDialog({ busy: true });
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '실행' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('이관 실행 중');
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  function Host({ openerGoesAway = false }: { openerGoesAway?: boolean }) {
    const [open, setOpen] = useState(false);
    const [hideOpener, setHideOpener] = useState(false);
    const fallback = useRef<HTMLButtonElement>(null);
    return (
      <>
        {!hideOpener && (
          <button type="button" onClick={() => setOpen(true)}>
            열기
          </button>
        )}
        <button type="button" ref={fallback}>
          대체 버튼
        </button>
        {open && (
          <ConfirmDialog
            packageId="P"
            artifactCount={0}
            deploy={false}
            busy={false}
            onConfirm={noop}
            fallbackFocusRef={fallback}
            onCancel={() => {
              setOpen(false);
              if (openerGoesAway) setHideOpener(true);
            }}
          />
        )}
      </>
    );
  }

  it('REQ-107 AC-5: 닫히면 연 버튼으로 포커스가 돌아간다(스크롤하지 않는 옵션으로)', async () => {
    const calls: Array<[HTMLElement, FocusOptions | undefined]> = [];
    const original = HTMLElement.prototype.focus;
    const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, o?: FocusOptions) {
      calls.push([this, o]);
      return original.call(this, o);
    });
    render(<Host />);
    const opener = screen.getByRole('button', { name: '열기' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(opener).toHaveFocus();
    expect(calls.filter(([el]) => el === opener).pop()?.[1]).toEqual({ preventScroll: true });
    spy.mockRestore();
  });

  it('REQ-107 AC-5: 연 버튼이 화면에서 없어졌으면 대체 요소(실행 카드의 실행 버튼)로 포커스가 간다', async () => {
    render(<Host openerGoesAway />);
    await userEvent.click(screen.getByRole('button', { name: '열기' }));
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('button', { name: '열기' })).toBeNull();
    expect(screen.getByRole('button', { name: '대체 버튼' })).toHaveFocus();
  });
});
