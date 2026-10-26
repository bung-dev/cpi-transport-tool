import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResult, TransportResponse } from '../../api/types';
import { json, mockApi } from '../../test/mockFetch';
import { HistoryTab } from '../history/HistoryTab';
import { TransportResult } from './TransportResult';

// REQ-315: 갱신 PUT이 400을 본문 없이 돌려받으면 서버가 error.message 끝에 편집 락 가능성 안내를 붙인다(백엔드 LockHintWireMockTests).
// 화면은 그 메시지를 그대로 보인다. 이 파일은 이관 결과 화면과 이력 상세 모두에서 안내 전체가 보이는지 확인한다.

afterEach(() => vi.unstubAllGlobals());

const HINT = '대상 테넌트에서 이 아티팩트가 편집 중(잠김)일 수 있습니다. CPI 화면에서 편집을 저장하거나 취소한 뒤 다시 시도하세요.';
const LOCK_MESSAGE = `UPLOAD: HTTP 400; CPI call failed. ${HINT}`;
const PLAIN_MESSAGE = 'UPLOAD: HTTP 409; CPI call failed';

const art = (artifactId: string, over: Partial<ArtifactResult> = {}): ArtifactResult => ({
  artifactId,
  status: 'SUCCESS',
  action: 'UPDATED',
  deployStatus: 'NOT_REQUESTED',
  error: null,
  replacements: [],
  unmappedKeys: [],
  ...over,
});

const failed = (artifactId: string, message: string) =>
  art(artifactId, { status: 'FAILED', action: 'NONE', error: { code: 'UPLOAD_FAILED', message } });

function result(transportId: string, results: ArtifactResult[]): TransportResponse {
  const failedCount = results.filter((r) => r.status === 'FAILED').length;
  return {
    transportId,
    packageId: 'PkgTransportDemo',
    dryRun: false,
    deploy: true,
    startedAt: '2026-10-20T07:05:05Z',
    finishedAt: '2026-10-20T07:05:59Z',
    summary: { total: results.length, succeeded: results.length - failedCount, failed: failedCount },
    results,
  };
}

/** 안내가 붙은 FAILED 1개, 안내 없는 FAILED 1개(409), 성공 1개 */
const LOCKED = result('t-lock-hint', [art('A_Ok'), failed('B_Locked', LOCK_MESSAGE), failed('C_Conflict', PLAIN_MESSAGE)]);

/** 아티팩트 카드(h4 버튼 이름 = 아티팩트 ID)의 Card 루트 */
const card = (artifactId: string) => {
  const button = screen.getByRole('button', { name: artifactId });
  const root = button.closest('h4')?.parentElement?.parentElement?.parentElement;
  if (!root) throw new Error(`카드 없음: ${artifactId}`);
  return { button, root };
};

/** 안내가 보이는 방식을 한 번에 읽는다: 펼침 여부, 메시지 요소 글자, 같은 상자의 오류 코드, 안내가 화면에 나온 횟수 */
function lockHintView() {
  const { button, root } = card('B_Locked');
  const message = within(root).getByText(LOCK_MESSAGE);
  const box = message.parentElement as HTMLElement;
  return {
    expanded: button.getAttribute('aria-expanded'),
    text: message.textContent,
    textOnly: message.children.length === 0,
    code: within(box).getByText('UPLOAD_FAILED').textContent,
    hintCount: screen.queryAllByText((_, el) => el?.children.length === 0 && (el.textContent ?? '').includes(HINT)).length,
    conflictHasHint: (card('C_Conflict').root.textContent ?? '').includes(HINT),
    conflictMessage: within(card('C_Conflict').root).getByText(PLAIN_MESSAGE).textContent,
  };
}

const EXPECTED = {
  expanded: 'true',
  text: LOCK_MESSAGE,
  textOnly: true,
  code: 'UPLOAD_FAILED',
  hintCount: 1,
  conflictHasHint: false,
  conflictMessage: PLAIN_MESSAGE,
};

describe('갱신 400 무본문 편집 락 안내 (REQ-315)', () => {
  it('REQ-315 AC-3·AC-5: 이관 결과 화면에서 FAILED 카드가 처음부터 펼쳐져 안내 전체를 오류 코드와 함께 보인다', () => {
    render(<TransportResult result={LOCKED} />);
    expect(screen.getByRole('heading', { name: '이관 결과' })).toBeInTheDocument();
    expect(lockHintView()).toEqual(EXPECTED);
    expect(screen.getByText(LOCK_MESSAGE)).toHaveTextContent(HINT);
  });

  it('REQ-315 AC-3·AC-5: 이력 상세(행의 이관 ID 클릭)에서도 같은 안내가 같은 자리에 보이고 목록으로 돌아가면 사라진다', async () => {
    const { unmount } = render(<TransportResult result={LOCKED} />);
    const direct = lockHintView();
    unmount();

    mockApi({ 'GET /transport/history': () => json([LOCKED]) });
    render(<HistoryTab />);
    expect(screen.queryByText(LOCK_MESSAGE)).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: LOCKED.transportId }));
    expect(screen.getByRole('heading', { name: '이관 결과' })).toBeInTheDocument();
    expect(lockHintView()).toEqual(direct);
    expect(lockHintView()).toEqual(EXPECTED);
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(screen.queryByText(LOCK_MESSAGE)).toBeNull();
  });
});
