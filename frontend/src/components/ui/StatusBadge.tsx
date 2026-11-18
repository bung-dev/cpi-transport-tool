import { badgeLabel, badgeTone, type StatusKind } from '../../design/statusBadges';
import { Badge } from './Badge';

interface Props {
  kind: StatusKind;
  value: string;
}

export function StatusBadge({ kind, value }: Props) {
  return (
    <Badge tone={badgeTone(kind, value)} dot className={kind === 'configurationStatus' ? 'max-w-full' : ''}>
      {badgeLabel(kind, value)}
    </Badge>
  );
}
