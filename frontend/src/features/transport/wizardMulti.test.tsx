import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportRequest } from '../../api/types';
import { ARTIFACTS, PACKAGES, json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';
import {
  currentStep, findPackageCheckbox, findPackageSection, packageCheckbox, packageSection, postBodies, startManual, stepButton,
} from '../../test/wizard';

// 20261118 S3 REQ-620 패키지 여러 개 선택, REQ-621 아티팩트 패키지별 묶음, REQ-622 확인창의 대상 패키지 상태.
// 화면 구조(입력 패키지에 적은 계약):
// - 패키지 단계: list "패키지 목록"의 checkbox(접근 이름에 이름·ID·버전), 버튼 "전체 선택"·"선택 해제", 글자 "n개 선택".
//   요청·묶음 순서는 클릭 순서가 아니라 원본 목록 순서다.
// - 아티팩트 단계: 고른 패키지마다 region(접근 이름에 이름과 ID), 그 안에 grid "이관할 아티팩트"·"n개 선택 / 전체 m개"·"전체 선택"·"선택 해제".
//   맨 위 "모두 선택"·"모두 해제".
// - 확인창: list "대상 패키지"의 listitem(접근 이름에 이름과 ID)마다 "있음" 또는 "대상에 없음 → 새로 만듦".
afterEach(() => vi.unstubAllGlobals());

const FAULT_ARTS = [{ id: 'IF_Fault_A', name: 'Fault A', version: '1.0.0' }];
const NEW_ARTS = [{ id: 'IF_New_A', name: 'New A', version: '1.0.0' }];
const STATUS_URL = 'GET /packages/target-status?tenantId=PRD&packageIds=PkgTransportDemo,PkgNotInPrd';
const TARGET_STATUS = [{ packageId: 'PkgTransportDemo', exists: true }, { packageId: 'PkgNotInPrd', exists: false }];
const CREATE_NOTICE = '패키지 1개를 대상에 새로 만듭니다. 이관이 실패해도 만든 패키지는 남습니다';

function setup(extra: Parameters<typeof mockApi>[0] = {}) {
  const fn = mockApi(
    baseRoutes({
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
      'GET /packages/PkgFaultDemo/artifacts?tenantId=DEV': () => json(FAULT_ARTS),
      'GET /packages/PkgNotInPrd/artifacts?tenantId=DEV': () => json(NEW_ARTS),
      [STATUS_URL]: () => json(TARGET_STATUS),
      'POST /transport': (init) => json(respondTo(JSON.parse(init?.body as string) as TransportRequest)),
      ...extra,
    }),
  );
  renderAt('#/transport');
  return fn;
}
const calls = (fn: ReturnType<typeof mockApi>, url: string) => fn.mock.calls.filter(([u]) => u === url).length;
const search = () => screen.findByLabelText('패키지 검색');
const confirmDialog = () => screen.getByRole('dialog', { name: '실제 이관 확인' });
const deferred = () => {
  let release: (r: Response) => void = () => {};
  const promise = new Promise<Response>((r) => { release = r; });
  return { promise, release: (r: Response) => release(r) };
};

/** 템플릿 없이 진행 → 두 패키지(Transport Demo, Not In PRD) → 아티팩트 단계 → 미리보기 → 확인창 열기 */
async function openConfirmForTwo() {
  await startManual();
  await userEvent.click(await findPackageCheckbox(/Transport Demo/));
  await userEvent.click(packageCheckbox(/Not In PRD/));
  await userEvent.click(screen.getByRole('button', { name: '다음' }));
  await findPackageSection('PkgNotInPrd');
  await within(packageSection('PkgTransportDemo')).findByRole('grid', { name: '이관할 아티팩트' });
  await within(packageSection('PkgNotInPrd')).findByRole('grid', { name: '이관할 아티팩트' });
  await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
  const region = await screen.findByRole('region', { name: '이관 결과' });
  await userEvent.click(within(region).getByRole('button', { name: '이 구성으로 실제 이관' }));
  return confirmDialog();
}

describe('REQ-620 패키지 여러 개 선택', () => {
  it('REQ-620: 패키지 목록은 체크 목록이고 여러 개를 고를 수 있으며 "n개 선택"이 보인다', async () => {
    setup();
    await startManual();
    const list = await screen.findByRole('list', { name: '패키지 목록' });
    expect(within(list).queryAllByRole('radio')).toHaveLength(0);
    expect(within(list).getAllByRole('checkbox')).toHaveLength(PACKAGES.length);
    expect(screen.getByText('0개 선택')).toBeInTheDocument();
    await userEvent.click(packageCheckbox(/Transport Demo/));
    await userEvent.click(packageCheckbox(/Fault Demo/));
    expect(packageCheckbox(/Transport Demo/)).toBeChecked();
    expect(packageCheckbox(/Fault Demo/)).toBeChecked();
    expect(screen.getByText('2개 선택')).toBeInTheDocument();
    await userEvent.click(packageCheckbox(/Transport Demo/));
    expect(packageCheckbox(/Transport Demo/)).not.toBeChecked();
    expect(screen.getByText('1개 선택')).toBeInTheDocument();
  });

  it('REQ-620: "전체 선택"은 지금 검색으로 보이는 패키지만 더하고, 검색을 바꿔도 선택은 유지된다. "선택 해제"는 모두 해제한다', async () => {
    setup();
    await startManual();
    await userEvent.type(await search(), 'demo');
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    expect(screen.getByText('2개 선택')).toBeInTheDocument();
    await userEvent.clear(await search());
    await userEvent.type(await search(), 'notin');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(packageCheckbox(/Not In PRD/)).not.toBeChecked();
    expect(screen.getByText('2개 선택')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    expect(screen.getByText('3개 선택')).toBeInTheDocument();
    await userEvent.clear(await search());
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
    await userEvent.type(await search(), 'fault');
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    await userEvent.clear(await search());
    expect(screen.getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText('0개 선택')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  });

  it('REQ-620 실패: 검색 결과가 0개면 "전체 선택"은 비활성이다', async () => {
    setup();
    await startManual();
    await userEvent.type(await search(), 'zzz');
    expect(screen.getByText('검색 결과가 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '전체 선택' })).toBeDisabled();
  });

  it('REQ-620: 단계 요약은 1개면 패키지 이름, 여러 개면 "<첫 이름> 외 n개"이고 순서는 원본 목록 순서다', async () => {
    const fn = setup();
    await startManual();
    await userEvent.click(await findPackageCheckbox(/Not In PRD/));
    expect(stepButton('패키지')).toHaveTextContent('Not In PRD');
    expect(stepButton('패키지')).not.toHaveTextContent('외');
    await userEvent.click(packageCheckbox(/Fault Demo/));
    await userEvent.click(packageCheckbox(/Transport Demo/));
    expect(stepButton('패키지')).toHaveTextContent('Transport Demo 외 2개');
    await userEvent.click(screen.getByRole('button', { name: '전체 아티팩트로 미리보기' }));
    await screen.findByRole('region', { name: '이관 결과' });
    // 패키지 단계에서 바로 미리보기: 패키지마다 artifactIds 없이(패키지 전체)
    expect(postBodies(fn)).toEqual([{
      packages: [{ packageId: 'PkgTransportDemo' }, { packageId: 'PkgFaultDemo' }, { packageId: 'PkgNotInPrd' }],
      dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD',
    }]);
  });

  it('REQ-620: 키보드 — Tab으로 체크 목록과 "전체 선택"·"선택 해제"에 닿고 Space로 체크한다', async () => {
    const user = userEvent.setup({ delay: null });
    setup();
    await user.click(await screen.findByRole('button', { name: '템플릿 없이 진행' }));
    const first = await findPackageCheckbox(/Transport Demo/);
    document.body.focus();
    const seen: HTMLElement[] = [];
    for (let i = 0; i < 80; i++) {
      await user.tab();
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || seen.includes(el)) break;
      seen.push(el);
    }
    expect(seen).toContain(first);
    expect(seen).toContain(packageCheckbox(/Not In PRD/));
    expect(seen).toContain(screen.getByRole('button', { name: '전체 선택' }));
    expect(seen).toContain(screen.getByRole('button', { name: '선택 해제' }));
    first.focus();
    await user.keyboard(' ');
    expect(first).toBeChecked();
    expect(screen.getByText('1개 선택')).toBeInTheDocument();
  });
});

describe('REQ-621 아티팩트 패키지별 묶음', () => {
  async function toTwo() {
    await startManual();
    await userEvent.click(await findPackageCheckbox(/Fault Demo/));
    await userEvent.click(packageCheckbox(/Transport Demo/));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await within(await findPackageSection('PkgTransportDemo')).findByRole('grid', { name: '이관할 아티팩트' });
    await within(await findPackageSection('PkgFaultDemo')).findByRole('grid', { name: '이관할 아티팩트' });
  }

  it('REQ-621: 고른 패키지마다 제목(이름·ID)과 아티팩트 표를 원본 목록 순서로 보이고 처음엔 모두 선택돼 있다', async () => {
    const fn = setup();
    await toTwo();
    expect(currentStep()).toBe('아티팩트');
    const transport = packageSection('PkgTransportDemo');
    const fault = packageSection('PkgFaultDemo');
    expect(transport).toHaveAccessibleName(expect.stringContaining('Transport Demo'));
    expect(fault).toHaveAccessibleName(expect.stringContaining('Fault Demo'));
    expect(transport.compareDocumentPosition(fault) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const row of within(transport).getAllByRole('row')) expect(row).toHaveAttribute('aria-selected', 'true');
    for (const row of within(fault).getAllByRole('row')) expect(row).toHaveAttribute('aria-selected', 'true');
    expect(within(transport).getByText('2개 선택 / 전체 2개')).toBeInTheDocument();
    expect(within(fault).getByText('1개 선택 / 전체 1개')).toBeInTheDocument();
    expect(calls(fn, '/packages/PkgTransportDemo/artifacts?tenantId=DEV')).toBe(1);
    expect(calls(fn, '/packages/PkgFaultDemo/artifacts?tenantId=DEV')).toBe(1);
  });

  it('REQ-621: 패키지별 "선택 해제"로 0개가 된 패키지는 이관에서 빠지고, 일부만 고른 패키지는 고른 ID를 보낸다', async () => {
    const fn = setup();
    await toTwo();
    const transport = packageSection('PkgTransportDemo');
    await userEvent.click(within(transport).getByRole('row', { name: /IF_Order_Sync/ }));
    expect(stepButton('아티팩트')).toHaveTextContent('2 / 3');
    await userEvent.click(within(packageSection('PkgFaultDemo')).getByRole('button', { name: '선택 해제' }));
    expect(within(packageSection('PkgFaultDemo')).getByText('0개 선택 / 전체 1개')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)).toEqual([{
      packages: [{ packageId: 'PkgTransportDemo', artifactIds: ['IF_Customer_Push'] }],
      dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD',
    }]);
  });

  it('REQ-621: 맨 위 "모두 해제"는 모든 패키지를 비워 미리보기를 막고, "모두 선택"은 모든 패키지를 다시 전부 고른다(패키지 전체로 보냄)', async () => {
    const fn = setup();
    await toTwo();
    await userEvent.click(screen.getByRole('button', { name: '모두 해제' }));
    for (const id of ['PkgTransportDemo', 'PkgFaultDemo']) {
      for (const row of within(packageSection(id)).getAllByRole('row')) expect(row).toHaveAttribute('aria-selected', 'false');
    }
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
    expect(screen.getByText('아티팩트를 하나 이상 선택하세요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '모두 선택' }));
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)[0].packages).toEqual([{ packageId: 'PkgTransportDemo' }, { packageId: 'PkgFaultDemo' }]);
    expect(stepButton('아티팩트')).toHaveTextContent('전체');
  });

  it('REQ-621 실패: 한 패키지의 목록 조회가 실패하면 그 자리에 오류와 "다시 시도"를 보이고 다른 패키지는 고를 수 있으며, 미리보기는 막힌다(사람 결정 2026-11-18)', async () => {
    let fail = true;
    const fn = setup({
      'GET /packages/PkgFaultDemo/artifacts?tenantId=DEV': () => (fail ? json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) : json(FAULT_ARTS)),
    });
    await startManual();
    await userEvent.click(await findPackageCheckbox(/Fault Demo/));
    await userEvent.click(packageCheckbox(/Transport Demo/));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    const fault = await findPackageSection('PkgFaultDemo');
    const alert = await within(fault).findByRole('alert');
    expect(alert).toHaveTextContent('CPI에 연결할 수 없습니다');
    const transport = packageSection('PkgTransportDemo');
    const row = await within(transport).findByRole('row', { name: /IF_Order_Sync/ });
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));
    expect(await within(packageSection('PkgFaultDemo')).findByRole('grid', { name: '이관할 아티팩트' })).toBeInTheDocument();
    expect(calls(fn, '/packages/PkgFaultDemo/artifacts?tenantId=DEV')).toBe(2);
    expect(calls(fn, '/packages/PkgTransportDemo/artifacts?tenantId=DEV')).toBe(1);
    await waitFor(() => expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeEnabled());
    // 다시 불러와도 다른 패키지의 선택은 그대로다
    expect(within(packageSection('PkgTransportDemo')).getByRole('row', { name: /IF_Order_Sync/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('REQ-621: 아티팩트가 0개인 패키지는 빈 상태를 보이고 이관에서 빠진다', async () => {
    const fn = setup({ 'GET /packages/PkgFaultDemo/artifacts?tenantId=DEV': () => json([]) });
    await startManual();
    await userEvent.click(await findPackageCheckbox(/Fault Demo/));
    await userEvent.click(packageCheckbox(/Transport Demo/));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await within(await findPackageSection('PkgFaultDemo')).findByText('아티팩트가 없습니다')).toBeInTheDocument();
    await within(packageSection('PkgTransportDemo')).findByRole('grid', { name: '이관할 아티팩트' });
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)[0].packages).toEqual([{ packageId: 'PkgTransportDemo' }]);
  });
});

describe('REQ-622 확인창의 대상 패키지 상태', () => {
  it('REQ-622 / ADR-002: 미리보기는 대상 패키지를 읽지 않고, 확인창을 열 때 한 번 읽어 패키지마다 "있음"·"대상에 없음 → 새로 만듦"과 안내를 보인다', async () => {
    const fn = setup();
    const dialog = await openConfirmForTwo();
    const list = within(dialog).getByRole('list', { name: '대상 패키지' });
    const existing = within(list).getByRole('listitem', { name: /PkgTransportDemo/ });
    const created = within(list).getByRole('listitem', { name: /PkgNotInPrd/ });
    await waitFor(() => expect(existing).toHaveTextContent('있음'));
    expect(existing).toHaveTextContent('Transport Demo');
    expect(existing).not.toHaveTextContent('새로 만듦');
    expect(created).toHaveTextContent('Not In PRD');
    expect(created).toHaveTextContent('대상에 없음 → 새로 만듦');
    expect(dialog).toHaveTextContent(CREATE_NOTICE);
    expect(calls(fn, STATUS_URL.slice(4))).toBe(1);
    // 미리보기 요청 뒤, 확인창을 열기 전까지 대상 확인 요청은 없었다
    const order = fn.mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${String(u)}`);
    expect(order.indexOf(STATUS_URL)).toBeGreaterThan(order.indexOf('POST /transport'));
  });

  it('REQ-622: "실행"이 "새로 만듦" 패키지의 승인이다 — createPackages로 그 패키지만 보낸다', async () => {
    const fn = setup();
    const dialog = await openConfirmForTwo();
    const run = within(dialog).getByRole('button', { name: '실행' });
    await waitFor(() => expect(run).toBeEnabled());
    await userEvent.click(run);
    await waitFor(() => expect(postBodies(fn)).toHaveLength(2));
    expect(postBodies(fn)[0]).not.toHaveProperty('createPackages');
    expect(postBodies(fn)[1]).toEqual({
      packages: [{ packageId: 'PkgTransportDemo' }, { packageId: 'PkgNotInPrd' }],
      createPackages: ['PkgNotInPrd'],
      dryRun: false, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD',
      // 20261121-perf-retry REQ-902: 미리보기 뒤 실제 이관은 그 미리보기 ID를 보낸다.
      previewId: 't-dry',
    });
  });

  it('REQ-622: 대상 확인 중에는 "실행"이 비활성이다', async () => {
    const pending = deferred();
    setup({ [STATUS_URL]: () => pending.promise });
    const dialog = await openConfirmForTwo();
    const run = within(dialog).getByRole('button', { name: '실행' });
    expect(run).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '취소' })).toBeEnabled();
    pending.release(json(TARGET_STATUS));
    await waitFor(() => expect(run).toBeEnabled());
  });

  it('REQ-622 실패: 대상 확인에 실패하면 "대상 패키지를 확인하지 못했습니다"와 "다시 시도"를 보이고 "실행"은 비활성이다. 다시 시도가 성공하면 실행할 수 있다', async () => {
    let fail = true;
    const fn = setup({ [STATUS_URL]: () => (fail ? json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) : json(TARGET_STATUS)) });
    const dialog = await openConfirmForTwo();
    expect(await within(dialog).findByText('대상 패키지를 확인하지 못했습니다')).toBeInTheDocument();
    const run = within(dialog).getByRole('button', { name: '실행' });
    expect(run).toBeDisabled();
    fail = false;
    await userEvent.click(within(dialog).getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(run).toBeEnabled());
    expect(within(dialog).queryByText('대상 패키지를 확인하지 못했습니다')).toBeNull();
    expect(calls(fn, STATUS_URL.slice(4))).toBe(2);
    expect(postBodies(fn)).toHaveLength(1);
  });

  it('REQ-622: 모두 대상에 있으면 안내가 없고 createPackages 키를 보내지 않는다', async () => {
    const fn = setup({ [STATUS_URL]: () => json(TARGET_STATUS.map((s) => ({ ...s, exists: true }))) });
    const dialog = await openConfirmForTwo();
    const run = within(dialog).getByRole('button', { name: '실행' });
    await waitFor(() => expect(run).toBeEnabled());
    expect(dialog).not.toHaveTextContent('새로 만듦');
    expect(dialog).not.toHaveTextContent('대상에 새로 만듭니다');
    await userEvent.click(run);
    await waitFor(() => expect(postBodies(fn)).toHaveLength(2));
    expect(postBodies(fn)[1]).not.toHaveProperty('createPackages');
  });
});
