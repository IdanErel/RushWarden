import { describe, expect, it } from 'vitest';
import { LEAVE_MESSAGE, leaveGuard, leaveGuardFor } from './leave-guard.js';

/** A window stand-in that keeps its beforeunload listeners and fires a cancelable event. */
function fakeWindow() {
  const listeners = new Set<EventListener>();
  return {
    addEventListener: (type: string, fn: EventListener) => {
      if (type === 'beforeunload') listeners.add(fn);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      if (type === 'beforeunload') listeners.delete(fn);
    },
    listeners,
    /** Fires beforeunload; true when a listener asked the browser to confirm. */
    unload(): boolean {
      const e = { returnValue: '', defaultPrevented: false } as unknown as BeforeUnloadEvent & {
        defaultPrevented: boolean;
      };
      (e as { preventDefault: () => void }).preventDefault = () => {
        (e as { defaultPrevented: boolean }).defaultPrevented = true;
      };
      for (const fn of listeners) fn(e);
      return e.defaultPrevented && e.returnValue === LEAVE_MESSAGE;
    },
  };
}

describe('leave guard (playtest S1)', () => {
  it('asks before unloading only while a run is in progress', () => {
    const win = fakeWindow();
    const guard = leaveGuard(win as unknown as Window);
    expect(win.unload()).toBe(false);
    guard.set(true); // run in progress
    expect(win.unload()).toBe(true);
    guard.set(false); // end screen
    expect(win.unload()).toBe(false);
    expect(win.listeners.size).toBe(0); // no listener left behind (back/forward cache)
    guard.set(true); // Retry starts a new run
    expect(win.unload()).toBe(true);
  });

  it('adds one listener however often it is switched on', () => {
    const win = fakeWindow();
    const guard = leaveGuard(win as unknown as Window);
    guard.set(true);
    guard.set(true);
    expect(win.listeners.size).toBe(1);
  });

  it('guards the own-site and itch builds only, never Poki or CrazyGames', () => {
    for (const portal of [undefined, '', 'none', 'itch']) {
      const win = fakeWindow();
      leaveGuardFor(portal, win as unknown as Window).set(true);
      expect(win.unload(), String(portal)).toBe(true);
    }
    for (const portal of ['poki', 'crazygames']) {
      const win = fakeWindow();
      leaveGuardFor(portal, win as unknown as Window).set(true);
      expect(win.listeners.size, portal).toBe(0);
      expect(win.unload(), portal).toBe(false);
    }
  });
});
