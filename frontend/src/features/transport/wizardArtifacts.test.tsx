import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportRequest } from '../../api/types';
import { PACKAGES, json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt } from '../../test/appRoutes';
import {
  artifactGrid, artifactRow, artifactRows, currentStep, postBodies, selectedIds, startManual, stepButton, toArtifacts, NO_TYPES,
} from '../../test/wizard';

// S3b REQ-422 아티팩트 선택 표. 한 열 grid(aria-multiselectable), 행마다 aria-selected, Tab 진입점은 하나(ADR-012).
// 20261118 S3 REQ-621: 처음엔 모든 아티팩트가 선택돼 있다. 패키지의 아티팩트를 전부 고르면 artifactIds 없이(패키지 전체) 보내고,
// 일부만 고르면 고른 ID를 목록 순서로 보낸다(사람 결정 2026-11-18). 0개면 그 패키지는 빠지고, 모두 0개면 미리보기를 할 수 없다.
afterEach(() => vi.unstubAllGlobals());

const art = (id: string) => ({ id, name: `${id} 이름`, version: '1.0.0' });
const FOUR = ['A1', 'A2', 'A3', 'A4'].map(art);
const MANY = Array.from({ length: 102 }, (_, i) => art(`IF_${String(i + 1).padStart(3, '0')}`));
const result = (body: TransportRequest) => respondTo(body, { summary: { total: 0, succeeded: 0, failed: 0 }, results: [] });
const NONE_SELECTED = '아티팩트를 하나 이상 선택하세요';

function setup(artifacts: unknown = FOUR, extra: Parameters<typeof mockApi>[0] = {}) {
  const fn = mockApi(
    baseRoutes({
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(artifacts),
      'POST /transport': (init) => json(result(JSON.parse(init?.body as string))),
      ...extra,
    }),
  );
  renderAt('#/transport');
  return fn;
}
const ids = () => selectedIds().map((r) => ['A1', 'A2', 'A3', 'A4'].find((id) => r.textContent?.includes(id)));
/** 패키지를 고르고 "다음"을 누르기만 한다(표가 나타나길 기다리지 않음: 오류·빈 상태용). */
async function toPackageNext() {
  await startManual();
  await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
  await userEvent.click(screen.getByRole('button', { name: '다음' }));
}
const runPreview = () => userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));

describe('REQ-422 표 구조', () => {
  it('REQ-422·621: 한 열 표(grid "이관할 아티팩트", 다중 선택)에 아티팩트마다 행이 있고 처음엔 모두 선택돼 있다', async () => {
    setup();
    await toArtifacts();
    const grid = artifactGrid();
    expect(grid).toHaveAttribute('aria-multiselectable', 'true');
    expect(artifactRows()).toHaveLength(4);
    for (const row of artifactRows()) {
      expect(row).toHaveAttribute('aria-selected', 'true');
      expect(within(row).queryAllByRole('gridcell').length + within(row).queryAllByRole('cell').length).toBeLessThanOrEqual(1);
    }
    expect(artifactRow('A2')).toHaveTextContent('A2 이름');
    expect(screen.getByText('4개 선택 / 전체 4개')).toBeInTheDocument();
    expect(screen.queryByText('패키지의 모든 아티팩트가 대상')).toBeNull();
  });

  it('REQ-422 / ADR-012: 표는 Tab 진입점이 하나다(행 중 하나만 tabindex=0, 나머지는 -1)', async () => {
    setup();
    await toArtifacts();
    const tabbable = artifactRows().filter((r) => r.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(artifactRows().filter((r) => r.getAttribute('tabindex') === '-1')).toHaveLength(3);
    expect(Array.from(artifactGrid().querySelectorAll('input, button, a, [tabindex="0"]'))).toEqual(tabbable);
  });
});

describe('REQ-422 마우스', () => {
  it('REQ-422: 행 클릭은 토글이고 개수가 따라 바뀐다', async () => {
    setup();
    await toArtifacts();
    await userEvent.click(artifactRow('A2'));
    expect(artifactRow('A2')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('3개 선택 / 전체 4개')).toBeInTheDocument();
    await userEvent.click(artifactRow('A2'));
    expect(artifactRow('A2')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('4개 선택 / 전체 4개')).toBeInTheDocument();
  });

  it('REQ-422: Shift+클릭은 기준 행(마지막으로 누른 행)부터 범위를 선택한다', async () => {
    setup();
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    await userEvent.click(artifactRow('A1'));
    fireEvent.click(artifactRow('A3'), { shiftKey: true });
    expect(ids()).toEqual(['A1', 'A2', 'A3']);
    expect(artifactRow('A4')).toHaveAttribute('aria-selected', 'false');
  });

  it('REQ-422·621: 패키지의 "선택 해제"와 "전체 선택" 버튼, 맨 위 "모두 해제"와 "모두 선택" 버튼', async () => {
    setup();
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    expect(ids()).toEqual([]);
    expect(screen.getByText('0개 선택 / 전체 4개')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    expect(ids()).toEqual(['A1', 'A2', 'A3', 'A4']);
    await userEvent.click(screen.getByRole('button', { name: '모두 해제' }));
    expect(ids()).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: '모두 선택' }));
    expect(ids()).toEqual(['A1', 'A2', 'A3', 'A4']);
  });
});

describe('REQ-422 키보드', () => {
  it('REQ-422: Tab으로 표에 들어가 ↑↓·Home·End로 행을 옮기고(포커스와 tabindex가 함께 이동) Space/Enter로 토글한다', async () => {
    setup();
    await toArtifacts();
    const first = artifactRows().find((r) => r.tabIndex === 0)!;
    first.focus();
    expect(first).toBe(artifactRow('A1'));
    await userEvent.keyboard('{ArrowDown}');
    expect(artifactRow('A2')).toHaveFocus();
    expect(artifactRow('A2').tabIndex).toBe(0);
    expect(artifactRow('A1').tabIndex).toBe(-1);
    await userEvent.keyboard(' ');
    expect(artifactRow('A2')).toHaveAttribute('aria-selected', 'false');
    await userEvent.keyboard('{End}');
    expect(artifactRow('A4')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(artifactRow('A4')).toHaveAttribute('aria-selected', 'false');
    await userEvent.keyboard('{Enter}');
    expect(artifactRow('A4')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(artifactRow('A1')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(artifactRow('A1')).toHaveFocus();
    await userEvent.keyboard('{End}{ArrowDown}');
    expect(artifactRow('A4')).toHaveFocus();
    // Space는 페이지를 스크롤하지 않고 Enter는 폼 제출 등 다른 동작을 하지 않는다
    expect(postBodies(mockFetchOf())).toEqual([]);
  });

  it('REQ-422: Shift+↑↓는 범위를 넓히고 Ctrl/⌘+A는 전체 선택이다', async () => {
    setup();
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    artifactRow('A1').focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    expect(artifactRow('A3')).toHaveFocus();
    expect(ids()).toEqual(['A1', 'A2', 'A3']);
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    artifactRow('A2').focus();
    await userEvent.keyboard('{Control>}a{/Control}');
    expect(ids()).toEqual(['A1', 'A2', 'A3', 'A4']);
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    artifactRow('A2').focus();
    await userEvent.keyboard('{Meta>}a{/Meta}');
    expect(ids()).toEqual(['A1', 'A2', 'A3', 'A4']);
  });
});

describe('REQ-422 요청과 제한', () => {
  it('REQ-422: 선택은 클릭 순서가 아니라 목록 순서로 artifactIds에 담긴다', async () => {
    const fn = setup();
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    await userEvent.click(artifactRow('A3'));
    await userEvent.click(artifactRow('A1'));
    await runPreview();
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)).toEqual([
      { packages: [{ packageId: 'PkgTransportDemo', artifactIds: ['A1', 'A3'], ...NO_TYPES }], dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' },
    ]);
    expect(stepButton('아티팩트')).toHaveTextContent('2 / 4');
  });

  it('REQ-621 / 사람 결정 2026-11-18: 패키지의 아티팩트를 전부 고른 채면 artifactIds 키 없이(패키지 전체) 보내고 단계 요약은 "전체"다', async () => {
    const fn = setup();
    await toArtifacts();
    await runPreview();
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)).toEqual([{ packages: [{ packageId: 'PkgTransportDemo', ...NO_TYPES }], dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' }]);
    expect(stepButton('아티팩트')).toHaveTextContent('전체');
  });

  it('REQ-621 실패: 모든 패키지의 선택이 0개면 미리보기 실행이 비활성이고 이유가 보인다', async () => {
    const fn = setup();
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
    expect(screen.getByText(NONE_SELECTED)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    expect(postBodies(fn)).toHaveLength(0);
    await userEvent.click(artifactRow('A2'));
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeEnabled();
    expect(screen.queryByText(NONE_SELECTED)).toBeNull();
  });

  it('REQ-422·621: 전부 고른 패키지는 아티팩트가 100개를 넘어도 실행할 수 있고, 일부만 101개 이상 고르면 미리보기 실행이 비활성이고 이유가 보인다. 100개는 실행할 수 있다', async () => {
    const fn = setup(MANY);
    await toArtifacts();
    expect(screen.getByText('102개 선택 / 전체 102개')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeEnabled();
    expect(screen.queryByText(/한 번에 100개까지 선택할 수 있습니다/)).toBeNull();
    await userEvent.click(artifactRow('IF_102'));
    expect(screen.getByText('101개 선택 / 전체 102개')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
    expect(screen.getByText(/한 번에 100개까지 선택할 수 있습니다/)).toBeInTheDocument();
    await userEvent.click(artifactRow('IF_101'));
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeEnabled();
    expect(screen.queryByText(/한 번에 100개까지 선택할 수 있습니다/)).toBeNull();
    await runPreview();
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)[0].packages[0].artifactIds).toHaveLength(100);
  });

  it('REQ-422: 선택을 바꾸면 이전 결과가 비워지고 미리보기·실제 이관 단계로 갈 수 없다', async () => {
    setup();
    await toArtifacts();
    await runPreview();
    await screen.findByRole('region', { name: '이관 결과' });
    await userEvent.click(stepButton('아티팩트'));
    expect(currentStep()).toBe('아티팩트');
    await userEvent.click(artifactRow('A2'));
    expect(stepButton('미리보기')).toBeDisabled();
    expect(stepButton('실제 이관')).toBeDisabled();
  });

  it('REQ-422: "이전"은 패키지 단계로 돌아간다', async () => {
    setup();
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '이전' }));
    expect(currentStep()).toBe('패키지');
    expect(screen.getByRole('checkbox', { name: /Transport Demo/ })).toBeChecked();
  });
});

describe('REQ-422 실패 상태', () => {
  it('REQ-422·621 실패: 조회에 실패하면 오류와 "다시 시도"를 보이고 미리보기는 막히며(사람 결정 2026-11-18), 다시 시도는 같은 URL을 다시 부른다', async () => {
    let fail = true;
    const fn = setup(FOUR, {
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => (fail ? json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) : json(FOUR)),
    });
    await toPackageNext();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('CPI에 연결할 수 없습니다');
    expect(screen.queryByText(/개 선택 \/ 전체/)).toBeNull();
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('grid', { name: '이관할 아티팩트' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeEnabled();
    expect(fn.mock.calls.filter(([u]) => u === '/packages/PkgTransportDemo/artifacts?tenantId=DEV')).toHaveLength(2);
  });

  it('REQ-422·621 실패: 아티팩트가 0개인 패키지는 빈 상태 "아티팩트가 없습니다"이고 그 패키지뿐이면 미리보기를 할 수 없다', async () => {
    setup([]);
    await toPackageNext();
    expect(await screen.findByText('아티팩트가 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
  });
});

// 위 키보드 테스트에서 요청이 없었음을 확인하려고 현재 fetch 목을 꺼낸다.
function mockFetchOf() {
  return globalThis.fetch as unknown as ReturnType<typeof mockApi>;
}

describe('REQ-304 실제 모양의 값', () => {
  const name = '한글 공백 "따옴표" & 설명';
  it('REQ-304 AC-3: 규칙 밖 ID도 목록에 보이고, 아티팩트 조회가 400이면 오류 제목이 보이며 패키지 선택은 유지된다', async () => {
    const id = 'bad id';
    const fn = mockApi(baseRoutes({
      'GET /packages?tenantId=DEV': () => json([{ id, name, version: '1' }]),
      'GET /packages/bad%20id/artifacts?tenantId=DEV': () => json({ error: 'INVALID_REQUEST', message: 'Invalid request' }, 400),
    }));
    renderAt('#/transport');
    await startManual();
    const list = await screen.findByRole('list', { name: '패키지 목록' });
    expect(within(list).getByText(name)).toHaveTextContent(name);
    expect(within(list).getByText(id)).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('요청 값이 올바르지 않습니다')).toBeInTheDocument();
    expect(fn.mock.calls.map(([input]) => input)).toContain('/packages/bad%20id/artifacts?tenantId=DEV');
    expect(postBodies(fn)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: '이전' }));
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('REQ-304 AC-3: 한글·공백·따옴표·& 이름을 그대로 보이고 선택한 ID로 미리보기를 실행한다', async () => {
    const artifactName = '아티팩트 "한글 이름" & 설명';
    const fn = mockApi(baseRoutes({
      'GET /packages?tenantId=DEV': () => json([{ id: 'Pkg', name, version: '1' }]),
      'GET /packages/Pkg/artifacts?tenantId=DEV': () => json([{ id: 'Flow', name: artifactName, version: '1' }]),
      'POST /transport': (init) => json(result(JSON.parse(init?.body as string))),
    }));
    renderAt('#/transport');
    await startManual();
    await userEvent.click(within(await screen.findByRole('list', { name: '패키지 목록' })).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await screen.findByRole('grid', { name: '이관할 아티팩트' });
    expect(within(artifactGrid()).getByText(artifactName)).toHaveTextContent(artifactName);
    expect(artifactRow('Flow')).toHaveAttribute('aria-selected', 'true');
    await runPreview();
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)).toEqual([
      { packages: [{ packageId: 'Pkg', ...NO_TYPES }], dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' },
    ]);
  });
});
