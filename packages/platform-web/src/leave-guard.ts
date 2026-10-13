/**
 * Playtest S1: there is no save until Phase 2, so reloading or closing the tab mid-run loses the
 * run. While a run is in progress the page asks before it unloads; on the end screen it does not.
 *
 * Browsers show their own wording ("Leave site? Changes you may have made may not be saved") and
 * ignore custom text, and they only ask after the player has interacted with the page. The
 * listener exists only while the guard is on, so a page with no run in progress stays eligible
 * for the back/forward cache.
 */
export const LEAVE_MESSAGE = 'Leave this run? It will be lost.';

type UnloadTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export interface LeaveGuard {
  /** True while a run is in progress: the page asks before unloading. */
  set(inRun: boolean): void;
}

export function leaveGuard(target: UnloadTarget): LeaveGuard {
  const ask = (e: BeforeUnloadEvent): string => {
    e.preventDefault();
    // Older browsers show the dialog only when returnValue is set.
    e.returnValue = LEAVE_MESSAGE;
    return LEAVE_MESSAGE;
  };
  let on = false;
  return {
    set(inRun) {
      if (inRun === on) return;
      on = inRun;
      if (on) target.addEventListener('beforeunload', ask);
      else target.removeEventListener('beforeunload', ask);
    },
  };
}
