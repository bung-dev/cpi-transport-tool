import { useId, useState } from 'react';
import { BrandIcon } from './components/ui/icons';
import { TabList, TabPanel } from './components/ui/Tabs';
import { HistoryTab } from './features/history/HistoryTab';
import { TransportTab } from './features/transport/TransportTab';
import { TenantProvider } from './features/tenants/TenantContext';
import { TenantTab } from './features/tenants/TenantTab';

const TABS = [
  { id: 'transport', label: '이관' },
  { id: 'history', label: '이력' },
  { id: 'tenants', label: '테넌트' },
];

export default function App() {
  const [active, setActive] = useState('transport');
  const tabsId = useId();
  return (
    <TenantProvider openTenantsTab={() => setActive('tenants')}>
      <div className="min-h-screen bg-surface text-ink">
        {/* 상단 바: 높이 56px, canvas 배경, 아래 hairline, 스크롤해도 맨 위에 붙는다(REQ-102 AC-1). 안쪽 상자는 본문 상자(main)와 같은 폭 정의를 쓴다. */}
        <header className="sticky top-0 z-10 h-14 border-b border-hairline bg-canvas">
          <div className="mx-auto flex h-full w-full max-w-[1200px] items-center gap-5 px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-on-primary">
                <BrandIcon />
              </span>
              <h1 className="sr-only text-[15px] font-semibold tracking-tight whitespace-nowrap sm:not-sr-only">CPI Transport Tool</h1>
            </div>
            <div className="ml-auto md:ml-2">
              <TabList idBase={tabsId} tabs={TABS} activeId={active} onChange={setActive} />
            </div>
          </div>
        </header>
        {/* AI-NOTE: "최대 폭 1200px"은 좌우 여백을 포함한 main의 최대 폭이다. 여백은 main 안쪽(px)에 둔다. 뷰포트 1600에서 main x=200·폭 1200, 내용 시작 x=224 (근거: REQ-102 AC-4, D-025, 시안 mockup/index.html:48) */}
        <main className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-7 md:px-6">
          {/* 비활성 탭 패널은 언마운트한다. 탭을 열 때마다 해당 패널의 조회가 다시 실행된다. */}
          <TabPanel idBase={tabsId} activeId={active}>
            {active === 'transport' ? <TransportTab /> : active === 'history' ? <HistoryTab /> : <TenantTab />}
          </TabPanel>
        </main>
      </div>
    </TenantProvider>
  );
}
