// REQ-008: 요청 단위 오류와 네트워크 오류를 화면용 { title, message? }로 정규화한다.
export interface ApiError {
  title: string;
  message?: string;
}

const TITLES: Record<string, string> = {
  INVALID_REQUEST: '요청 값이 올바르지 않습니다',
  ENVIRONMENT_NOT_CONFIGURED: '서버 연결 설정이 없습니다',
  MAPPING_INVALID: '매핑 파일이 올바르지 않습니다',
  PACKAGE_NOT_FOUND: '패키지를 찾을 수 없습니다',
  CPI_UNAVAILABLE: 'CPI에 연결할 수 없습니다',
};

export const NETWORK_ERROR_TITLE = '서버에 연결할 수 없습니다';

export function unknownError(status: number): ApiError {
  return { title: `알 수 없는 오류(HTTP ${status})` };
}

export function networkError(): ApiError {
  return { title: NETWORK_ERROR_TITLE };
}

/** 2xx가 아닌 응답의 본문(텍스트)을 오류로 바꾼다. 알려진 코드 + 문자열 message가 아니면 알 수 없는 오류. */
export function parseErrorBody(status: number, text: string): ApiError {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null) {
      const { error, message } = body as Record<string, unknown>;
      if (typeof error === 'string' && Object.hasOwn(TITLES, error) && typeof message === 'string') {
        return { title: TITLES[error], message };
      }
    }
  } catch {
    // JSON이 아니면 아래에서 알 수 없는 오류로 처리한다.
  }
  return unknownError(status);
}

/** 화면 상태로 들고 다니는 오류 (fetch 함수는 이 형태로 reject 한다). */
export class ApiRequestError extends Error {
  readonly apiError: ApiError;

  constructor(apiError: ApiError) {
    super(apiError.title);
    this.apiError = apiError;
  }
}

export function toApiError(e: unknown): ApiError {
  return e instanceof ApiRequestError ? e.apiError : networkError();
}
