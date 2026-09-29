import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '../../test/mockFetch';
import { RunPanel } from './RunPanel';

afterEach(() => vi.unstubAllGlobals());

const RESULT = { transportId: 't-1' };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `IF_${i + 1}`);

function postBody(fn: ReturnType<typeof mockApi>, index = 0) {
  const calls = fn.mock.calls.filter((c) => c[1]?.method === 'POST');
  return JSON.parse(calls[index][1]?.body as string);
}
const postCount = (fn: ReturnType<typeof mockApi>) => fn.mock.calls.filter((c) => c[1]?.method === 'POST').length;

function setup(artifactIds: string[] = [], packageId: string | null = 'PkgA') {
  const fn = mockApi({ 'POST /transport': () => json(RESULT) });
  const onResult = vi.fn();
  render(<RunPanel packageId={packageId} artifactIds={artifactIds} onResult={onResult} />);
  return { fn, onResult };
}

describe('실행 옵션과 요청 본문', () => {
  it('REQ-005 AC-1: 선택이 있으면 artifactIds를 목록 순서대로 보낸다', async () => {
    const { fn, onResult } = setup(['IF_B', 'IF_A']);
    await userEvent.click(screen.getByRole('button', { name: '이관 실행' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(RESULT));
    expect(postBody(fn)).toEqual({ packageId: 'PkgA', artifactIds: ['IF_B', 'IF_A'], dryRun: true, deploy: false });
  });

  it('REQ-005 AC-1: 선택이 0개면 artifactIds 키 없이 보내고 안내 문구를 보인다', async () => {
    const { fn, onResult } = setup([]);
    expect(screen.getByText('패키지의 모든 아티팩트가 대상')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '이관 실행' }));
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    const body = postBody(fn);
    expect(Object.keys(body)).toEqual(['packageId', 'dryRun', 'deploy']);
  });

  it('REQ-005 AC-1: 100개는 실행 가능, 101개는 비활성이고 한 번에 100개까지 안내', () => {
    const { unmount } = render(<RunPanel packageId="P" artifactIds={ids(100)} onResult={() => {}} />);
    expect(screen.getByRole('button', { name: '이관 실행' })).toBeEnabled();
    expect(screen.queryByText(/한 번에 100개까지/)).toBeNull();
    unmount();
    render(<RunPanel packageId="P" artifactIds={ids(101)} onResult={() => {}} />);
    expect(screen.getByRole('button', { name: '이관 실행' })).toBeDisabled();
    expect(screen.getByText(/한 번에 100개까지/)).toBeInTheDocument();
  });

  it('REQ-005 AC-1: 패키지를 고르지 않으면 이관 실행이 비활성', () => {
    render(<RunPanel packageId={null} artifactIds={[]} onResult={() => {}} />);
    expect(screen.getByRole('button', { name: '이관 실행' })).toBeDisabled();
  });

  it('REQ-005 AC-2: 드라이런은 기본 켜짐, 배포는 기본 꺼짐이고 둘 다 켜면 SKIPPED_DRY_RUN 안내', async () => {
    setup();
    expect(screen.getByLabelText('드라이런')).toBeChecked();
    expect(screen.getByLabelText('배포')).not.toBeChecked();
    expect(screen.queryByText(/SKIPPED_DRY_RUN/)).toBeNull();
    await userEvent.click(screen.getByLabelText('배포'));
    expect(screen.getByText('드라이런에서는 배포하지 않습니다(SKIPPED_DRY_RUN)')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('드라이런'));
    expect(screen.queryByText(/SKIPPED_DRY_RUN/)).toBeNull();
  });
});

describe('확인 대화상자', () => {
  async function openDialog(artifactIds: string[] = ['IF_A', 'IF_B']) {
    const s = setup(artifactIds);
    await userEvent.click(screen.getByLabelText('드라이런'));
    await userEvent.click(screen.getByLabelText('배포'));
    const runBtn = screen.getByRole('button', { name: '이관 실행' });
    await userEvent.click(runBtn);
    return { ...s, runBtn };
  }

  it('REQ-005 AC-3: 드라이런이 꺼져 있으면 대화상자가 대상 패키지·수·배포·PRD 업로드를 보이고 요청은 아직 없다', async () => {
    const { fn } = await openDialog();
    const dialog = screen.getByRole('dialog', { name: '실제 이관 확인' });
    expect(dialog).toHaveTextContent('대상 패키지: PkgA');
    expect(dialog).toHaveTextContent('아티팩트 수: 2');
    expect(dialog).toHaveTextContent('배포: 예');
    expect(dialog).toHaveTextContent('PRD에 업로드합니다');
    expect(postCount(fn)).toBe(0);
  });

  it('REQ-005 AC-3: 선택 0개면 아티팩트 수: 전체, 배포 꺼짐이면 배포: 아니오', async () => {
    setup([]);
    await userEvent.click(screen.getByLabelText('드라이런'));
    await userEvent.click(screen.getByRole('button', { name: '이관 실행' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('아티팩트 수: 전체');
    expect(dialog).toHaveTextContent('배포: 아니오');
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
    expect(postBody(fn)).toEqual({ packageId: 'PkgA', artifactIds: ['IF_A', 'IF_B'], dryRun: false, deploy: true });
    expect(onResult).toHaveBeenCalledWith(RESULT);
  });

  it('REQ-005 AC-3: 드라이런이면 대화상자 없이 바로 전송한다', async () => {
    const { fn, onResult } = setup(['IF_A']);
    await userEvent.click(screen.getByRole('button', { name: '이관 실행' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(postCount(fn)).toBe(1);
  });

  it('REQ-009 AC-1: 대화상자는 role/aria-modal, 열리면 취소로 포커스, Tab은 안에서 순환, 닫히면 이관 실행으로 복귀', async () => {
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
});

describe('요청 중 상태', () => {
  it('REQ-005 AC-4: 요청 중에는 이관 실행이 비활성이고 이관 실행 중 표시가 나온다', async () => {
    let release: (r: Response) => void = () => {};
    mockApi({ 'POST /transport': () => new Promise<Response>((r) => (release = r)) });
    render(<RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '이관 실행' }));
    expect(screen.getByRole('button', { name: '이관 실행' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('이관 실행 중');
    await act(async () => release(json(RESULT)));
    await waitFor(() => expect(screen.getByRole('button', { name: '이관 실행' })).toBeEnabled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('REQ-005 AC-4: 같은 틱의 연속 클릭 3회에도 요청은 1회', async () => {
    const { fn } = setup([]);
    const btn = screen.getByRole('button', { name: '이관 실행' });
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
    render(<RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />);
    await userEvent.click(screen.getByLabelText('드라이런'));
    await userEvent.click(screen.getByRole('button', { name: '이관 실행' }));
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

  it('REQ-008 AC-3: 전송 오류는 role=alert로 보이고 다시 실행할 수 있다', async () => {
    mockApi({
      'POST /transport': () => json({ error: 'MAPPING_INVALID', message: 'bad mapping' }, 422),
    });
    render(<RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '이관 실행' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('매핑 파일이 올바르지 않습니다');
    expect(alert).toHaveTextContent('bad mapping');
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    expect(screen.getByRole('button', { name: '이관 실행' })).toBeEnabled();
  });
});
