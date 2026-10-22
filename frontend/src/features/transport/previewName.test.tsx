import { TENANTS_OK, TENANT_STATUS_OK } from '../../test/tenantFixtures';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportResponse } from '../../api/types';
import App from '../../App';
import { ARTIFACTS, PACKAGES, json, mockApi } from '../../test/mockFetch';

// REQ-319: 화면 명칭이 "미리보기"로 바뀌었다(이전 명칭은 아래 상수). 요청 필드·내부 코드 dryRun은 그대로다.
// AI-NOTE: 옛 명칭은 화면에 없음을 확인하는 이 상수 한 줄에만 둔다(AC-2). 다른 테스트에 옛 문구가 남으면 부재 단언이 항상 통과해 버린다.
const OLD_TERM = '드라이런';

const PREVIEW_RESULT: TransportResponse = {
  transportId: 't-preview-1',
  packageId: 'PkgTransportDemo',
  dryRun: true,
  deploy: false,
  startedAt: '2026-09-29T07:05:05Z',
  finishedAt: '2026-09-29T07:05:06Z',
  summary: { total: 1, succeeded: 1, failed: 0 },
  results: [
    { artifactId: 'IF_Order_Sync', status: 'SUCCESS', action: 'NONE', deployStatus: 'NOT_REQUESTED', error: null, replacements: [], unmappedKeys: [] },
  ],
};
// 이전 버전이 저장한 이력 행: dryRun:true 한 필드만으로 "미리보기"로 보여야 한다(AC-3).
const SAVED_PREVIEW: TransportResponse = { ...PREVIEW_RESULT, transportId: 't-saved-preview' };
const SAVED_REAL: TransportResponse = { ...PREVIEW_RESULT, transportId: 't-saved-real', dryRun: false };

type PostFail = { status: number; body: unknown } | null;

function setup(opts: { postFail?: PostFail } = {}) {
  const fn = mockApi({
    'GET /tenants': () => json(TENANTS_OK),
    'GET /tenants/status': () => json(TENANT_STATUS_OK),
    'GET /packages?tenantId=DEV': () => json(PACKAGES),
    'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
    'GET /transport/history': () => json([SAVED_REAL, SAVED_PREVIEW]),
    'POST /transport': (init) => {
      if (opts.postFail) return json(opts.postFail.body, opts.postFail.status);
      const body = JSON.parse(init?.body as string);
      return json({ ...PREVIEW_RESULT, transportId: body.dryRun ? 't-preview-1' : 't-real-1', dryRun: body.dryRun, deploy: body.deploy });
    },
  });
  render(<App />);
  return fn;
}

async function pickPackage() {
  await userEvent.click(await screen.findByRole('radio', { name: /Transport Demo/ }));
  await screen.findByRole('checkbox', { name: /IF_Order_Sync/ });
}
const postBodies = (fn: ReturnType<typeof mockApi>) =>
  fn.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => JSON.parse(c[1]?.body as string));

/** 화면에 보이는 글자와 보조기술이 읽는 값: 본문 텍스트, aria-label·title·alt·placeholder·value, aria-labelledby 대상, label 글자. */
function surfaceTexts(): string[] {
  const out: string[] = [document.body.textContent ?? ''];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    for (const attr of ['aria-label', 'title', 'alt', 'placeholder', 'value', 'aria-description']) {
      const v = el.getAttribute(attr);
      if (v) out.push(v);
    }
    const prop = (el as HTMLInputElement).value;
    if (typeof prop === 'string' && prop) out.push(prop);
    for (const id of (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) {
      out.push(document.getElementById(id)?.textContent ?? '');
    }
    for (const label of Array.from((el as HTMLInputElement).labels ?? [])) out.push(label.textContent ?? '');
  }
  return out;
}
function expectNoOldTerm(where: string) {
  expect(surfaceTexts().filter((t) => t.includes(OLD_TERM)), where).toEqual([]);
}

afterEach(() => vi.unstubAllGlobals());

describe('미리보기 명칭 (REQ-319)', () => {
  it('REQ-319 AC-1: 실행 방식 제목·실행 버튼·결과 머리 배지·이력 배지·탭 설명이 "미리보기"다', async () => {
    setup();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText(/미리보기로 변경 내용을 먼저 확인할 수 있습니다\.$/)).toBeInTheDocument();
    expect(within(panel).getByText('DEV 테넌트의 패키지를 PRD 테넌트로 이관합니다. 미리보기로 변경 내용을 먼저 확인할 수 있습니다.')).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: '미리보기' })).toBeChecked();
    await pickPackage();
    // 설명 문장은 그대로다(테넌트 정보가 자리 잡은 뒤의 요소로 확인한다).
    expect(screen.getByRole('radio', { name: '미리보기' })).toHaveAccessibleDescription('PRD에 요청을 보내지 않고 변경 내용만 확인합니다');
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    const result = await screen.findByRole('region', { name: '이관 결과' });
    expect(within(result).getByText('미리보기')).toBeInTheDocument();
    expect(within(result).queryByText('실제 이관')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('실제 이관')).toBeInTheDocument();
    expect(within(rows[1]).getByText('미리보기')).toBeInTheDocument();
  });

  it('REQ-319 AC-2: 이관·결과·이력·테넌트 탭, 확인 대화상자, 오류 안내의 글자와 접근 가능한 이름에 옛 명칭이 없다', async () => {
    const fn = setup();
    // 검사가 비어 있지 않음을 먼저 확인한다(새 명칭을 읽고 있다).
    expect(surfaceTexts().some((t) => t.includes('미리보기'))).toBe(true);
    expectNoOldTerm('이관 탭');
    await pickPackage();
    expectNoOldTerm('이관 탭(패키지 선택 뒤)');
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expectNoOldTerm('결과');
    // 확인 대화상자: 실제 이관을 고르고 이관 버튼을 누른다(요청은 보내지 않는다).
    await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
    await userEvent.click(screen.getByRole('button', { name: 'PRD로 이관' }));
    expect(await screen.findByRole('dialog', { name: '실제 이관 확인' })).toBeInTheDocument();
    expectNoOldTerm('확인 대화상자');
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(postBodies(fn)).toHaveLength(1);
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    await screen.findByRole('table');
    expectNoOldTerm('이력 탭');
    await userEvent.click(screen.getByRole('button', { name: 't-saved-preview' }));
    await screen.findByRole('button', { name: '목록으로' });
    expectNoOldTerm('이력 상세');
    await userEvent.click(screen.getByRole('tab', { name: '테넌트' }));
    await screen.findByRole('tabpanel');
    expectNoOldTerm('테넌트 탭');
  });

  it('REQ-319 AC-2: POST /transport 실패 응답의 오류 안내에도 옛 명칭이 없다', async () => {
    setup({ postFail: { status: 502, body: { error: 'CPI_UNAVAILABLE', message: 'CPI 응답 없음' } } });
    await pickPackage();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('CPI에 연결할 수 없습니다');
    expectNoOldTerm('오류 안내');
  });

  it('REQ-319 AC-3: 미리보기 요청 본문은 dryRun:true·deploy:false이고 기본 선택이 미리보기이며 배포 스위치는 실제 이관에서만 있다', async () => {
    const fn = setup();
    expect(await screen.findByRole('radio', { name: '미리보기' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '실제 이관' })).not.toBeChecked();
    expect(screen.queryByRole('switch', { name: '배포' })).toBeNull();
    await pickPackage();
    await userEvent.click(screen.getByRole('checkbox', { name: /IF_Order_Sync/ }));
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    const result = await screen.findByRole('region', { name: '이관 결과' });
    // 요청·응답 형식은 그대로다.
    expect(postBodies(fn)).toEqual([
      { packageId: 'PkgTransportDemo', artifactIds: ['IF_Order_Sync'], dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' },
    ]);
    expect(within(result).getByText('t-preview-1')).toBeInTheDocument();
    // 실제 이관을 고르면 배포 스위치가 나오고, 미리보기로 돌아오면 사라진다.
    await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
    expect(screen.getByRole('switch', { name: '배포' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: '미리보기' }));
    expect(screen.queryByRole('switch', { name: '배포' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeEnabled());
  });

  it('REQ-319 AC-3·AC-5: 이전 버전이 저장한 이력(dryRun:true)이 "미리보기"로 보이고 옛 명칭 부재 검사가 실제로 옛 명칭을 잡아낸다', async () => {
    setup();
    await userEvent.click(screen.getByRole('tab', { name: '이력' }));
    await screen.findByRole('table');
    const saved = screen.getByRole('button', { name: 't-saved-preview' }).closest('tr') as HTMLElement;
    expect(within(saved).getByText('미리보기')).toBeInTheDocument();
    expect(within(saved).queryByText(OLD_TERM)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 't-saved-preview' }));
    const detail = await screen.findByRole('region', { name: '이관 결과' });
    expect(within(detail).getByText('미리보기')).toBeInTheDocument();
    // 부재 검사가 비어 있지 않음(AC-5): 옛 명칭이 글자·속성·label에 있으면 검사가 잡아낸다.
    const probe = document.createElement('button');
    probe.setAttribute('aria-label', `${OLD_TERM} 실행`);
    document.body.appendChild(probe);
    expect(surfaceTexts().filter((t) => t.includes(OLD_TERM))).toHaveLength(1);
    probe.remove();
    expectNoOldTerm('이력 상세');
  });
});
