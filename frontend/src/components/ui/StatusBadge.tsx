import { badgeClass, type StatusKind } from '../../design/statusBadges';
import { Badge } from './Badge';

interface Props {
  kind: StatusKind;
  value: string;
}

export function StatusBadge({ kind, value }: Props) {
  return <Badge bgClass={badgeClass(kind, value)}>{value}</Badge>;
}
