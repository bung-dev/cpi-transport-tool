import { Checkbox } from '../../components/ui/Checkbox';

interface Props {
  dryRun: boolean;
  deploy: boolean;
  onDryRunChange: (v: boolean) => void;
  onDeployChange: (v: boolean) => void;
}

export function TransportOptions({ dryRun, deploy, onDryRunChange, onDeployChange }: Props) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <Checkbox label="드라이런" checked={dryRun} onChange={(e) => onDryRunChange(e.target.checked)} />
      <Checkbox label="배포" checked={deploy} onChange={(e) => onDeployChange(e.target.checked)} />
      {dryRun && deploy && (
        <p className="text-sm text-ink-secondary">드라이런에서는 배포하지 않습니다(SKIPPED_DRY_RUN)</p>
      )}
    </div>
  );
}
