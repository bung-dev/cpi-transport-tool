import { useEffect, useRef, useState } from 'react';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import type { ArtifactSummary, TransportResponse } from '../../api/types';
import { TransportResult } from '../result/TransportResult';
import { ArtifactPicker } from './ArtifactPicker';
import { PackagePicker } from './PackagePicker';
import { RunPanel } from './RunPanel';
import { TenantSelect } from './TenantSelect';
import { useTenants } from '../tenants/TenantContext';

export function TransportTab() {
  const { sourceTenantId } = useTenants();
  // AI-NOTE: 원본마다 폼을 분리해 선택·결과·마지막 요청과 진행 중인 이전 원본의 응답을 격리한다(REQ-308 AC-5).
  return <TransportForm key={sourceTenantId} />;
}

function TransportForm() {
  // 선택 상태는 여기서 들고 있고, 옵션·실행(TODO-007)이 같은 값을 쓴다.
  const [selectedPackage, setSelectedPackage] = useState<ArtifactSummary | null>(null);
  const selectedPackageId = selectedPackage?.id ?? null;
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);

  const [result, setResult] = useState<TransportResponse | null>(null);
  // 마지막 요청에 보낸 아티팩트 선택(보내지 않았으면 0개). "이 구성으로 실제 이관"이 이 선택으로 맞춘다(REQ-105 AC-6).
  const [lastRequestIds, setLastRequestIds] = useState<string[]>([]);
  const [realRequest, setRealRequest] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);

  // REQ-105 AC-7: 이 탭에서 응답을 받아 결과가 나타나면 결과 영역의 시작이 뷰포트 안에 들어오도록 스크롤한다. 포커스는 옮기지 않는다.
  // 이력 상세는 TransportResult를 직접 쓰므로 스크롤하지 않는다(D-019 ③).
  useEffect(() => {
    if (result === null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    resultRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [result]);

  function openRealTransport() {
    setSelectedArtifactIds(lastRequestIds);
    setRealRequest((n) => n + 1);
  }

  function selectPackage(pkg: ArtifactSummary) {
    if (pkg.id === selectedPackageId) return;
    setSelectedPackage(pkg);
    setSelectedArtifactIds([]);
    setResult(null);
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="패키지 이관"
        description="DEV 테넌트의 패키지를 PRD 테넌트로 이관합니다. 드라이런으로 변경 내용을 먼저 확인할 수 있습니다."
      />
      <div className="flex flex-col gap-6 min-w-0">
        {/* AI-NOTE: DOM 순서는 패키지 → 아티팩트 → 실행 → 결과다(키보드 Tab 순서). 폭 1024px 이상에서는 grid 2열(오른쪽 360px)로 실행 카드를 오른쪽에 두고, 그 열은 sticky로 상단 바(56px) 아래에 붙는다. 결과는 두 경우 모두 그 아래 전체 폭이다 (근거: REQ-104 AC-1) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-5">
          <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
            <Card title="패키지">
              <PackagePicker selectedId={selectedPackageId} onSelect={selectPackage} />
            </Card>
            <ArtifactPicker
              packageId={selectedPackageId}
              selectedIds={selectedArtifactIds}
              onChange={setSelectedArtifactIds}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[76px] lg:gap-5">
            <TenantSelect />
            <Card title="실행">
              <RunPanel
                packageId={selectedPackageId}
                packageName={selectedPackage?.name ?? null}
                artifactIds={selectedArtifactIds}
                onResult={setResult}
                onRequest={(body) => setLastRequestIds(body.artifactIds ?? [])}
                realRequest={realRequest}
              />
            </Card>
          </div>
        </div>
        {/* AI-NOTE: scroll-mt는 sticky 상단 바(56px)와 여백 20px을 뺀 값이다. 없으면 scrollIntoView가 결과의 위쪽을 상단 바 밑에 가린다 (근거: REQ-105 AC-7) */}
        {result && (
          <div ref={resultRef} className="min-w-0 scroll-mt-[76px]">
            <TransportResult result={result} onOpenReal={openRealTransport} />
          </div>
        )}
      </div>
    </div>
  );
}
