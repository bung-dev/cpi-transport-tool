import type { ArtifactType } from '../api/types';

export const TYPE_LABELS: Record<ArtifactType, string> = {
  INTEGRATION_FLOW: 'iFlow',
  SCRIPT_COLLECTION: '스크립트 컬렉션',
  MESSAGE_MAPPING: '메시지 매핑',
  VALUE_MAPPING: '밸류 매핑',
};

export const PROCESSING_STAGE: Record<ArtifactType, number> = {
  SCRIPT_COLLECTION: 1,
  MESSAGE_MAPPING: 1,
  VALUE_MAPPING: 2,
  INTEGRATION_FLOW: 3,
};

export function typeOf(item: { type?: ArtifactType }): ArtifactType {
  return item.type ?? 'INTEGRATION_FLOW';
}

export const PACKAGE_REFERENCE_NOTICE =
  '다른 패키지의 스크립트 컬렉션·메시지 매핑을 참조하는 iFlow는 그 패키지도 옮겨야 배포됩니다';
