import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import type { ArtifactSummary, TransportResponse } from '../../api/types';
import { TransportResult } from '../result/TransportResult';
import { ArtifactPicker } from './ArtifactPicker';
import { PackagePicker } from './PackagePicker';
import { RunPanel } from './RunPanel';

export function TransportTab() {
  // 선택 상태는 여기서 들고 있고, 옵션·실행(TODO-007)이 같은 값을 쓴다.
  const [selectedPackage, setSelectedPackage] = useState<ArtifactSummary | null>(null);
  const selectedPackageId = selectedPackage?.id ?? null;
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);

  const [result, setResult] = useState<TransportResponse | null>(null);

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
          <div className="min-w-0 lg:sticky lg:top-[76px]">
            <Card title="실행">
              <RunPanel
                packageId={selectedPackageId}
                packageName={selectedPackage?.name ?? null}
                artifactIds={selectedArtifactIds}
                onResult={setResult}
              />
            </Card>
          </div>
        </div>
        {result && <TransportResult result={result} />}
      </div>
    </div>
  );
}
