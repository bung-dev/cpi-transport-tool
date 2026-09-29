const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * ISO-8601 문자열을 브라우저 로컬 시간 "YYYY-MM-DD HH:mm:ss"(24시간)로 바꾼다.
 * AI-NOTE: 백엔드는 소수 초를 9자리까지 보낸다(예: ...05.351940500Z). 엔진별 파싱 차이를 피하려고 3자리로 잘라 Date를 만든다.
 */
export function formatTime(iso: string): string {
  const d = new Date(iso.replace(/(\.\d{3})\d+/, '$1'));
  if (Number.isNaN(d.getTime())) return iso;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
