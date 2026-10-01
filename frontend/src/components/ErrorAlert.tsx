import type { ApiError } from '../api/errors';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';

interface Props {
  error: ApiError;
  onRetry?: () => void;
}

// REQ-107 AC-3, REQ-008 AC-3: role="alert"의 danger 색조 Callout. 제목과 서버 message는 텍스트 노드로만 렌더링한다.
export function ErrorAlert({ error, onRetry }: Props) {
  const hasBody = error.message !== undefined || onRetry !== undefined;
  return (
    <Callout tone="danger" role="alert" title={error.title}>
      {hasBody ? (
        <>
          {error.message !== undefined && <p>{error.message}</p>}
          {onRetry && (
            <div className="mt-2">
              <Button size="sm" onClick={onRetry}>
                다시 시도
              </Button>
            </div>
          )}
        </>
      ) : undefined}
    </Callout>
  );
}
