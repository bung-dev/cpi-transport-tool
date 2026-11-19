import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TenantsResponse, TenantStatusResponse, TransportRequest } from '../../api/types';
import { ARTIFACTS, PACKAGES, json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt, routeGroup, tpl, type TemplateFixture } from '../../test/appRoutes';
import {
  STEP_LABELS, currentStep, findArtifactGrid, postBodies, routeBar, startManual, stepButton, stepButtons, toArtifacts,
} from '../../test/wizard';

// S3b REQ-420(마법사 단계·경로)와 REQ-421(패키지 단계). 앱 전체를 #/transport로 그려 확인한다.
afterEach(() => vi.unstubAllGlobals());

const TENANTS: TenantsResponse = {
  store: 'OK',
  tenants: [
    { id: 'DEV', name: '개발', source: 'env', apiHost: 'dev.localhost', createdAt: null },
    { id: 'PRD', name: '운영', source: 'env', apiHost: 'prd.localhost', createdAt: null },
    { id: 'QAS', name: '품질', source: 'registered', apiHost: 'qas.localhost', createdAt: null },
  ],
};
const STATUS: TenantStatusResponse = { readOnly: false, tenants: TENANTS.tenants.map((t) => ({ ...t, check: 'OK' as const })) };
const result = (body: TransportRequest) => respondTo(body, { summary: { total: 0, succeeded: 0, failed: 0 }, results: [] });
// 20261118 S2 REQ-610: 템플릿은 경로만 담는다(패키지 없음).
const T_PKG = tpl({ id: 'tp-1', name: '개발에서 운영', sourceTenantId: 'DEV', targetTenantId: 'PRD' });
const T_QAS = tpl({ id: 'tp-2', name: '품질에서 운영', sourceTenantId: 'QAS', targetTenantId: 'PRD' });
const T_BROKEN = tpl({ id: 'tp-4', name: '삭제된 원본', sourceTenantId: 'OLD', targetTenantId: 'PRD', usable: false, unusableReason: 'SOURCE_TENANT_MISSING' });

function setup(opts: { templates?: TemplateFixture[]; tenants?: TenantsResponse; extra?: Parameters<typeof mockApi>[0] } = {}) {
  const fn = mockApi(
    baseRoutes({
      'GET /tenants': () => json(opts.tenants ?? TENANTS),
      'GET /tenants/status': () => json(STATUS),
      'GET /templates': () => json(opts.templates ?? []),
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages?tenantId=QAS': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
      'GET /packages/PkgFaultDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=QAS': () => json(ARTIFACTS),
      'POST /transport': (init) => json(result(JSON.parse(init?.body as string))),
      ...opts.extra,
    }),
  );
  renderAt('#/transport');
  return fn;
}
const calls = (fn: ReturnType<typeof mockApi>, url: string) => fn.mock.calls.filter(([u]) => u === url).length;
const templateCard = (name: string) => screen.getByRole('listitem', { name: new RegExp(name) });
const findTemplateCard = (name: string) => screen.findByRole('listitem', { name: new RegExp(name) });

describe('REQ-420 단계 줄과 첫 단계', () => {
  it('REQ-420: 새 이관은 단계 줄 5개(템플릿 → 패키지 → 아티팩트 → 미리보기 → 실제 이관)로 시작하고 현재 단계는 템플릿이다', async () => {
    setup();
    await screen.findByRole('button', { name: '템플릿 없이 진행' });
    const steps = stepButtons();
    expect(steps).toHaveLength(5);
    STEP_LABELS.forEach((label, i) => expect(steps[i], label).toHaveTextContent(label));
    expect(currentStep()).toBe('템플릿');
    // 패키지가 없으면 아티팩트, 결과가 없으면 미리보기·실제 이관 단계로 갈 수 없다
    expect(stepButton('아티팩트')).toBeDisabled();
    expect(stepButton('미리보기')).toBeDisabled();
    expect(stepButton('실제 이관')).toBeDisabled();
  });

  it('REQ-420: 제목은 "새 이관"이고 부제는 실제 경로(이름)를 보이며 고정 "DEV→PRD" 문구가 없다', async () => {
    setup();
    const heading = within(screen.getByRole('main')).getByRole('heading', { level: 2, name: '새 이관' });
    await waitFor(() => expect(heading.nextElementSibling).toHaveTextContent('개발 → 운영'));
    expect(screen.getByRole('main').textContent).not.toContain('DEV 테넌트의 패키지를 PRD 테넌트로');
    expect(screen.getByRole('main').textContent).not.toMatch(/DEV\s*→\s*PRD/);
  });

  it('REQ-420·REQ-610: 첫 단계는 사용 가능한 템플릿(이름·경로, 패키지 표시 없음)과 "템플릿 없이 진행"이고 사용 불가 템플릿은 이유와 함께 비활성이다', async () => {
    setup({ templates: [T_PKG, T_QAS, T_BROKEN] });
    const card = await findTemplateCard('개발에서 운영');
    expect(card).toHaveTextContent('개발 → 운영');
    expect(templateCard('품질에서 운영')).toHaveTextContent('품질 → 운영');
    expect(screen.queryByText('실행 때 선택')).toBeNull();
    expect(within(card).getByRole('button', { name: '이 템플릿으로 시작' })).toBeEnabled();
    const broken = templateCard('삭제된 원본');
    expect(within(broken).getByRole('button', { name: '이 템플릿으로 시작' })).toBeDisabled();
    expect(broken).toHaveTextContent('원본 테넌트가 삭제됨');
    expect(screen.getByRole('button', { name: '템플릿 없이 진행' })).toBeEnabled();
  });

  it('REQ-420: 템플릿이 0개면 안내를 보이고, 템플릿 조회에 실패해도 오류와 "다시 시도"를 보이며 "템플릿 없이 진행"은 쓸 수 있다', async () => {
    let fail = true;
    const fn = setup({ extra: { 'GET /templates': () => (fail ? json({ error: 'TEMPLATE_STORE_UNREADABLE', message: 'x' }, 500) : json([])) } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('템플릿 저장 파일을 읽지 못했습니다');
    expect(screen.getByRole('button', { name: '템플릿 없이 진행' })).toBeEnabled();
    fail = false;
    const before = calls(fn, '/templates');
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('저장된 템플릿이 없습니다')).toBeInTheDocument();
    expect(calls(fn, '/templates')).toBe(before + 1);
  });

  it('REQ-420: "템플릿 없이 진행"은 패키지 단계로 가고, 끝난 템플릿 단계는 "템플릿 없음" 요약으로 남아 눌러서 돌아갈 수 있다', async () => {
    setup({ templates: [T_PKG] });
    await startManual();
    expect(currentStep()).toBe('패키지');
    expect(stepButton('템플릿')).toHaveTextContent('템플릿 없음');
    await userEvent.click(stepButton('템플릿'));
    expect(currentStep()).toBe('템플릿');
    expect(await findTemplateCard('개발에서 운영')).toBeInTheDocument();
  });

  it('REQ-420: 끝난 단계는 요약(템플릿 이름, 패키지, 아티팩트 n개/전체)으로 남고 눌러서 돌아가면 선택이 유지된다', async () => {
    setup({ templates: [T_PKG] });
    await userEvent.click(within(await findTemplateCard('개발에서 운영')).getByRole('button', { name: '이 템플릿으로 시작' }));
    expect(currentStep()).toBe('패키지');
    expect(stepButton('템플릿')).toHaveTextContent('개발에서 운영');
    await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
    await userEvent.click(await screen.findByRole('button', { name: '다음' }));
    await findArtifactGrid();
    expect(currentStep()).toBe('아티팩트');
    expect(stepButton('패키지')).toHaveTextContent('Transport Demo');
    expect(stepButton('아티팩트')).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(currentStep()).toBe('미리보기');
    expect(stepButton('아티팩트')).toHaveTextContent('전체');
    await userEvent.click(stepButton('패키지'));
    expect(currentStep()).toBe('패키지');
    expect(await screen.findByRole('checkbox', { name: /Transport Demo/ })).toBeChecked();
  });
});

describe('REQ-420 경로 선택', () => {
  it('REQ-420: 원본·대상은 "원본 → 대상" 한 줄이고 "경로 변경"을 누르면 원본·대상 라디오 그룹, 연결 상태, "이 경로 사용"이 있는 창이 열린다', async () => {
    setup();
    await startManual();
    await waitFor(() => expect(routeBar()).toHaveTextContent('개발 → 운영'));
    await userEvent.click(within(routeBar()).getByRole('button', { name: '경로 변경' }));
    const dialog = screen.getByRole('dialog', { name: '원본과 대상 선택' });
    const source = within(dialog).getByRole('radiogroup', { name: '원본' });
    const target = within(dialog).getByRole('radiogroup', { name: '대상' });
    expect(within(source).getByRole('radio', { name: '개발' })).toBeChecked();
    expect(within(target).getByRole('radio', { name: '운영' })).toBeChecked();
    expect(within(source).getAllByRole('radio')).toHaveLength(3);
    expect(within(source).getByRole('radio', { name: '품질' })).toHaveAccessibleDescription(/연결됨/);
    expect(within(dialog).getByRole('button', { name: '이 경로 사용' })).toBeEnabled();
    // 호스트는 이 창에 보이지 않는다
    expect(dialog).not.toHaveTextContent('qas.localhost');
  });

  it('REQ-420 실패: 같은 테넌트를 둘 다 고르면 경고가 보이고 "이 경로 사용"이 비활성이다. 취소하면 경로는 그대로다', async () => {
    setup();
    await startManual();
    await userEvent.click(within(routeBar()).getByRole('button', { name: '경로 변경' }));
    const dialog = screen.getByRole('dialog', { name: '원본과 대상 선택' });
    await userEvent.click(within(within(dialog).getByRole('radiogroup', { name: '대상' })).getByRole('radio', { name: '개발' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('원본과 대상이 같습니다');
    expect(within(dialog).getByRole('button', { name: '이 경로 사용' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '원본과 대상 선택' })).toBeNull();
    expect(routeBar()).toHaveTextContent('개발 → 운영');
  });

  it('REQ-420: 경로를 바꿔 적용하면 상단 경로가 바뀌고 패키지·아티팩트 선택과 이전 결과가 비워지며 템플릿 연결이 풀린다(templateId를 보내지 않음)', async () => {
    const fn = setup({ templates: [T_PKG] });
    await userEvent.click(within(await findTemplateCard('개발에서 운영')).getByRole('button', { name: '이 템플릿으로 시작' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
    await userEvent.click(await screen.findByRole('button', { name: '전체 아티팩트로 미리보기' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)[0]).toMatchObject({ templateId: 'tp-1' });

    await userEvent.click(within(routeBar()).getByRole('button', { name: '경로 변경' }));
    const dialog = screen.getByRole('dialog', { name: '원본과 대상 선택' });
    await userEvent.click(within(within(dialog).getByRole('radiogroup', { name: '원본' })).getByRole('radio', { name: '품질' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '이 경로 사용' }));
    expect(screen.queryByRole('dialog', { name: '원본과 대상 선택' })).toBeNull();
    expect(routeBar()).toHaveTextContent('품질 → 운영');
    expect(within(routeGroup()).getByRole('button', { name: /^원본 품질/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '이관 결과' })).toBeNull();
    expect(stepButton('미리보기')).toBeDisabled();
    expect(currentStep()).toBe('패키지');
    expect(stepButton('템플릿')).not.toHaveTextContent('개발에서 운영');
    const radio = await screen.findByRole('checkbox', { name: /Transport Demo/ });
    expect(radio).not.toBeChecked();
    expect(calls(fn, '/packages?tenantId=QAS')).toBeGreaterThanOrEqual(1);
    await userEvent.click(radio);
    await userEvent.click(screen.getByRole('button', { name: '전체 아티팩트로 미리보기' }));
    await screen.findByRole('region', { name: '이관 결과' });
    const second = postBodies(fn)[1];
    expect(second).toMatchObject({ sourceTenantId: 'QAS', targetTenantId: 'PRD', dryRun: true });
    expect(second).not.toHaveProperty('templateId');
  });

  it('REQ-420 실패: 테넌트 목록을 읽었는데 0개면 등록 안내와 이동 버튼을 보이고 미리보기는 할 수 없다', async () => {
    setup({ tenants: { store: 'OK', tenants: [] }, extra: { 'GET /tenants/status': () => json({ readOnly: false, tenants: [] }) } });
    await startManual();
    expect(await screen.findByText('먼저 테넌트를 등록하세요')).toBeInTheDocument();
    const preview = screen.queryByRole('button', { name: '전체 아티팩트로 미리보기' });
    if (preview) expect(preview).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '테넌트 화면으로 이동' }));
    expect(window.location.hash).toBe('#/tenants');
  });

  it('REQ-420 실패(REQ-312 규칙): 테넌트 목록을 읽는 중이거나 읽기에 실패하면 등록 안내를 쓰지 않는다. 실패는 오류와 "다시 시도"다', async () => {
    let fail = true;
    setup({ extra: { 'GET /tenants': () => (fail ? json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) : json(TENANTS)) } });
    await startManual();
    const retries = await screen.findAllByRole('button', { name: '다시 시도' });
    expect(retries[0].closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByText('먼저 테넌트를 등록하세요')).toBeNull();
    fail = false;
    await userEvent.click(retries[0]);
    await waitFor(() => expect(routeBar()).toHaveTextContent('개발 → 운영'));
    expect(screen.queryByText('먼저 테넌트를 등록하세요')).toBeNull();
  });
});

describe('REQ-420 템플릿으로 시작', () => {
  it('REQ-420·421·610: 템플릿으로 시작하면 템플릿 경로가 적용되고 패키지는 비어 있으며, 패키지를 고르면 미리보기에 templateId를 보낸다', async () => {
    const fn = setup({ templates: [T_QAS, T_PKG] });
    await userEvent.click(within(await findTemplateCard('개발에서 운영')).getByRole('button', { name: '이 템플릿으로 시작' }));
    expect(currentStep()).toBe('패키지');
    const radios = await screen.findAllByRole('checkbox');
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(routeBar()).toHaveTextContent('개발 → 운영');
    await userEvent.click(screen.getByRole('checkbox', { name: /Transport Demo/ }));
    await userEvent.click(screen.getByRole('button', { name: '전체 아티팩트로 미리보기' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)).toEqual([
      { packages: [{ packageId: 'PkgTransportDemo' }], dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD', templateId: 'tp-1' },
    ]);
  });

  it('REQ-420: 패키지가 없는 템플릿은 그 경로로 바꾸고 패키지 단계에서 아무것도 고르지 않은 채 시작한다', async () => {
    setup({ templates: [T_QAS] });
    await userEvent.click(within(await findTemplateCard('품질에서 운영')).getByRole('button', { name: '이 템플릿으로 시작' }));
    expect(currentStep()).toBe('패키지');
    await waitFor(() => expect(routeBar()).toHaveTextContent('품질 → 운영'));
    const radios = await screen.findAllByRole('checkbox');
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  });

  it('REQ-403·420: 템플릿으로 시작한 뒤 어떤 패키지를 골라도 경로를 바꾸지 않았으면 templateId를 보낸다', async () => {
    const fn = setup({ templates: [T_PKG] });
    await userEvent.click(within(await findTemplateCard('개발에서 운영')).getByRole('button', { name: '이 템플릿으로 시작' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Fault Demo/ }));
    await userEvent.click(screen.getByRole('button', { name: '전체 아티팩트로 미리보기' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(postBodies(fn)[0]).toMatchObject({ packages: [{ packageId: 'PkgFaultDemo' }], templateId: 'tp-1' });
  });
});

describe('REQ-421 패키지 단계', () => {
  it('REQ-421·620: 원본의 목록(이름·ID·버전)을 체크 목록으로 보이고 "n / m개"가 보이며 조회는 1회다', async () => {
    const fn = setup();
    await startManual();
    const list = await screen.findByRole('list', { name: '패키지 목록' });
    const radio = within(list).getByRole('checkbox', { name: /Transport Demo/ });
    expect(radio).toHaveAccessibleName(expect.stringContaining('PkgTransportDemo'));
    expect(radio).toHaveAccessibleName(expect.stringContaining('1.0.0'));
    expect(within(list).getAllByRole('checkbox')).toHaveLength(PACKAGES.length);
    expect(screen.getByText(`${PACKAGES.length} / ${PACKAGES.length}개`)).toBeInTheDocument();
    expect(calls(fn, '/packages?tenantId=DEV')).toBe(1);
  });

  it('REQ-421: 검색은 ID·이름 포함 검색(대소문자 무시, 특수문자는 글자 그대로)이고 "n / m개"가 바뀌며 API를 다시 부르지 않는다', async () => {
    const fn = setup();
    await startManual();
    const search = await screen.findByLabelText('패키지 검색');
    await userEvent.type(search, 'fault');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByText(`1 / ${PACKAGES.length}개`)).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'pkgnotin');
    expect(screen.getByRole('checkbox', { name: /Not In PRD/ })).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, '([[');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(calls(fn, '/packages?tenantId=DEV')).toBe(1);
  });

  it('REQ-421 실패: 검색 결과가 없으면 "검색 결과가 없습니다"와 "검색어 지우기"를 보이고, 누르면 검색어가 비워지고 목록이 돌아온다', async () => {
    setup();
    await startManual();
    const search = await screen.findByLabelText('패키지 검색');
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('검색 결과가 없습니다')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '검색어 지우기' }));
    expect(search).toHaveValue('');
    expect(screen.getAllByRole('checkbox')).toHaveLength(PACKAGES.length);
  });

  it('REQ-421 실패: 조회 중에는 스켈레톤(role=status "불러오는 중"), 빈 목록은 "패키지가 없습니다"다', async () => {
    let release: (r: Response) => void = () => {};
    setup({ extra: { 'GET /packages?tenantId=DEV': () => new Promise<Response>((r) => { release = r; }) } });
    await startManual();
    const loading = await screen.findByText('불러오는 중');
    expect(loading.closest('[role="status"]')).not.toBeNull();
    release(json([]));
    expect(await screen.findByText('패키지가 없습니다')).toBeInTheDocument();
  });

  it('REQ-421 실패: 조회에 실패하면 오류와 "다시 시도"를 보이고 다시 시도는 같은 URL을 다시 부른다', async () => {
    let fail = true;
    const fn = setup({ extra: { 'GET /packages?tenantId=DEV': () => (fail ? json({ error: 'CPI_UNAVAILABLE', message: 'down' }, 502) : json(PACKAGES)) } });
    await startManual();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('CPI에 연결할 수 없습니다');
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('checkbox', { name: /Transport Demo/ })).toBeInTheDocument();
    expect(calls(fn, '/packages?tenantId=DEV')).toBe(2);
  });

  it('REQ-421: 패키지를 고르기 전에는 "다음"과 "전체 아티팩트로 미리보기"가 비활성이고, 고르면 다음 단계로 가거나 바로 미리보기를 실행할 수 있다', async () => {
    const fn = setup();
    await startManual();
    await screen.findByRole('checkbox', { name: /Transport Demo/ });
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '전체 아티팩트로 미리보기' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Transport Demo/ }));
    expect(screen.getByRole('button', { name: '다음' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '전체 아티팩트로 미리보기' }));
    expect(await screen.findByRole('region', { name: '이관 결과' })).toBeInTheDocument();
    expect(currentStep()).toBe('미리보기');
    // 전체 아티팩트: 패키지 항목에 artifactIds 키 없이 보낸다
    expect(postBodies(fn)).toEqual([{ packages: [{ packageId: 'PkgTransportDemo' }], dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' }]);
  });

  it('REQ-421: "다음"은 아티팩트 단계로 가서 고른 패키지의 아티팩트를 1회 조회한다', async () => {
    const fn = setup();
    await toArtifacts();
    expect(currentStep()).toBe('아티팩트');
    expect(calls(fn, '/packages/PkgTransportDemo/artifacts?tenantId=DEV')).toBe(1);
  });

  it('REQ-420·421·620: 결과 뒤에 패키지를 더 고르면 이전 결과가 비워지고 미리보기·실제 이관 단계로 갈 수 없다', async () => {
    setup();
    await startManual();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
    await userEvent.click(screen.getByRole('button', { name: '전체 아티팩트로 미리보기' }));
    await screen.findByRole('region', { name: '이관 결과' });
    expect(stepButton('실제 이관')).toBeEnabled();
    await userEvent.click(stepButton('패키지'));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Fault Demo/ }));
    expect(stepButton('미리보기')).toBeDisabled();
    expect(stepButton('실제 이관')).toBeDisabled();
    expect(screen.queryByRole('region', { name: '이관 결과' })).toBeNull();
  });
});
