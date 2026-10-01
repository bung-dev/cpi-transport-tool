import { badgeTone, type StatusKind } from '../../design/statusBadges';
import { Badge } from './Badge';

interface Props {
  kind: StatusKind;
  value: string;
}

export function StatusBadge({ kind, value }: Props) {
  return (
    <Badge tone={badgeTone(kind, value)} dot>
      {value}
    </Badge>
  );
}
