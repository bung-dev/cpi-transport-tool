import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { json, mockApi } from '../../test/mockFetch';
import { TenantForm } from './TenantForm';
import type { Tenant } from '../../api/types';
const SAVED: Tenant = { id: 't-new', name: '새 테넌트', apiHost: 'localhost', source: 'registered', createdAt: null };
afterEach(() => vi.unstubAllGlobals());
// 테스트마다 서로 다른 더미 clientid·clientsecret을 쓴다. 실제 값이 아니다.
function key(tag: string) {
  const clientid = `dummy-cid-318-${tag}`; const clientsecret = `dummy-sec-318-${tag}`;
  return { clientid, clientsecret, text: JSON.stringify({ oauth: { url: 'http://localhost:18082', tokenurl: 'http://localhost:18082/oauth/token', clientid, clientsecret } }) };
}
function form(props: Partial<Parameters<typeof TenantForm>[0]> = {}) {
  const onSuccess = vi.fn(async () => {});
  render(<TenantForm onSuccess={onSuccess} {...props} />);
  return onSuccess;
}
async function typeName(value: string) {
  await userEvent.clear(screen.getByLabelText('이름')); await userEvent.type(screen.getByLabelText('이름'), value);
}
async function paste(text: string) {
  await userEvent.click(screen.getByLabelText('서비스 키 붙여넣기')); await userEvent.paste(text);
}
async function choose(text: string) {
  const file = new File([text], 'dummy.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  await userEvent.upload(screen.getByLabelText('서비스 키 파일'), file);
  expect((screen.getByLabelText('서비스 키 파일') as HTMLInputElement).files).toHaveLength(1);
}
async function submit(label = '등록') { await userEvent.click(screen.getByRole('button', { name: label })); }
function keyInputsEmpty() {
  expect(screen.getByLabelText('서비스 키 붙여넣기')).toHaveValue('');
  const file = screen.getByLabelText('서비스 키 파일') as HTMLInputElement;
  expect(file.files).toHaveLength(0); expect(file).toHaveValue('');
}
function secretsAbsent(k: { clientid: string; clientsecret: string }) {
  const values = [...document.querySelectorAll('input, textarea')].map(el => (el as HTMLInputElement | HTMLTextAreaElement).value);
  expect(values.length).toBeGreaterThanOrEqual(3);
  const attrs = [...document.body.querySelectorAll('*')].flatMap(el => [...el.attributes].map(a => a.value));
  for (const s of [k.clientid, k.clientsecret]) {
    expect(document.body.textContent).not.toContain(s);
    for (const v of [...values, ...attrs]) expect(v).not.toContain(s);
  }
}
it.each([
  [400, 'INVALID_SERVICE_KEY', '서비스 키가 올바르지 않습니다'],
  [409, 'TENANT_NAME_DUPLICATE', '같은 이름의 테넌트가 이미 있습니다'],
] as const)('REQ-318 AC-1·AC-2: 등록 서버 오류 %s 뒤 키 입력 비움, 이름 유지, 키 문자열 부재와 오류 안내', async (status, error, title) => {
  const k = key(`srv${status}`); let posted = 0;
  const onSuccess = form(); mockApi({ 'POST /tenants': () => { posted++; return json({ error, message: 'fixed server message' }, status); } });
  await typeName('실패 테넌트'); await paste(k.text);
  expect(screen.getByLabelText('서비스 키 붙여넣기')).toHaveValue(k.text);
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(title); expect(screen.getByRole('alert')).toHaveTextContent('fixed server message');
  expect(posted).toBe(1); expect(onSuccess).not.toHaveBeenCalled();
  keyInputsEmpty(); expect(screen.getByLabelText('이름')).toHaveValue('실패 테넌트'); secretsAbsent(k);
});
it('REQ-318 AC-1·AC-2: 등록 네트워크 오류(fetch reject) 뒤 키 입력 비움, 이름 유지, 키 문자열 부재와 오류 안내', async () => {
  const k = key('net'); const fn = mockApi({ 'POST /tenants': () => { throw new TypeError('Failed to fetch'); } });
  const onSuccess = form(); await typeName('네트워크 테넌트'); await paste(k.text); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다');
  expect(fn).toHaveBeenCalledTimes(1); expect(onSuccess).not.toHaveBeenCalled();
  keyInputsEmpty(); expect(screen.getByLabelText('이름')).toHaveValue('네트워크 테넌트'); secretsAbsent(k);
});
it('REQ-318 AC-1·AC-2: 요청 전 JSON 형식 검사 실패 뒤 키 입력 비움, 이름 유지, 키 문자열 부재와 오류 안내, 요청 없음', async () => {
  const k = key('bad'); const broken = k.text.slice(0, -1); const fn = mockApi({});
  const onSuccess = form(); await typeName('형식 테넌트'); await paste(broken);
  expect(screen.getByLabelText('서비스 키 붙여넣기')).toHaveValue(broken);
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('서비스 키 JSON 형식이 아닙니다');
  expect(fn).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled();
  keyInputsEmpty(); expect(screen.getByLabelText('이름')).toHaveValue('형식 테넌트'); secretsAbsent(k);
});
it('REQ-318 AC-1·AC-2: 파일 선택 뒤 서버 오류면 파일 선택과 붙여넣기가 모두 지워지고 이름 유지, 키 문자열 부재', async () => {
  const pasted = key('file-paste'); const fromFile = key('file-sel'); let body: unknown;
  form(); mockApi({ 'POST /tenants': init => { body = JSON.parse(init?.body as string); return json({ error: 'INVALID_SERVICE_KEY', message: 'fixed server message' }, 400); } });
  await typeName('파일 테넌트'); await paste(pasted.text); await choose(fromFile.text); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('서비스 키가 올바르지 않습니다');
  expect(body).toEqual({ name: '파일 테넌트', serviceKey: JSON.parse(fromFile.text) });
  keyInputsEmpty(); expect(screen.getByLabelText('이름')).toHaveValue('파일 테넌트'); secretsAbsent(pasted); secretsAbsent(fromFile);
});
it('REQ-318 AC-1·AC-2: 파일 선택 뒤 파일 내용의 JSON 형식 검사 실패면 파일 선택이 지워지고 이름 유지, 요청 없음', async () => {
  const k = key('file-bad'); const fn = mockApi({});
  form(); await typeName('파일 형식 테넌트'); await choose(k.text.slice(0, -1)); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('서비스 키 JSON 형식이 아닙니다');
  expect(fn).not.toHaveBeenCalled(); keyInputsEmpty(); expect(screen.getByLabelText('이름')).toHaveValue('파일 형식 테넌트'); secretsAbsent(k);
});
it.each([
  ['서버 오류 409', () => json({ error: 'TENANT_NAME_DUPLICATE', message: 'fixed server message' }, 409), '같은 이름의 테넌트가 이미 있습니다'],
  ['네트워크 오류', () => { throw new TypeError('Failed to fetch'); }, '서버에 연결할 수 없습니다'],
] as const)('REQ-318 AC-1·AC-2: 수정 모드 %s 뒤 키 입력 비움, 바꾼 이름 유지, 키 문자열 부재와 오류 안내', async (_label, handler, title) => {
  const k = key(`edit-${_label === '네트워크 오류' ? 'net' : 'srv'}`); let puts = 0;
  const onSuccess = form({ tenantId: SAVED.id, initialName: SAVED.name, onCancel: () => {} });
  mockApi({ 'PUT /tenants/t-new': () => { puts++; return handler(); } });
  expect(screen.getByLabelText('이름')).toHaveValue(SAVED.name);
  await typeName('바꾼 이름'); await paste(k.text); await submit('저장');
  expect(await screen.findByRole('alert')).toHaveTextContent(title);
  expect(puts).toBe(1); expect(onSuccess).not.toHaveBeenCalled();
  keyInputsEmpty(); expect(screen.getByLabelText('이름')).toHaveValue('바꾼 이름'); secretsAbsent(k);
});
it('REQ-318 AC-1: 수정 모드에서 키 없이 이름만 바꿔 실패해도 오류 안내가 보이고 이름 유지, 키 입력은 빈 채로', async () => {
  let body: unknown; const onSuccess = form({ tenantId: SAVED.id, initialName: SAVED.name });
  mockApi({ 'PUT /tenants/t-new': init => { body = JSON.parse(init?.body as string); return json({ error: 'TENANT_NAME_DUPLICATE', message: 'fixed server message' }, 409); } });
  await typeName('겹치는 이름'); await submit('저장');
  expect(await screen.findByRole('alert')).toHaveTextContent('같은 이름의 테넌트가 이미 있습니다');
  expect(body).toEqual({ name: '겹치는 이름' }); expect(onSuccess).not.toHaveBeenCalled();
  keyInputsEmpty(); expect(screen.getByLabelText('이름')).toHaveValue('겹치는 이름');
  expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
});
it('REQ-318 AC-1·AC-2: 요청 성공 뒤 onSuccess가 실패해도 키 입력은 비워지고 키 문자열 부재와 오류 안내', async () => {
  const k = key('after'); const onSuccess = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
  mockApi({ 'POST /tenants': () => json(SAVED, 201) });
  render(<TenantForm onSuccess={onSuccess} />);
  await typeName('후속 테넌트'); await paste(k.text); await choose(key('after-file').text); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다');
  expect(onSuccess).toHaveBeenCalledTimes(1); keyInputsEmpty(); secretsAbsent(k); secretsAbsent(key('after-file'));
});
it('REQ-318 AC-3 / REQ-301 AC-8: 등록 성공은 지금처럼 이름·키 입력·파일 선택을 모두 비우고 onSuccess를 부른다', async () => {
  const k = key('ok'); let body: unknown;
  mockApi({ 'POST /tenants': init => { body = JSON.parse(init?.body as string); return json(SAVED, 201); } });
  const onSuccess = form(); await typeName('새 테넌트'); await paste(k.text); await submit();
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  expect(body).toEqual({ name: '새 테넌트', serviceKey: JSON.parse(k.text) });
  expect(screen.getByLabelText('이름')).toHaveValue(''); keyInputsEmpty(); expect(screen.queryByRole('alert')).toBeNull(); secretsAbsent(k);
  const f = key('ok-file'); await typeName('파일 테넌트'); await choose(f.text); await submit();
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
  expect(body).toEqual({ name: '파일 테넌트', serviceKey: JSON.parse(f.text) });
  expect(screen.getByLabelText('이름')).toHaveValue(''); keyInputsEmpty(); expect(screen.queryByRole('alert')).toBeNull(); secretsAbsent(f);
});
it('REQ-318 AC-1·AC-3·AC-4: 실패 뒤 다시 입력해 성공하면 이름·키가 모두 비워지고 실패 때 비운 키는 다시 넣은 값만 전송', async () => {
  const first = key('retry-1'); const second = key('retry-2'); const bodies: unknown[] = []; let fail = true;
  mockApi({ 'POST /tenants': init => {
    bodies.push(JSON.parse(init?.body as string));
    if (fail) { fail = false; return json({ error: 'INVALID_SERVICE_KEY', message: 'fixed server message' }, 400); }
    return json(SAVED, 201);
  } });
  const onSuccess = form(); await typeName('다시 테넌트'); await paste(first.text); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('서비스 키가 올바르지 않습니다');
  keyInputsEmpty(); expect(screen.getByLabelText('이름')).toHaveValue('다시 테넌트'); secretsAbsent(first);
  await paste(second.text); expect(screen.getByLabelText('서비스 키 붙여넣기')).toHaveValue(second.text); await submit();
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  expect(bodies).toEqual([{ name: '다시 테넌트', serviceKey: JSON.parse(first.text) }, { name: '다시 테넌트', serviceKey: JSON.parse(second.text) }]);
  expect(screen.getByLabelText('이름')).toHaveValue(''); keyInputsEmpty(); expect(screen.queryByRole('alert')).toBeNull(); secretsAbsent(second);
});
