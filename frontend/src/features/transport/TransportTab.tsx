import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import type { TransportResponse } from '../../api/types';
import { ArtifactPicker } from './ArtifactPicker';
import { PackagePicker } from './PackagePicker';
import { RunPanel } from './RunPanel';

export function TransportTab() {
  // 선택 상태는 여기서 들고 있고, 옵션·실행(TODO-007)이 같은 값을 쓴다.
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);

  // 결과 표시는 TODO-008에서 연결한다.
  const [, setResult] = useState<TransportResponse | null>(null);

  function selectPackage(id: string) {
    if (id === selectedPackageId) return;
    setSelectedPackageId(id);
    setSelectedArtifactIds([]);
    setResult(null);
  }

  return (
    <div className="flex flex-col gap-6 min-w-0">
      <Card>
        <h2 className="mb-3 text-lg font-semibold">패키지</h2>
        <PackagePicker selectedId={selectedPackageId} onSelect={selectPackage} />
      </Card>
      {selectedPackageId !== null && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">아티팩트</h2>
          <ArtifactPicker
            packageId={selectedPackageId}
            selectedIds={selectedArtifactIds}
            onChange={setSelectedArtifactIds}
          />
        </Card>
      )}
      <Card>
        <h2 className="mb-3 text-lg font-semibold">실행</h2>
        <RunPanel packageId={selectedPackageId} artifactIds={selectedArtifactIds} onResult={setResult} />
      </Card>
    </div>
  );
}
