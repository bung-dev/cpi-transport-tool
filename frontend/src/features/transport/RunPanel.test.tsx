import { TestTenantProvider } from '../../test/tenantProvider';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '../../test/mockFetch';
import { RunPanel } from './RunPanel';

// 확인 대화상자 요약은 라벨(dt)과 값(dd)으로 나뉘어 있다(REQ-107 AC-4).
const summaryValue = (dialog: HTMLElement, label: string) => within(dialog).getByText(label).nextElementSibling;

afterEach(() => vi.unstubAllGlobals());

const RESULT = { transportId: 't-1' };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `IF_${i + 1}`);

function postBody(fn: ReturnType<typeof mockApi>, index = 0) {
  const calls = fn.mock.calls.filter((c) => c[1]?.method === 'POST');
  return JSON.parse(calls[index][1]?.body as string);
}
const postCount = (fn: ReturnType<typeof mockApi>) => fn.mock.calls.filter((c) => c[1]?.method === 'POST').length;

function setup(artifactIds: string[] = [], packageId: string | null = 'PkgA', packageName: string | null = 'Package A') {
  const fn = mockApi({ 'POST /transport': () => json(RESULT) });
  const onResult = vi.fn();
  render(<RunPanel packageId={packageId} packageName={packageName} artifactIds={artifactIds} onResult={onResult} />, { wrapper: TestTenantProvider });
  return { fn, onResult };
}

const dryRunBtn = () => screen.getByRole('button', { name: '드라이런 실행' });
const realBtn = () => screen.getByRole('button', { name: 'PRD로 이관' });
const chooseReal = () => userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));

describe('실행 옵션과 요청 본문', () => {
  it('REQ-005 AC-1: 선택이 있으면 artifactIds를 목록 순서대로 보낸다', async () => {
    const { fn, onResult } = setup(['IF_B', 'IF_A']);
    await userEvent.click(dryRunBtn());
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(RESULT));
    expect(postBody(fn)).toEqual({ packageId: 'PkgA', artifactIds: ['IF_B', 'IF_A'], dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
  });

  it('REQ-005 AC-1: 선택이 0개면 artifactIds 키 없이 보내고 안내 문구를 보인다', async () => {
    const { fn, onResult } = setup([]);
    expect(screen.getByText('패키지의 모든 아티팩트가 대상')).toBeInTheDocument();
    await userEvent.click(dryRunBtn());
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    const body = postBody(fn);
    expect(Object.keys(body)).toEqual(['packageId', 'dryRun', 'deploy', 'sourceTenantId', 'targetTenantId']);
  });

  it('REQ-005 AC-1: 100개는 실행 가능, 101개는 비활성이고 한 번에 100개까지 안내', () => {
    const { unmount } = render(<RunPanel packageId="P" artifactIds={ids(100)} onResult={() => {}} />, { wrapper: TestTenantProvider });
    expect(dryRunBtn()).toBeEnabled();
    expect(screen.queryByText(/한 번에 100개까지/)).toBeNull();
    unmount();
    render(<RunPanel packageId="P" artifactIds={ids(101)} onResult={() => {}} />, { wrapper: TestTenantProvider });
    expect(dryRunBtn()).toBeDisabled();
    expect(screen.getByText(/한 번에 100개까지/)).toBeInTheDocument();
  });

  it('REQ-005 AC-1: 패키지를 고르지 않으면 실행 버튼이 비활성', () => {
    render(<RunPanel packageId={null} artifactIds={[]} onResult={() => {}} />, { wrapper: TestTenantProvider });
    expect(dryRunBtn()).toBeDisabled();
  });

  it('REQ-005 AC-2: 기본은 드라이런(배포 스위치 없음)이고 실제 이관을 고르면 배포 스위치(기본 꺼짐)가 나온다. 드라이런 요청은 deploy: false다', async () => {
    const { fn, onResult } = setup();
    expect(screen.getByRole('radio', { name: '드라이런' })).toBeChecked();
    expect(screen.queryByRole('switch', { name: '배포' })).toBeNull();
    expect(screen.queryByText(/SKIPPED_DRY_RUN/)).toBeNull();
    await chooseReal();
    expect(screen.getByRole('switch', { name: '배포' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('switch', { name: '배포' }));
    expect(screen.getByRole('switch', { name: '배포' })).toBeChecked();
    // 배포를 켠 채 드라이런으로 돌아가도 요청은 deploy: false이고 옛 SKIPPED_DRY_RUN 안내는 없다
    await userEvent.click(screen.getByRole('radio', { name: '드라이런' }));
    expect(screen.queryByRole('switch', { name: '배포' })).toBeNull();
    expect(screen.queryByText(/SKIPPED_DRY_RUN/)).toBeNull();
    await userEvent.click(dryRunBtn());
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(postBody(fn)).toMatchObject({ dryRun: true, deploy: false });
  });
});

describe('실행 카드 (REQ-104 AC-5)', () => {
  it('REQ-104 AC-5: 요약 두 줄 — 패키지 name·id와 아티팩트 "n개 선택"', () => {
    setup(['IF_A', 'IF_B', 'IF_C']);
    const dl = screen.getAllByRole('term').map((t) => t.textContent);
    expect(dl).toEqual(['패키지', '아티팩트']);
    const defs = screen.getAllByRole('definition');
    expect(defs[0]).toHaveTextContent('Package A');
    expect(defs[0]).toHaveTextContent('PkgA');
    expect(defs[1]).toHaveTextContent('3개 선택');
  });

  it('REQ-104 AC-5: 아티팩트 0개면 "패키지의 모든 아티팩트가 대상", 패키지 미선택이면 "선택 안 됨"과 "—"', () => {
    const { unmount } = render(<RunPanel packageId="PkgA" packageName="Package A" artifactIds={[]} onResult={() => {}} />, { wrapper: TestTenantProvider });
    expect(screen.getAllByRole('definition')[1]).toHaveTextContent('패키지의 모든 아티팩트가 대상');
    unmount();
    render(<RunPanel packageId={null} artifactIds={[]} onResult={() => {}} />, { wrapper: TestTenantProvider });
    const defs = screen.getAllByRole('definition');
    expect(defs[0]).toHaveTextContent('선택 안 됨');
    expect(defs[1]).toHaveTextContent('—');
  });

  it('REQ-104 AC-5: 실행 모드는 이름이 "실행 모드"인 라디오 그룹이고 드라이런이 기본이며 설명이 붙는다', () => {
    setup();
    const group = screen.getByRole('radiogroup', { name: '실행 모드' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['dryRun', 'real']);
    expect(radios.every((r) => r.getAttribute('name') === 'runMode')).toBe(true);
    expect(screen.getByRole('radio', { name: '드라이런' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '드라이런' })).toHaveAccessibleDescription(
      'PRD에 요청을 보내지 않고 변경 내용만 확인합니다',
    );
    expect(screen.getByRole('radio', { name: '실제 이관' })).toHaveAccessibleDescription('PRD에 업로드합니다');
  });

  it('REQ-104 AC-5: 선택지는 상자 전체가 클릭 영역이고 선택된 쪽은 primary 테두리·primary-soft 배경이다', async () => {
    setup();
    const boxOf = (name: string) => screen.getByRole('radio', { name }).closest('label') as HTMLElement;
    expect(boxOf('드라이런').className).toContain('border-primary');
    expect(boxOf('드라이런').className).toContain('bg-primary-soft');
    expect(boxOf('실제 이관').className).toContain('border-hairline-strong');
    expect(boxOf('실제 이관').className).not.toContain('bg-primary-soft');
    await userEvent.click(screen.getByText('PRD에 업로드합니다'));
    expect(screen.getByRole('radio', { name: '실제 이관' })).toBeChecked();
    expect(boxOf('실제 이관').className).toContain('border-primary');
    expect(boxOf('드라이런').className).toContain('border-hairline-strong');
  });

  it('REQ-104 AC-5: 배포 스위치는 실제 이관일 때만 보이고(설명 포함) 드라이런으로 바꾸면 사라지며 값은 꺼짐으로 돌아간다', async () => {
    setup();
    expect(screen.queryByRole('switch')).toBeNull();
    await chooseReal();
    const sw = screen.getByRole('switch', { name: '배포' });
    expect(sw).toHaveAccessibleDescription('이관 후 PRD에 배포합니다');
    expect(sw).not.toBeChecked();
    await userEvent.click(sw);
    expect(sw).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: '드라이런' }));
    expect(screen.queryByRole('switch')).toBeNull();
    await chooseReal();
    expect(screen.getByRole('switch', { name: '배포' })).not.toBeChecked();
  });

  it('REQ-104 AC-5: 실행 버튼 글자는 드라이런 "드라이런 실행", 실제 이관 "PRD로 이관"이고 전체 폭 primary다', async () => {
    setup();
    expect(dryRunBtn().className).toContain('w-full');
    expect(dryRunBtn().className).toContain('bg-primary');
    expect(screen.queryByRole('button', { name: 'PRD로 이관' })).toBeNull();
    await chooseReal();
    expect(realBtn()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '드라이런 실행' })).toBeNull();
  });

  it('REQ-104 AC-5: 안내 영역 — 실제 이관이면 warning Callout, 101개 이상이면 danger-fg 글자, 드라이런에는 옛 안내가 없다', async () => {
    render(<RunPanel packageId="P" artifactIds={ids(101)} onResult={() => {}} />, { wrapper: TestTenantProvider });
    expect(screen.queryByText('실제 이관입니다. PRD에 업로드합니다.')).toBeNull();
    const over = screen.getByText('한 번에 100개까지 선택할 수 있습니다');
    expect(over.className).toContain('text-danger-fg');
    await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
    const callout = screen.getByText('실제 이관입니다. PRD에 업로드합니다.').closest('div[class*="bg-warning-bg"]');
    expect(callout).not.toBeNull();
    expect(screen.queryByText(/SKIPPED_DRY_RUN|드라이런에서는 배포하지 않습니다/)).toBeNull();
  });

  it('REQ-104 AC-5: 카드 구성 순서는 요약 → 실행 모드 → 배포 → 안내 → 실행 버튼이다', async () => {
    setup();
    await chooseReal();
    const order = [
      screen.getAllByRole('term')[0],
      screen.getByRole('radiogroup', { name: '실행 모드' }),
      screen.getByRole('switch', { name: '배포' }),
      screen.getByText('실제 이관입니다. PRD에 업로드합니다.'),
      realBtn(),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}`).toBeTruthy();
    }
  });

  it('REQ-101 AC-4: 요약의 packageId는 고정폭 글꼴이다', () => {
    setup();
    expect(screen.getByText('PkgA').className).toContain('font-mono');
  });

  it('REQ-101 AC-6: 실행 모드 선택지 상자의 테두리·배경 변화에 150ms 전환이 있다', () => {
    setup();
    for (const name of ['드라이런', '실제 이관']) {
      const box = screen.getByRole('radio', { name }).closest('label') as HTMLElement;
      expect(box.className).toContain('transition-colors');
      expect(box.className).toContain('duration-150');
    }
  });

  it('REQ-101 AC-7: 실행 모드 라디오·배포 스위치·실행 버튼은 전역 포커스 외곽선을 지우지 않는다', async () => {
    setup();
    await chooseReal();
    for (const el of [
      screen.getByRole('radio', { name: '드라이런' }),
      screen.getByRole('radio', { name: '실제 이관' }),
      screen.getByRole('switch', { name: '배포' }),
      realBtn(),
    ]) {
      expect(el.className).not.toMatch(/outline-(none|0|hidden)/);
    }
    expect(screen.getByRole('radio', { name: '실제 이관' }).className).toContain('appearance-none');
    expect(screen.getByRole('switch', { name: '배포' }).className).toContain('appearance-none');
  });
});

describe('확인 대화상자', () => {
  async function openDialog(artifactIds: string[] = ['IF_A', 'IF_B']) {
    const s = setup(artifactIds);
    await chooseReal();
    await userEvent.click(screen.getByRole('switch', { name: '배포' }));
    const runBtn = realBtn();
    await userEvent.click(runBtn);
    return { ...s, runBtn };
  }

  it('REQ-005 AC-3: 실제 이관이면 대화상자가 대상 패키지·수·배포·PRD 업로드를 보이고 요청은 아직 없다', async () => {
    const { fn } = await openDialog();
    const dialog = screen.getByRole('dialog', { name: '실제 이관 확인' });
    expect(summaryValue(dialog, '대상 패키지')).toHaveTextContent('PkgA');
    expect(summaryValue(dialog, '아티팩트 수')).toHaveTextContent('2');
    expect(summaryValue(dialog, '배포')).toHaveTextContent('예');
    expect(dialog).toHaveTextContent('PRD에 업로드합니다');
    expect(postCount(fn)).toBe(0);
  });

  it('REQ-005 AC-3: 선택 0개면 아티팩트 수: 전체, 배포 꺼짐이면 배포: 아니오', async () => {
    setup([]);
    await chooseReal();
    await userEvent.click(realBtn());
    const dialog = screen.getByRole('dialog');
    expect(summaryValue(dialog, '아티팩트 수')).toHaveTextContent('전체');
    expect(summaryValue(dialog, '배포')).toHaveTextContent('아니오');
  });

  it('REQ-005 AC-3: 취소 버튼과 Esc는 요청 없이 닫기만 한다', async () => {
    const { fn, runBtn } = await openDialog();
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(runBtn);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postCount(fn)).toBe(0);
  });

  it('REQ-005 AC-3: 실행을 눌러야 전송되고(1회) 완료 후 대화상자가 닫힌다', async () => {
    const { fn, onResult } = await openDialog();
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postCount(fn)).toBe(1);
    expect(postBody(fn)).toEqual({ packageId: 'PkgA', artifactIds: ['IF_A', 'IF_B'], dryRun: false, deploy: true, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
    expect(onResult).toHaveBeenCalledWith(RESULT);
  });

  it('REQ-005 AC-3: 드라이런이면 대화상자 없이 바로 전송한다', async () => {
    const { fn, onResult } = setup(['IF_A']);
    await userEvent.click(dryRunBtn());
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(postCount(fn)).toBe(1);
  });

  it('REQ-009 AC-1: 대화상자는 role/aria-modal, 열리면 취소로 포커스, Tab은 안에서 순환, 닫히면 실행 버튼으로 복귀', async () => {
    const { runBtn } = await openDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const cancel = screen.getByRole('button', { name: '취소' });
    const ok = screen.getByRole('button', { name: '실행' });
    expect(cancel).toHaveFocus();
    await userEvent.tab();
    expect(ok).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(ok).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(runBtn).toHaveFocus();
  });

  it('REQ-101 AC-4: 대화상자의 대상 패키지 값은 고정폭 글꼴이다', async () => {
    await openDialog();
    expect(within(screen.getByRole('dialog')).getByText('PkgA').className).toContain('font-mono');
  });
});

describe('요청 중 상태', () => {
  it('REQ-005 AC-4: 요청 중에는 실행 버튼이 비활성이고 이관 실행 중 표시가 나온다', async () => {
    let release: (r: Response) => void = () => {};
    mockApi({ 'POST /transport': () => new Promise<Response>((r) => (release = r)) });
    render(<RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />, { wrapper: TestTenantProvider });
    await userEvent.click(dryRunBtn());
    expect(dryRunBtn()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('이관 실행 중');
    await act(async () => release(json(RESULT)));
    await waitFor(() => expect(dryRunBtn()).toBeEnabled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('REQ-005 AC-4: 같은 틱의 연속 클릭 3회에도 요청은 1회', async () => {
    const { fn } = setup([]);
    const btn = dryRunBtn();
    act(() => {
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await waitFor(() => expect(btn).toBeEnabled());
    expect(postCount(fn)).toBe(1);
  });

  it('REQ-005 AC-4: 대화상자 실행 버튼 연속 클릭도 1회, 요청 중 실행·취소 비활성과 진행 표시', async () => {
    let release: (r: Response) => void = () => {};
    const fn = mockApi({ 'POST /transport': () => new Promise<Response>((r) => (release = r)) });
    render(<RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />, { wrapper: TestTenantProvider });
    await chooseReal();
    await userEvent.click(realBtn());
    const ok = screen.getByRole('button', { name: '실행' });
    act(() => {
      fireEvent.click(ok);
      fireEvent.click(ok);
    });
    expect(ok).toBeDisabled();
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('이관 실행 중');
    await act(async () => release(json(RESULT)));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postCount(fn)).toBe(1);
  });

  it('REQ-104 AC-6: 드라이런은 실행 버튼을 누르면 바로 요청하고, 요청 중 실행 버튼은 loading(스피너·aria-busy·비활성)이다', async () => {
    let release: (r: Response) => void = () => {};
    const fn = mockApi({ 'POST /transport': () => new Promise<Response>((r) => (release = r)) });
    render(<RunPanel packageId="P" artifactIds={['IF_A']} onResult={() => {}} />, { wrapper: TestTenantProvider });
    await userEvent.click(dryRunBtn());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postCount(fn)).toBe(1);
    const btn = dryRunBtn();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
    expect(btn.querySelector('svg[data-spinner]')).not.toBeNull();
    await act(async () => release(json(RESULT)));
    await waitFor(() => expect(dryRunBtn()).toBeEnabled());
    expect(dryRunBtn()).not.toHaveAttribute('aria-busy');
  });

  it('REQ-104 AC-6: 실제 이관은 대화상자 "실행"을 눌러야만 요청하고 "이관 실행 중" 상태 표시는 한 곳(대화상자 안)에만 나온다', async () => {
    let release: (r: Response) => void = () => {};
    const fn = mockApi({ 'POST /transport': () => new Promise<Response>((r) => (release = r)) });
    render(<RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />, { wrapper: TestTenantProvider });
    await chooseReal();
    await userEvent.click(realBtn());
    expect(postCount(fn)).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    expect(postCount(fn)).toBe(1);
    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(screen.getByRole('dialog')).toContainElement(statuses[0]);
    expect(statuses[0]).toHaveTextContent('이관 실행 중');
    await act(async () => release(json(RESULT)));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('REQ-104 AC-6: 대화상자가 없을 때(드라이런) 상태 표시는 실행 카드에 한 곳만 나온다', async () => {
    mockApi({ 'POST /transport': () => new Promise<Response>(() => {}) });
    render(<RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />, { wrapper: TestTenantProvider });
    await userEvent.click(dryRunBtn());
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('REQ-104 AC-6: 실제 이관 요청 본문은 dryRun false이고 배포 스위치 값을 따른다', async () => {
    const fn = mockApi({ 'POST /transport': () => json(RESULT) });
    render(<RunPanel packageId="P" artifactIds={['IF_A']} onResult={() => {}} />, { wrapper: TestTenantProvider });
    await chooseReal();
    await userEvent.click(realBtn());
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    await waitFor(() => expect(postCount(fn)).toBe(1));
    expect(postBody(fn)).toEqual({ packageId: 'P', artifactIds: ['IF_A'], dryRun: false, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
  });

  it('REQ-008 AC-3: 전송 오류는 role=alert로 보이고 다시 실행할 수 있다', async () => {
    mockApi({
      'POST /transport': () => json({ error: 'MAPPING_INVALID', message: 'bad mapping' }, 422),
    });
    render(<RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />, { wrapper: TestTenantProvider });
    await userEvent.click(dryRunBtn());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('매핑 파일이 올바르지 않습니다');
    expect(alert).toHaveTextContent('bad mapping');
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    expect(dryRunBtn()).toBeEnabled();
  });
});
