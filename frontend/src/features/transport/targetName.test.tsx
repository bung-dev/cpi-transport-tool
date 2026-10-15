import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PACKAGES, json, mockApi } from '../../test/mockFetch';
import { TENANTS_OK } from '../../test/tenantFixtures';
import { TestTenantProvider } from '../../test/tenantProvider';
import type { TenantContextValue } from '../tenants/TenantContext';
import { ConfirmDialog } from './ConfirmDialog';
import { RunPanel } from './RunPanel';
import { TransportTab } from './TransportTab';

const named = { tenants: { state: 'success' as const, data: { ...TENANTS_OK,
  tenants: TENANTS_OK.tenants.map(t => t.id === 'PRD' ? { ...t, name: 'TRIAL-TARGET' } : t) } } };
afterEach(() => vi.unstubAllGlobals());
async function checkPanel(targetName: string, value?: Partial<TenantContextValue>, provider = true) {
  const panel = <RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />;
  render(provider ? <TestTenantProvider value={value}>{panel}</TestTenantProvider> : panel);
  expect(screen.getByText(targetName + '에 요청을 보내지 않고 변경 내용만 확인합니다')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '실제 이관' })).toHaveAccessibleDescription(targetName + '에 업로드합니다');
  await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
  expect(screen.getByRole('button', { name: targetName + '로 이관' })).toBeInTheDocument();
  expect(screen.getByText('실제 이관입니다. ' + targetName + '에 업로드합니다.')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: '배포' })).toHaveAccessibleDescription('이관 후 ' + targetName + '에 배포합니다');
}
function checkDialog(targetName: string) {
  const dialog = screen.getByRole('dialog', { name: '실제 이관 확인' });
  expect(within(dialog).getByText(targetName + '에 업로드합니다')).toBeInTheDocument();
  expect(within(dialog).getAllByRole('term').map(t => t.textContent)).toEqual(['대상 패키지', '아티팩트 수', '배포']);
}

it('REQ-308 AC-5·AC-7: 대상 이름이 여섯 문구에 반영되고 확인창 요약은 세 행 그대로다', async () => {
  await checkPanel('TRIAL-TARGET', named);
  await userEvent.click(screen.getByRole('button', { name: 'TRIAL-TARGET로 이관' }));
  checkDialog('TRIAL-TARGET');
  expect(document.body.textContent).not.toContain('PRD');
});

it.each(['미선택', '목록에 없는 id', 'provider 없음'])('REQ-308 AC-5·AC-7: %s일 때 여섯 문구의 기본 이름은 PRD다', async variant => {
  const provider = variant !== 'provider 없음';
  const value = { ...named, targetTenantId: variant === '미선택' ? null : 'missing' };
  await checkPanel('PRD', value, provider);
  if (variant !== '목록에 없는 id') expect(screen.getByRole('button', { name: 'PRD로 이관' })).toBeDisabled();
  // 미선택은 실행할 수 없으므로 확인창의 독립 기본값 계약을 확인한다.
  render(<ConfirmDialog packageId="P" artifactCount={0} deploy={false} busy={false} onConfirm={() => {}} onCancel={() => {}} />);
  checkDialog('PRD');
});

it('REQ-308 AC-5·AC-7: 대상 선택이 바뀌면 이미 열린 확인창도 현재 대상 이름을 보인다', async () => {
  const panel = <RunPanel packageId="P" artifactIds={[]} onResult={() => {}} />;
  const view = render(<TestTenantProvider>{panel}</TestTenantProvider>);
  await userEvent.click(screen.getByRole('radio', { name: '실제 이관' }));
  await userEvent.click(screen.getByRole('button', { name: 'PRD로 이관' }));
  checkDialog('PRD');
  view.rerender(<TestTenantProvider value={named}>{panel}</TestTenantProvider>);
  checkDialog('TRIAL-TARGET');
  expect(screen.getByRole('button', { name: 'TRIAL-TARGET로 이관' })).toBeInTheDocument();
});

it('REQ-308 AC-5·AC-7: 선택한 대상 이름과 관계없이 이관 탭 머리 설명은 그대로다', async () => {
  mockApi({ 'GET /packages?tenantId=DEV': () => json(PACKAGES) });
  render(<TestTenantProvider value={named}><TransportTab /></TestTenantProvider>);
  expect(screen.getByText('DEV 테넌트의 패키지를 PRD 테넌트로 이관합니다. 드라이런으로 변경 내용을 먼저 확인할 수 있습니다.')).toBeInTheDocument();
  await screen.findByLabelText('패키지 검색');
});
