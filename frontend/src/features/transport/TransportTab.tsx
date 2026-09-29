import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { ArtifactPicker } from './ArtifactPicker';
import { PackagePicker } from './PackagePicker';

export function TransportTab() {
  // 선택 상태는 여기서 들고 있고, 옵션·실행(TODO-007)이 같은 값을 쓴다.
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);

  function selectPackage(id: string) {
    if (id === selectedPackageId) return;
    setSelectedPackageId(id);
    setSelectedArtifactIds([]);
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
    </div>
  );
}
