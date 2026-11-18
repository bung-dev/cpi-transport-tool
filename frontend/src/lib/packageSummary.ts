import type { TransportPackage } from '../api/types';

export function packageSummary(packages: Pick<TransportPackage, 'packageId' | 'packageName'>[]): string {
  const first = packages[0];
  if (!first) return '';
  const name = first.packageName ?? first.packageId;
  return packages.length === 1 ? name : `${name} 외 ${packages.length - 1}개`;
}
