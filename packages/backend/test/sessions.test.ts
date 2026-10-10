import { describe, expect, it } from 'vitest';
import { SESSION_GAP_MS, sessionLengths, summarizeSessions } from '../src/ingest/sessions.js';
import type { StoredEvent } from '../src/ingest/store.js';
import { INSTALL, INSTALL_2 } from './fixtures.js';

const s = 1000;
const ev = (install: string, receivedAt: number, event: StoredEvent['event'] = 'round_end') => ({
  install,
  receivedAt,
  event,
});

describe('sessionLengths (ADR-010)', () => {
  it('measures app_open to the last event, by receipt time', () => {
    expect(
      sessionLengths([
        ev(INSTALL, 0, 'app_open'),
        ev(INSTALL, 10 * s, 'run_start'),
        ev(INSTALL, 190 * s, 'run_end'),
      ]),
    ).toEqual([190 * s]);
  });

  it('counts an app_open alone as 0 s, so bounces pull the median down', () => {
    expect(sessionLengths([ev(INSTALL, 0, 'app_open')])).toEqual([0]);
  });

  it('splits on a gap of more than 30 minutes, not exactly 30', () => {
    expect(
      sessionLengths([
        ev(INSTALL, 0, 'app_open'),
        ev(INSTALL, SESSION_GAP_MS),
        ev(INSTALL, 2 * SESSION_GAP_MS + 1),
      ]),
    ).toEqual([SESSION_GAP_MS, 0]);
  });

  it('starts a new session on every app_open and per install', () => {
    expect(
      sessionLengths([
        ev(INSTALL, 0, 'app_open'),
        ev(INSTALL, 60 * s),
        ev(INSTALL, 70 * s, 'app_open'),
        ev(INSTALL, 100 * s),
        ev(INSTALL_2, 5 * s, 'app_open'),
        ev(INSTALL_2, 300 * s),
      ]),
    ).toEqual([60 * s, 30 * s, 295 * s]);
  });

  it('summarizes with the lower median and no install IDs', () => {
    const out = summarizeSessions([
      ev(INSTALL, 0, 'app_open'),
      ev(INSTALL, 100 * s),
      ev(INSTALL, 10 * 60 * 60 * s, 'app_open'),
      ev(INSTALL, 10 * 60 * 60 * s + 200 * s),
      ev(INSTALL_2, 0, 'app_open'),
    ]);
    expect(out).toEqual({ sessions: 3, installs: 2, medianMs: 100 * s, p25Ms: 0, p75Ms: 200 * s });
    expect(JSON.stringify(out)).not.toContain(INSTALL);
    expect(summarizeSessions([])).toEqual({
      sessions: 0,
      installs: 0,
      medianMs: 0,
      p25Ms: 0,
      p75Ms: 0,
    });
  });
});
