import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import type { TransportResponse } from '../../api/types';
import { TransportResult } from '../result/TransportResult';
import { ArtifactPicker } from './ArtifactPicker';
import { PackagePicker } from './PackagePicker';
import { RunPanel } from './RunPanel';

export function TransportTab() {
  // 선택 상태는 여기서 들고 있고, 옵션·실행(TODO-007)이 같은 값을 쓴다.
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);

  const [result, setResult] = useState<TransportResponse | null>(null);

  function selectPackage(id: string) {
    if (id === selectedPackageId) return;
    setSelectedPackageId(id);
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
        <Card title="패키지">
          <PackagePicker selectedId={selectedPackageId} onSelect={selectPackage} />
        </Card>
        {selectedPackageId !== null && (
          <Card title="아티팩트">
            <ArtifactPicker
              packageId={selectedPackageId}
              selectedIds={selectedArtifactIds}
              onChange={setSelectedArtifactIds}
            />
          </Card>
        )}
        <Card title="실행">
          <RunPanel packageId={selectedPackageId} artifactIds={selectedArtifactIds} onResult={setResult} />
        </Card>
        {result && <TransportResult result={result} />}
      </div>
    </div>
  );
}
