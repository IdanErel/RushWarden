import { describe, expect, it } from 'vitest';
import {
  DevEntitlement,
  JsonSaveStore,
  LockedEntitlement,
  MemoryBackend,
  NullPortalAdapter,
  flags,
} from '../src/index.js';

describe('NullPortalAdapter', () => {
  it('implements every hook without side effects', async () => {
    const p = new NullPortalAdapter('https://x.test/');
    await p.init();
    p.gameplayStart();
    p.gameplayStop();
    await p.commercialBreak();
    p.happyTime();
    expect(p.shareUrl()).toBe('https://x.test/');
    expect(p.canSellInPortal()).toBe(false);
    expect(p.id).toBe('none');
  });
});

describe('Entitlement', () => {
  it('locked entitlement cannot sell', async () => {
    const e = new LockedEntitlement();
    expect(e.isUnlocked()).toBe(false);
    expect(e.source).toBe('none');
    expect(await e.purchase()).toEqual({ ok: false, reason: 'unavailable' });
    expect(await e.restore()).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('dev entitlement unlocks and restores', async () => {
    const e = new DevEntitlement();
    expect((await e.restore()).ok).toBe(false);
    expect(await e.purchase()).toEqual({ ok: true });
    expect(e.isUnlocked()).toBe(true);
    expect(e.source).toBe('web');
    expect((await e.restore()).ok).toBe(true);
  });
});

describe('JsonSaveStore', () => {
  const id = () => 'uuid-1';

  it('returns a fresh document when empty or corrupt, and round-trips', async () => {
    const b = new MemoryBackend();
    const s = new JsonSaveStore(b, id);
    expect(await s.load()).toEqual({ version: 1, installId: 'uuid-1', settings: {}, slices: {} });
    await s.save({ version: 1, installId: 'a', settings: { music: 5 }, slices: {} });
    expect((await s.load()).settings).toEqual({ music: 5 });
    b.data.set('rushwarden-save', '{nope');
    expect((await s.load()).installId).toBe('uuid-1');
    b.data.set('rushwarden-save', JSON.stringify({ version: 99 }));
    expect((await s.load()).version).toBe(1);
    await s.clear();
    expect(b.data.size).toBe(0);
  });

  it('migrates older documents forward', async () => {
    const b = new MemoryBackend();
    b.data.set(
      'rushwarden-save',
      JSON.stringify({ version: 1, installId: 'a', settings: {}, slices: {} }),
    );
    const s = new JsonSaveStore(b, id, [(d) => ({ ...d, slices: { migrated: true } })], 2);
    const doc = await s.load();
    expect(doc.version).toBe(2);
    expect(doc.slices).toEqual({ migrated: true });
  });

  it('requires one migration per version step', () => {
    expect(() => new JsonSaveStore(new MemoryBackend(), id, [], 2)).toThrow(RangeError);
  });

  it('flags default off', () => {
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
  });
});
