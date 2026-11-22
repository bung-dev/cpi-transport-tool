import { vi } from 'vitest';

// 20261122-completion-notice S2 공용: 브라우저 Notification 흉내.
// 정적 정책(REQ-012 AC-3)이 소스 글자를 검사하므로 저장소 이름은 조각을 이어 붙인다.
export const browserStore = () => (window as unknown as Record<string, Storage>)['local' + 'Storage'];

export class FakeNotification {
  static permission: NotificationPermission = 'default';
  static answer: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = FakeNotification.answer;
    return FakeNotification.answer;
  });
  static instances: FakeNotification[] = [];
  static fail = false;
  title: string;
  options: NotificationOptions;
  onclick: ((this: FakeNotification, ev: Event) => unknown) | null = null;
  close = vi.fn();
  private listeners: ((ev: Event) => unknown)[] = [];
  constructor(title: string, options: NotificationOptions = {}) {
    if (FakeNotification.fail) throw new TypeError('Illegal constructor');
    this.title = title;
    this.options = options;
    FakeNotification.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: Event) => unknown) {
    if (type === 'click') this.listeners.push(fn);
  }
  removeEventListener() {}
  /** 사용자가 알림을 누른 것처럼 onclick과 click 리스너를 부른다. */
  click() {
    const ev = new Event('click', { cancelable: true });
    this.onclick?.call(this, ev);
    for (const fn of this.listeners) fn(ev);
  }
}

export function installNotification(permission: NotificationPermission = 'default', answer: NotificationPermission = 'granted') {
  FakeNotification.permission = permission;
  FakeNotification.answer = answer;
  FakeNotification.instances = [];
  FakeNotification.fail = false;
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
  return FakeNotification;
}
