import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '../../test/userEvent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TenantsResponse, TenantStatusResponse, TransportRequest } from '../../api/types';
import { ARTIFACTS, PACKAGES, json, mockApi, respondTo } from '../../test/mockFetch';
import { baseRoutes, renderAt, routeGroup, tpl, type TemplateFixture } from '../../test/appRoutes';
import { artifactRow, currentStep, postBodies, stepButton, toArtifacts, NO_TYPES } from '../../test/wizard';

// S3b REQ-423 미리보기와 실제 이관, 그리고 "바뀌지 않는 규칙"(ADR-002·008·016·018, REQ-319) 단언을 새 마법사에서 다시 확인한다.
afterEach(() => vi.unstubAllGlobals());

// REQ-319: 옛 명칭은 화면에 없음을 확인하는 이 상수 한 줄에만 둔다. 다른 테스트에 옛 문구가 남으면 부재 단언이 항상 통과해 버린다.
const OLD_TERM = '드라이런';
const READ_ONLY = '읽기 전용 모드입니다. 실제 이관은 꺼져 있습니다';
const STATUS_FAILED = '읽기 전용 여부를 확인하지 못했습니다. 상태 칩을 눌러 다시 확인하세요';

const TENANTS: TenantsResponse = {
  store: 'OK',
  tenants: [
    { id: 'DEV', name: '개발', source: 'env', apiHost: 'dev.localhost', createdAt: null },
    { id: 'PRD', name: '운영', source: 'env', apiHost: 'prd.localhost', createdAt: null },
  ],
};
const status = (readOnly: boolean): TenantStatusResponse => ({ readOnly, tenants: TENANTS.tenants.map((t) => ({ ...t, check: 'OK' as const })) });
const respond = (body: Pick<TransportRequest, 'packages' | 'dryRun' | 'deploy'>) => respondTo(body);
const ONE = { packages: [{ packageId: 'PkgTransportDemo' }] };
// 20261121-package-objects REQ-1003: 화면이 보내는 요청 본문에는 새 종류 Id 목록이 항상 있다(응답을 만드는 ONE과 구분)
const ONE_SENT = { packages: [{ packageId: 'PkgTransportDemo', ...NO_TYPES }] };
const T_PKG = tpl({ id: 'tp-1', name: '개발에서 운영', sourceTenantId: 'DEV', targetTenantId: 'PRD' });

type Routes = Parameters<typeof mockApi>[0];
function setup(opts: { status?: Routes[string]; post?: Routes[string]; templates?: TemplateFixture[] } = {}) {
  const fn = mockApi(
    baseRoutes({
      'GET /tenants': () => json(TENANTS),
      'GET /tenants/status': opts.status ?? (() => json(status(false))),
      'GET /templates': () => json(opts.templates ?? []),
      'GET /packages?tenantId=DEV': () => json(PACKAGES),
      'GET /packages/PkgTransportDemo/artifacts?tenantId=DEV': () => json(ARTIFACTS),
      // 20261118 S3 REQ-622: 실제 이관 확인창이 대상 패키지 존재를 읽는다
      'GET /packages/target-status?tenantId=PRD&packageIds=PkgTransportDemo': () => json([{ packageId: 'PkgTransportDemo', exists: true }]),
      'POST /transport': opts.post ?? ((init) => json(respond(JSON.parse(init?.body as string)))),
    }),
  );
  renderAt('#/transport');
  return fn;
}
/** 아티팩트 하나(IF_Customer_Push)만 남기고(처음엔 모두 선택) 미리보기를 실행해 결과 단계까지 간다. */
async function previewOne() {
  await toArtifacts();
  await userEvent.click(artifactRow('IF_Order_Sync'));
  await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
  return screen.findByRole('region', { name: '이관 결과' });
}
const confirmDialog = () => screen.getByRole('dialog', { name: '실제 이관 확인' });
/** 확인창이 대상 패키지 확인을 마쳐 "실행"이 켜지기를 기다린다(REQ-622). */
async function runButton() {
  const run = within(confirmDialog()).getByRole('button', { name: '실행' });
  await waitFor(() => expect(run).toBeEnabled());
  return run;
}

describe('REQ-430 / REQ-423 대상 연결 확인 실패(사람 결정 2026-11-16)', () => {
  it.each(['TOKEN_FAILED', 'API_FORBIDDEN', 'UNREACHABLE', 'ERROR'] as const)('대상 연결 확인이 %s면 미리보기는 되고, 실제 이관 버튼 두 곳은 이유와 함께 비활성이다', async (check) => {
    const st: TenantStatusResponse = { readOnly: false, tenants: TENANTS.tenants.map((t) => ({ ...t, check: t.id === 'PRD' ? check : ('OK' as const) })) };
    const fn = setup({ status: () => json(st) });
    const region = await previewOne();
    expect(postBodies(fn)).toHaveLength(1);
    const real = within(region).getByRole('button', { name: '이 구성으로 실제 이관' });
    expect(real).toBeDisabled();
    expect(real).toHaveAccessibleDescription(expect.stringContaining('운영'));
    expect(real).toHaveAccessibleDescription(expect.stringContaining('연결 확인'));
    await userEvent.click(stepButton('실제 이관'));
    const btn = screen.getByRole('button', { name: '실제 이관 실행' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(expect.stringContaining('연결 확인'));
  });

  it('원본만 연결 확인이 실패하면 실제 이관은 막지 않는다(대상 기준)', async () => {
    const st: TenantStatusResponse = { readOnly: false, tenants: TENANTS.tenants.map((t) => ({ ...t, check: t.id === 'DEV' ? 'TOKEN_FAILED' as const : 'OK' as const })) };
    setup({ status: () => json(st) });
    const region = await previewOne();
    expect(within(region).getByRole('button', { name: '이 구성으로 실제 이관' })).toBeEnabled();
  });
});
const deferred = () => {
  let release: (r: Response) => void = () => {};
  const promise = new Promise<Response>((r) => { release = r; });
  return { promise, release: (r: Response) => release(r) };
};

describe('REQ-423 미리보기', () => {
  it('REQ-423 / ADR-002: 미리보기는 확인창 없이 dryRun: true, deploy: false로 보내고 결과 단계로 간다', async () => {
    const fn = setup();
    const region = await previewOne();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postBodies(fn)).toEqual([
      { packages: [{ packageId: 'PkgTransportDemo', artifactIds: ['IF_Customer_Push'], ...NO_TYPES }], dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' },
    ]);
    expect(currentStep()).toBe('미리보기');
    expect(within(region).getByText('이관 ID').nextElementSibling).toHaveTextContent('t-dry');
    expect(within(region).getByRole('button', { name: '이 구성으로 실제 이관' })).toBeEnabled();
  });

  it('REQ-423: 같은 틱의 연속 클릭 3회에도 미리보기 요청은 1회이고 요청 중에는 실행 버튼이 비활성이며 "이관 실행 중"이 보인다', async () => {
    const pending = deferred();
    const fn = setup({ post: () => pending.promise });
    await toArtifacts();
    const run = screen.getByRole('button', { name: '미리보기 실행' });
    fireEvent.click(run); fireEvent.click(run); fireEvent.click(run);
    expect(postBodies(fn)).toHaveLength(1);
    expect(await screen.findByText('이관 실행 중')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '미리보기 실행' })).toBeDisabled();
    pending.release(json(respond({ ...ONE, dryRun: true, deploy: false })));
    expect(await screen.findByRole('region', { name: '이관 결과' })).toBeInTheDocument();
  });

  it('REQ-423: 템플릿으로 시작했고 경로를 바꾸지 않았으면 미리보기와 실제 이관에 templateId를 함께 보낸다', async () => {
    const fn = setup({ templates: [T_PKG] });
    const card = await screen.findByRole('listitem', { name: /개발에서 운영/ });
    await userEvent.click(within(card).getByRole('button', { name: '이 템플릿으로 시작' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
    await userEvent.click(await screen.findByRole('button', { name: '전체 아티팩트로 미리보기' }));
    await userEvent.click(within(await screen.findByRole('region', { name: '이관 결과' })).getByRole('button', { name: '이 구성으로 실제 이관' }));
    await userEvent.click(await runButton());
    await waitFor(() => expect(postBodies(fn)).toHaveLength(2));
    expect(postBodies(fn)).toEqual([
      { ...ONE_SENT, dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD', templateId: 'tp-1' },
      // 20261121-perf-retry REQ-902: 미리보기 뒤 실제 이관은 그 미리보기 ID를 보낸다.
      { ...ONE_SENT, dryRun: false, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD', templateId: 'tp-1', previewId: 't-dry' },
    ]);
  });
});

describe('REQ-423 실제 이관 확인창 (ADR-008)', () => {
  it('REQ-423·622: 결과의 "이 구성으로 실제 이관"은 확인창(경로·패키지와 대상 상태·아티팩트 수·되돌릴 수 없음·배포 꺼짐)을 열고 아직 보내지 않는다', async () => {
    const fn = setup();
    const region = await previewOne();
    const opener = within(region).getByRole('button', { name: '이 구성으로 실제 이관' });
    await userEvent.click(opener);
    const dialog = confirmDialog();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('개발 → 운영');
    const pkg = await within(dialog).findByRole('listitem', { name: /PkgTransportDemo/ });
    await waitFor(() => expect(pkg).toHaveTextContent('있음'));
    expect(pkg).not.toHaveTextContent('새로 만듦');
    expect(dialog).not.toHaveTextContent('대상에 새로 만듭니다');
    expect(within(dialog).getByText('아티팩트 수').nextElementSibling).toHaveTextContent('1');
    expect(dialog).toHaveTextContent('되돌릴 수 없습니다');
    expect(within(dialog).getByRole('switch', { name: '배포' })).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    expect(postBodies(fn)).toHaveLength(1);
  });

  it('REQ-423: "실행"을 눌러야 미리보기와 같은 구성으로 dryRun: false를 보내고, 결과는 작업 화면의 실제 이관 결과이며 "이 구성으로 실제 이관"이 없다', async () => {
    const fn = setup();
    const region = await previewOne();
    await userEvent.click(within(region).getByRole('button', { name: '이 구성으로 실제 이관' }));
    await userEvent.click(await runButton());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '실제 이관 확인' })).toBeNull());
    // 대상에 있는 패키지뿐이면 createPackages 키를 보내지 않는다
    expect(postBodies(fn)[1]).toEqual({
      packages: [{ packageId: 'PkgTransportDemo', artifactIds: ['IF_Customer_Push'], ...NO_TYPES }], dryRun: false, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD',
      // 20261121-perf-retry REQ-902: 미리보기 뒤 실제 이관은 그 미리보기 ID를 보낸다.
      previewId: 't-dry',
    });
    // 20261120-async-transport REQ-808: 실제 이관 결과는 마법사가 아니라 작업 화면(완료 화면)에 나온다.
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/job\?id=/));
    const real = await screen.findByRole('region', { name: '이관 결과' }, { timeout: 3000 });
    await waitFor(() => expect(within(real).getByText('이관 ID').nextElementSibling).toHaveTextContent('t-real'));
    expect(screen.queryByRole('button', { name: '이 구성으로 실제 이관' })).toBeNull();
    expect(screen.getByRole('heading', { name: '실제 이관 완료' })).toBeInTheDocument();
  });

  it('REQ-803: 실제 이관 단계 카드는 제목 "실제 이관", 설명 "미리보기한 패키지·아티팩트를 대상 테넌트에 업로드합니다.", 버튼 "실제 이관 실행"이고 테넌트 이름·경로를 넣지 않는다', async () => {
    setup();
    await previewOne();
    await userEvent.click(stepButton('실제 이관'));
    const btn = screen.getByRole('button', { name: '실제 이관 실행' });
    // Card: 머리 div > h3 제목. 카드 루트는 제목의 조부모다.
    const card = screen.getByRole('heading', { level: 3, name: '실제 이관' }).parentElement!.parentElement as HTMLElement;
    expect(card).toContainElement(btn);
    // 오른쪽 아래: 버튼 줄은 카드 본문의 마지막 줄이고 오른쪽 정렬이다(아티팩트 단계 "미리보기 실행"과 같은 자리)
    const row = btn.parentElement as HTMLElement;
    expect(row.className).toContain('justify-end');
    expect(row.parentElement!.lastElementChild).toBe(row);
    expect(within(card).getByText('미리보기한 패키지·아티팩트를 대상 테넌트에 업로드합니다.')).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/운영|개발|→|미리보기와 같은 구성|로 이관/);
    expect(screen.queryByRole('button', { name: /로 이관$/ })).toBeNull();
  });

  it('REQ-423, REQ-803: 실제 이관 단계의 버튼은 "실제 이관 실행"이고 확인창에서 배포를 켜면 deploy: true로 보낸다', async () => {
    const fn = setup();
    await previewOne();
    await userEvent.click(stepButton('실제 이관'));
    expect(currentStep()).toBe('실제 이관');
    await userEvent.click(screen.getByRole('button', { name: '실제 이관 실행' }));
    const dialog = confirmDialog();
    await userEvent.click(within(dialog).getByRole('switch', { name: '배포' }));
    await userEvent.click(await runButton());
    await waitFor(() => expect(postBodies(fn)).toHaveLength(2));
    expect(postBodies(fn)[1]).toMatchObject({ dryRun: false, deploy: true, packages: [{ packageId: 'PkgTransportDemo', artifactIds: ['IF_Customer_Push'] }] });
  });

  it('REQ-423: "취소"와 Esc는 보내지 않고 닫으며 연 버튼으로 포커스가 돌아간다. 다시 열면 배포는 다시 꺼짐이다', async () => {
    const fn = setup();
    await previewOne();
    await userEvent.click(stepButton('실제 이관'));
    const opener = screen.getByRole('button', { name: '실제 이관 실행' });
    await userEvent.click(opener);
    await userEvent.click(within(confirmDialog()).getByRole('switch', { name: '배포' }));
    await userEvent.click(within(confirmDialog()).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '실제 이관 확인' })).toBeNull();
    expect(opener).toHaveFocus();
    await userEvent.click(opener);
    expect(within(confirmDialog()).getByRole('switch', { name: '배포' })).not.toBeChecked();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '실제 이관 확인' })).toBeNull();
    expect(opener).toHaveFocus();
    expect(postBodies(fn)).toHaveLength(1);
  });

  it('REQ-423: 확인창 "실행"의 같은 틱 연속 클릭도 1회이고, 요청 중에는 두 버튼이 비활성·"이관 실행 중"·Esc 무시다', async () => {
    let pending: ReturnType<typeof deferred> | null = null;
    const fn = setup({
      post: (init) => {
        const body = JSON.parse(init?.body as string);
        if (body.dryRun) return json(respond(body));
        pending = deferred();
        return pending.promise;
      },
    });
    const region = await previewOne();
    await userEvent.click(within(region).getByRole('button', { name: '이 구성으로 실제 이관' }));
    const run = await runButton();
    fireEvent.click(run); fireEvent.click(run); fireEvent.click(run);
    expect(postBodies(fn)).toHaveLength(2);
    await waitFor(() => expect(within(confirmDialog()).getByRole('button', { name: '실행' })).toBeDisabled());
    expect(within(confirmDialog()).getByRole('button', { name: '취소' })).toBeDisabled();
    expect(within(confirmDialog()).getByText('이관 실행 중')).toBeInTheDocument();
    fireEvent.keyDown(confirmDialog(), { key: 'Escape' });
    expect(confirmDialog()).toBeInTheDocument();
    pending!.release(json(respond({ ...ONE, dryRun: false, deploy: false })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '실제 이관 확인' })).toBeNull());
  });
});

describe('REQ-423 읽기 전용 (ADR-018)', () => {
  const never = () => new Promise<Response>(() => {});
  it.each([
    ['켜짐', () => json(status(true)), READ_ONLY],
    ['상태 조회 실패', () => json({}, 500), STATUS_FAILED],
    ['모름(응답 대기)', never, null],
  ] as const)('REQ-423 실패: 읽기 전용 %s이면 실제 이관 버튼과 "이 구성으로 실제 이관"이 비활성이고 미리보기는 된다', async (_label, statusRoute, notice) => {
    const fn = setup({ status: statusRoute });
    const region = await previewOne();
    expect(postBodies(fn)).toEqual([expect.objectContaining({ dryRun: true, deploy: false })]);
    const fromResult = within(region).getByRole('button', { name: '이 구성으로 실제 이관' });
    await waitFor(() => expect(fromResult).toBeDisabled());
    if (notice) expect(screen.getAllByText(notice).length).toBeGreaterThanOrEqual(1);
    await userEvent.click(fromResult);
    expect(screen.queryByRole('dialog', { name: '실제 이관 확인' })).toBeNull();
    await userEvent.click(stepButton('실제 이관'));
    const real = screen.getByRole('button', { name: '실제 이관 실행' });
    expect(real).toBeDisabled();
    if (notice) expect(screen.getByText(notice)).toBeInTheDocument();
    await userEvent.click(real);
    expect(screen.queryByRole('dialog', { name: '실제 이관 확인' })).toBeNull();
    expect(postBodies(fn)).toHaveLength(1);
  });

  it('REQ-423 실패: 확인창이 열린 채 읽기 전용이 되면(상태 재확인) 확인창이 닫히고 보내지 않는다', async () => {
    let calls = 0;
    const fn = setup({ status: () => json(status(++calls > 1)) });
    const region = await previewOne();
    await waitFor(() => expect(within(region).getByRole('button', { name: '이 구성으로 실제 이관' })).toBeEnabled());
    await userEvent.click(within(region).getByRole('button', { name: '이 구성으로 실제 이관' }));
    expect(confirmDialog()).toBeInTheDocument();
    fireEvent.click(within(routeGroup()).getByRole('button', { name: /^대상 운영/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '실제 이관 확인' })).toBeNull());
    expect(postBodies(fn)).toHaveLength(1);
  });
});

describe('REQ-423 요청 오류 (ADR-016)', () => {
  it('REQ-423 실패: 알려진 오류는 제목과 서버 message를 실행 영역 안에 텍스트로만 보이고 다시 실행할 수 있다', async () => {
    let fail = true;
    const message = '<b>test-dummy</b> down';
    const fn = setup({ post: (init) => (fail ? json({ error: 'CPI_UNAVAILABLE', message }, 502) : json(respond(JSON.parse(init?.body as string)))) });
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('CPI에 연결할 수 없습니다');
    expect(alert).toHaveTextContent(message);
    expect(alert.querySelector('b')).toBeNull();
    expect(screen.queryByRole('region', { name: '이관 결과' })).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    expect(await screen.findByRole('region', { name: '이관 결과' })).toBeInTheDocument();
    expect(postBodies(fn)).toHaveLength(2);
  });

  it('REQ-423 실패: 인식되지 않는 오류 코드는 제목만 보인다', async () => {
    setup({ post: () => json({ error: 'SOMETHING_NEW', message: 'test-dummy-hidden' }, 500) });
    await toArtifacts();
    await userEvent.click(screen.getByRole('button', { name: '미리보기 실행' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('알 수 없는 오류(HTTP 500)');
    expect(alert).not.toHaveTextContent('test-dummy-hidden');
  });

  it('REQ-423 실패: 실제 이관의 409 READ_ONLY_MODE는 지정 제목과 서버 message를 보인다', async () => {
    const message = 'test-dummy-server-read-only-message';
    setup({ post: (init) => (JSON.parse(init?.body as string).dryRun ? json(respond(JSON.parse(init?.body as string))) : json({ error: 'READ_ONLY_MODE', message }, 409)) });
    const region = await previewOne();
    await userEvent.click(within(region).getByRole('button', { name: '이 구성으로 실제 이관' }));
    await userEvent.click(await runButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('읽기 전용 모드에서는 실제 이관을 할 수 없습니다');
    expect(alert).toHaveTextContent(message);
  });

  it.each([
    ['TEMPLATE_MISMATCH', 400],
    ['TEMPLATE_NOT_FOUND', 404],
  ] as const)('REQ-423 실패: %s이면 "템플릿이 바뀌었거나 삭제되었습니다"와 "템플릿 없이 다시 실행"을 보이고, 누르면 templateId 없이 다시 보낸다', async (code, httpStatus) => {
    const fn = setup({
      templates: [T_PKG],
      post: (init) => {
        const body = JSON.parse(init?.body as string);
        return body.templateId ? json({ error: code, message: 'test-dummy' }, httpStatus) : json(respond(body));
      },
    });
    const card = await screen.findByRole('listitem', { name: /개발에서 운영/ });
    await userEvent.click(within(card).getByRole('button', { name: '이 템플릿으로 시작' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Transport Demo/ }));
    await userEvent.click(await screen.findByRole('button', { name: '전체 아티팩트로 미리보기' }));
    expect((await screen.findAllByText('템플릿이 바뀌었거나 삭제되었습니다')).length).toBeGreaterThanOrEqual(1);
    await userEvent.click(screen.getByRole('button', { name: '템플릿 없이 다시 실행' }));
    expect(await screen.findByRole('region', { name: '이관 결과' })).toBeInTheDocument();
    const bodies = postBodies(fn);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ templateId: 'tp-1', dryRun: true });
    expect(bodies[1]).toEqual({ ...ONE_SENT, dryRun: true, deploy: false, sourceTenantId: 'DEV', targetTenantId: 'PRD' });
    expect(stepButton('템플릿')).not.toHaveTextContent('개발에서 운영');
  });
});

describe('REQ-319 미리보기 명칭', () => {
  function surfaceTexts(): string[] {
    const out: string[] = [document.body.textContent ?? ''];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      for (const attr of ['aria-label', 'title', 'alt', 'placeholder', 'value', 'aria-description']) {
        const v = el.getAttribute(attr);
        if (v) out.push(v);
      }
    }
    return out;
  }
  it('REQ-319: 마법사(단계·결과·확인창)의 글자와 이름에 옛 명칭이 없고 결과 머리 배지는 "미리보기"다', async () => {
    setup();
    const region = await previewOne();
    expect(within(region).getAllByText('미리보기').length).toBeGreaterThanOrEqual(1);
    expect(stepButton('미리보기')).toHaveTextContent('미리보기');
    await userEvent.click(within(region).getByRole('button', { name: '이 구성으로 실제 이관' }));
    expect(surfaceTexts().filter((t) => t.includes(OLD_TERM))).toEqual([]);
    // 부재 검사가 실제로 옛 명칭을 잡아내는지 확인한다
    const probe = document.createElement('span');
    probe.textContent = OLD_TERM;
    document.body.appendChild(probe);
    expect(surfaceTexts().some((t) => t.includes(OLD_TERM))).toBe(true);
    probe.remove();
  });
});
