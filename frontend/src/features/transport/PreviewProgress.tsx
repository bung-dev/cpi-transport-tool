import { JobItems, JobProgressBar } from '../job/JobProgress';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { typeOf } from '../../lib/artifactTypes';
import type { Wizard } from './useWizard';

export function PreviewProgress({ job, artifacts, onCancel }: {
  job: NonNullable<Wizard['previewJob']>;
  artifacts: Wizard['artifacts'];
  onCancel: () => void;
}) {
  return (
    <Card role={job.items ? 'region' : 'group'} aria-label="미리보기 진행" title={`미리보기 중 ${job.done}/${job.total}`}
      actions={<Button size="sm" disabled={job.cancelRequested} onClick={onCancel}>취소</Button>}>
      <JobProgressBar label="미리보기 진행률" done={job.done} total={job.total} />
      {job.items === null ? <ListSkeleton /> : <JobItems items={job.items} nameOf={item => {
        const list = artifacts[item.packageId]?.[typeOf(item)];
        return list?.status === 'ok' ? list.items.find(a => a.id === item.artifactId)?.name : undefined;
      }} />}
    </Card>
  );
}
