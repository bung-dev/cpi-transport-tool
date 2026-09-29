import { useState } from 'react';
import { Tabs } from './components/ui/Tabs';
import { HistoryTab } from './features/history/HistoryTab';
import { TransportTab } from './features/transport/TransportTab';

const TABS = [
  { id: 'transport', label: '이관' },
  { id: 'history', label: '이력' },
];

export default function App() {
  const [active, setActive] = useState('transport');
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-hairline">
        <div className="mx-auto w-full max-w-[1120px] px-4 py-4">
          <h1 className="text-xl font-semibold">CPI Transport Tool</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1120px] min-w-0 px-4 py-6">
        {/* 비활성 탭 패널은 언마운트한다. 탭을 열 때마다 해당 패널의 조회가 다시 실행된다. */}
        <Tabs tabs={TABS} activeId={active} onChange={setActive}>
          {active === 'transport' ? <TransportTab /> : <HistoryTab />}
        </Tabs>
      </main>
    </div>
  );
}
