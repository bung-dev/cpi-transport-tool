import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportRequest } from '../../api/types';
import { ARTIFACTS, PACKAGES, json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';
import {
  NO_TYPES, TYPE_GROUPS, currentStep, findPackageSection, postBodies, startManual, typeGroup, typeListUrl,
} from '../../test/wizard';

// 20261121-package-objects S5 REQ-1002(3단계 종류별 고르기)·REQ-1003(요청의 종류별 Id 목록).
// 구조는 test/wizard.ts의 TYPE_GROUPS 설명을 따른다. iFlow 목록 실패 규칙은 지금 그대로다(사람 결정 2026-11-22, wizardArtifacts·wizardMulti).
afterEach(() => vi.unstubAllGlobals());

const PKG = 'PkgTransportDemo';
const IFLOW_URL = `/packages/${PKG}/artifacts?tenantId=DEV`;
const obj = (id: string) => ({ id, name: `${id} 이름`, version: '1.0.0' });
const SC = [obj('SC_Common')];
const MM = [obj('MM_Order_A'), obj('MM_Order_B')];
const NONE_SELECTED = '아티팩트를 하나 이상 선택하세요';
const LIST_FAILED = '목록을 읽지 못했습니다';

type Routes = Parameters<typeof mockApi>[0];
function setup(opts: { iflows?: unknown; sc?: Routes[string]; mm?: Routes[string]; vm?: Routes[string]; extra?: Routes } = {}) {
  const fn = mockApi(
    baseRoutes({
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      [`GET ${IFLOW_URL}`]: () => json(opts.iflows ?? ARTIFACTS),
      [`GET ${typeListUrl(PKG, 'SCRIPT_COLLECTION')}`]: opts.sc ?? (() => json(SC)),
      [`GET ${typeListUrl(PKG, 'MESSAGE_MAPPING')}`]: opts.mm ?? (() => json(MM)),
      [`GET ${typeListUrl(PKG, 'VALUE_MAPPING')}`]: opts.vm ?? (() => json([])),
      'POST /transport': (init) => json(respondTo(JSON.parse(init?.body as string) as TransportRequest)),
      ...opts.extra,
    }),
  );
  renderAt('#/transport');
  return fn;
}
const calls = (fn: ReturnType<typeof mockApi>, url: string) => fn.mock.calls.filter(([u]) => u === url).length;
const previewButton = () => screen.getByRole('button', { name: '미리보기 실행' });
const deferred = () => {
  let release: (r: Response) => void = () => {};
  const promise = new Promise<Response>((r) => { release = r; });
  return { promise, release: (r: Response) => release(r) };
};
/** 템플릿 없이 진행 → Transport Demo → "다음". 패키지 region을 돌려준다. */
async function toTypes() {
  await startManual();
  await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
  await userEvent.click(screen.getByRole('button', { name: '다음' }));
  return findPackageSection(PKG);
}
/** 패키지 region과 그 안의 종류 묶음이 모두 목록을 읽을 때까지 기다린다. */
async function loadedSection() {
  const section = await toTypes();
  await within(typeGroup(section, 'iFlow')).findByRole('grid', { name: '이관할 아티팩트' });
  await within(typeGroup(section, '메시지 매핑')).findByRole('grid', { name: '이관할 아티팩트' });
  return section;
}
const rows = (group: HTMLElement) => within(group).getAllByRole('row');
const row = (group: HTMLElement, id: string) => within(group).getByRole('row', { name: new RegExp(`(^|\\s)${id}(\\s|$)`) });
const runPreview = async () => {
  await userEvent.click(previewButton());
  await screen.findByRole('region', { name: '이관 결과' });
};

describe('REQ-1002 종류별 묶음', () => {
  it('REQ-1002: 패키지를 펼치면 iFlow·스크립트 컬렉션·메시지 매핑·밸류 매핑 묶음이 이 순서로 있고, 처음엔 모두 선택이며 묶음마다 선택 수와 "전체 선택"·"선택 해제"가 있다', async () => {
    const fn = setup();
    const section = await loadedSection();
    const groups = TYPE_GROUPS.map((name) => typeGroup(section, name));
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].compareDocumentPosition(groups[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${TYPE_GROUPS[i - 1]} 다음 ${TYPE_GROUPS[i]}`).toBeTruthy();
    }
    const [iflow, sc, mm] = groups;
    expect(rows(iflow)).toHaveLength(2);
    expect(rows(sc)).toHaveLength(1);
    expect(rows(mm)).toHaveLength(2);
    for (const g of [iflow, sc, mm]) {
      for (const r of rows(g)) expect(r).toHaveAttribute('aria-selected', 'true');
      expect(within(g).getByRole('button', { name: '전체 선택' })).toBeInTheDocument();
      expect(within(g).getByRole('button', { name: '선택 해제' })).toBeInTheDocument();
    }
    expect(within(iflow).getByText('선택 2/2')).toBeInTheDocument();
    expect(within(sc).getByText('선택 1/1')).toBeInTheDocument();
    expect(within(mm).getByText('선택 2/2')).toBeInTheDocument();
    // 패키지 선택 수 줄은 종류를 합친 수다
    expect(within(section).getByText('5개 선택 / 전체 5개')).toBeInTheDocument();
    for (const type of ['SCRIPT_COLLECTION', 'MESSAGE_MAPPING', 'VALUE_MAPPING'] as const) {
      expect(calls(fn, typeListUrl(PKG, type)), type).toBe(1);
    }
    expect(calls(fn, IFLOW_URL)).toBe(1);
  });

  it('REQ-1002: 빈 종류는 묶음 제목 아래 "없음"이고 표·선택 버튼이 없다', async () => {
    setup();
    const section = await loadedSection();
    const vm = typeGroup(section, '밸류 매핑');
    expect(within(vm).getByText('없음')).toBeInTheDocument();
    expect(within(vm).queryByRole('grid')).toBeNull();
    expect(within(vm).queryByRole('button', { name: '전체 선택' })).toBeNull();
  });

  it('REQ-1002: iFlow가 0개이고 새 종류가 있는 패키지는 iFlow 묶음이 "없음"이고 "아티팩트가 없습니다"가 아니며 미리보기를 할 수 있다', async () => {
    setup({ iflows: [] });
    const section = await toTypes();
    await within(typeGroup(section, '스크립트 컬렉션')).findByRole('grid', { name: '이관할 아티팩트' });
    await within(typeGroup(section, '메시지 매핑')).findByRole('grid', { name: '이관할 아티팩트' });
    expect(within(typeGroup(section, 'iFlow')).getByText('없음')).toBeInTheDocument();
    expect(screen.queryByText('아티팩트가 없습니다')).toBeNull();
    expect(within(section).getByText('3개 선택 / 전체 3개')).toBeInTheDocument();
    expect(previewButton()).toBeEnabled();
  });

  it('REQ-1002: 묶음의 "선택 해제"·"전체 선택"·행 클릭은 그 묶음만 바꾸고 묶음 수와 패키지 합계가 함께 바뀐다', async () => {
    setup();
    const section = await loadedSection();
    const iflow = typeGroup(section, 'iFlow');
    const mm = typeGroup(section, '메시지 매핑');
    await userEvent.click(within(mm).getByRole('button', { name: '선택 해제' }));
    for (const r of rows(mm)) expect(r).toHaveAttribute('aria-selected', 'false');
    for (const r of rows(iflow)) expect(r).toHaveAttribute('aria-selected', 'true');
    expect(within(mm).getByText('선택 0/2')).toBeInTheDocument();
    expect(within(section).getByText('3개 선택 / 전체 5개')).toBeInTheDocument();
    await userEvent.click(row(mm, 'MM_Order_B'));
    expect(row(mm, 'MM_Order_B')).toHaveAttribute('aria-selected', 'true');
    expect(within(mm).getByText('선택 1/2')).toBeInTheDocument();
    expect(within(section).getByText('4개 선택 / 전체 5개')).toBeInTheDocument();
    await userEvent.click(within(mm).getByRole('button', { name: '전체 선택' }));
    expect(within(mm).getByText('선택 2/2')).toBeInTheDocument();
    expect(within(section).getByText('5개 선택 / 전체 5개')).toBeInTheDocument();
  });

  it('REQ-1002: 맨 위 "모두 해제"는 모든 종류를 비워 미리보기를 막고, "모두 선택"은 모든 종류를 다시 전부 고른다', async () => {
    setup();
    const section = await loadedSection();
    await userEvent.click(screen.getByRole('button', { name: '모두 해제' }));
    expect(within(section).getByText('0개 선택 / 전체 5개')).toBeInTheDocument();
    expect(screen.getByText(NONE_SELECTED)).toBeInTheDocument();
    expect(previewButton()).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '모두 선택' }));
    expect(within(section).getByText('5개 선택 / 전체 5개')).toBeInTheDocument();
    for (const name of ['iFlow', '스크립트 컬렉션', '메시지 매핑'] as const) {
      for (const r of rows(typeGroup(section, name))) expect(r, name).toHaveAttribute('aria-selected', 'true');
    }
    expect(previewButton()).toBeEnabled();
  });

  it('REQ-1002: 새 종류 목록을 읽는 동안 그 묶음은 불러오는 중(role=status)이고 미리보기는 막히며, 다 읽으면 풀린다', async () => {
    const mm = deferred();
    setup({ mm: () => mm.promise });
    const section = await toTypes();
    await within(typeGroup(section, 'iFlow')).findByRole('grid', { name: '이관할 아티팩트' });
    expect(within(typeGroup(section, '메시지 매핑')).getByRole('status')).toHaveTextContent('불러오는 중');
    expect(previewButton()).toBeDisabled();
    mm.release(json(MM));
    await within(typeGroup(section, '메시지 매핑')).findByRole('grid', { name: '이관할 아티팩트' });
    await waitFor(() => expect(previewButton()).toBeEnabled());
  });
});

describe('REQ-1002 실패: 새 종류 목록 오류', () => {
  it('REQ-1002 실패: 한 종류 목록이 실패하면 그 묶음에만 "목록을 읽지 못했습니다"(role=alert)와 "다시 읽기"가 보이고, 나머지로 미리보기를 할 수 있다(실패한 종류는 0개)', async () => {
    const fn = setup({ mm: () => json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) });
    const section = await toTypes();
    const mm = typeGroup(section, '메시지 매핑');
    const alert = await within(mm).findByRole('alert');
    expect(alert).toHaveTextContent(LIST_FAILED);
    expect(within(alert).getByRole('button', { name: '다시 읽기' })).toBeInTheDocument();
    await within(typeGroup(section, 'iFlow')).findByRole('grid', { name: '이관할 아티팩트' });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(section).getByText('3개 선택 / 전체 3개')).toBeInTheDocument();
    expect(previewButton()).toBeEnabled();
    await runPreview();
    expect(postBodies(fn)[0].packages).toEqual([{ packageId: PKG, scriptCollectionIds: ['SC_Common'], messageMappingIds: [], valueMappingIds: [] }]);
  });

  it('REQ-1002 실패: "다시 읽기"는 그 종류 목록만 다시 부르고, 성공하면 표가 보이며 모두 선택이다. 다른 묶음의 선택은 그대로다', async () => {
    let fail = true;
    const fn = setup({ mm: () => (fail ? json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) : json(MM)) });
    const section = await toTypes();
    const alert = await within(typeGroup(section, '메시지 매핑')).findByRole('alert');
    const iflow = typeGroup(section, 'iFlow');
    await within(iflow).findByRole('grid', { name: '이관할 아티팩트' });
    await userEvent.click(row(iflow, 'IF_Order_Sync'));
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: '다시 읽기' }));
    const mm = typeGroup(section, '메시지 매핑');
    await within(mm).findByRole('grid', { name: '이관할 아티팩트' });
    for (const r of rows(mm)) expect(r).toHaveAttribute('aria-selected', 'true');
    expect(within(mm).queryByRole('alert')).toBeNull();
    expect(row(typeGroup(section, 'iFlow'), 'IF_Order_Sync')).toHaveAttribute('aria-selected', 'false');
    expect(calls(fn, typeListUrl(PKG, 'MESSAGE_MAPPING'))).toBe(2);
    expect(calls(fn, typeListUrl(PKG, 'SCRIPT_COLLECTION'))).toBe(1);
    expect(calls(fn, IFLOW_URL)).toBe(1);
  });

  it('REQ-1002 실패: 실패한 종류 말고 고른 것이 없으면 미리보기를 할 수 없다', async () => {
    setup({ iflows: [], sc: () => json([]), mm: () => json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) });
    const section = await toTypes();
    await within(typeGroup(section, '메시지 매핑')).findByRole('alert');
    await waitFor(() => expect(within(typeGroup(section, '스크립트 컬렉션')).getByText('없음')).toBeInTheDocument());
    expect(previewButton()).toBeDisabled();
  });
});

describe('REQ-1003 요청의 종류별 Id 목록', () => {
  it('REQ-1003: 건드리지 않으면 iFlow는 지금처럼 artifactIds 없이, 새 종류는 고른 Id 목록(빈 종류는 [])을 항상 보낸다', async () => {
    const fn = setup();
    await loadedSection();
    await runPreview();
    expect(postBodies(fn)).toEqual([{
      packages: [{ packageId: PKG, scriptCollectionIds: ['SC_Common'], messageMappingIds: ['MM_Order_A', 'MM_Order_B'], valueMappingIds: [] }],
      dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD',
    }]);
  });

  it('REQ-1003: iFlow를 하나도 고르지 않고 새 종류만 고르면 artifactIds: []를 보내고, 새 종류는 목록 순서로 고른 것만 보낸다', async () => {
    const fn = setup();
    const section = await loadedSection();
    await userEvent.click(within(typeGroup(section, 'iFlow')).getByRole('button', { name: '선택 해제' }));
    await userEvent.click(row(typeGroup(section, '메시지 매핑'), 'MM_Order_A'));
    await runPreview();
    expect(postBodies(fn)[0].packages).toEqual([
      { packageId: PKG, artifactIds: [], scriptCollectionIds: ['SC_Common'], messageMappingIds: ['MM_Order_B'], valueMappingIds: [] },
    ]);
  });

  it('REQ-1003: iFlow를 일부만 고르면 지금처럼 고른 iFlow Id를 보내고, 새 종류를 모두 해제하면 그 종류는 []다', async () => {
    const fn = setup();
    const section = await loadedSection();
    await userEvent.click(row(typeGroup(section, 'iFlow'), 'IF_Order_Sync'));
    await userEvent.click(within(typeGroup(section, '스크립트 컬렉션')).getByRole('button', { name: '선택 해제' }));
    await userEvent.click(within(typeGroup(section, '메시지 매핑')).getByRole('button', { name: '선택 해제' }));
    await runPreview();
    expect(postBodies(fn)[0].packages).toEqual([{ packageId: PKG, artifactIds: ['IF_Customer_Push'], ...NO_TYPES }]);
  });
});

describe('REQ-1002 패키지 단계 "전체 아티팩트로 미리보기"(사람 결정 2026-11-22)', () => {
  it('REQ-1002: 새 종류 목록을 먼저 읽고 iFlow 전부(artifactIds 없음)와 새 종류 전부의 Id 목록을 보낸다', async () => {
    const fn = setup();
    await startManual();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
    await userEvent.click(screen.getByRole('button', { name: '전체 아티팩트로 미리보기' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)).toEqual([{
      packages: [{ packageId: PKG, scriptCollectionIds: ['SC_Common'], messageMappingIds: ['MM_Order_A', 'MM_Order_B'], valueMappingIds: [] }],
      dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD',
    }]);
    for (const type of ['SCRIPT_COLLECTION', 'MESSAGE_MAPPING', 'VALUE_MAPPING'] as const) {
      expect(calls(fn, typeListUrl(PKG, type)), type).toBe(1);
    }
  });

  it('REQ-1002 실패: 새 종류 목록이 하나라도 실패하면 미리보기를 시작하지 않고 아티팩트 단계로 가서 그 묶음의 오류를 보인다', async () => {
    const fn = setup({ vm: () => json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) });
    await startManual();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
    await userEvent.click(screen.getByRole('button', { name: '전체 아티팩트로 미리보기' }));
    const section = await findPackageSection(PKG);
    expect(await within(typeGroup(section, '밸류 매핑')).findByRole('alert')).toHaveTextContent(LIST_FAILED);
    expect(currentStep()).toBe('아티팩트');
    expect(postBodies(fn)).toEqual([]);
    expect(screen.queryByRole('region', { name: '이관 결과' })).toBeNull();
  });
});
