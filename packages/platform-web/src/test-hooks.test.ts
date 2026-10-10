import { describe, expect, it } from 'vitest';
import { ItchAdapter } from './portal/index.js';
import {
  SpyPortalAdapter,
  parseSeed,
  seedOverride,
  withPortalSpy,
  type PortalCall,
} from './test-hooks.js';

const SHARE = 'https://rushwarden.com/';

describe('H1 seed in the URL', () => {
  it('parses a u32 seed', () => {
    expect(parseSeed('?seed=0')).toBe(0);
    expect(parseSeed('?seed=42&x=1')).toBe(42);
    expect(parseSeed('?seed=4294967295')).toBe(4294967295);
  });

  it('ignores anything that is not a decimal u32', () => {
    for (const q of [
      '',
      '?seed=',
      '?seed=-1',
      '?seed=4294967296',
      '?seed=1e3',
      '?seed=0x10',
      '?seed=1.5',
      '?seed=12345678901',
    ])
      expect(parseSeed(q), q).toBeNull();
  });

  it('is ignored outside hooks builds', () => {
    expect(seedOverride('?seed=7', false)).toBeNull();
    expect(seedOverride('?seed=7', true)).toBe(7);
  });
});

describe('H4 spy PortalAdapter', () => {
  it('records every call in order and delegates', async () => {
    const calls: PortalCall[] = [];
    const spy = new SpyPortalAdapter(new ItchAdapter({ shareUrl: SHARE }), calls);
    await spy.init();
    spy.loadingFinished();
    await spy.commercialBreak();
    spy.gameplayStart();
    spy.gameplayStop();
    spy.happyTime();
    expect(spy.shareUrl()).toBe(SHARE);
    expect(spy.canSellInPortal()).toBe(true);
    expect(spy.id).toBe('itch');
    expect(calls).toEqual([
      'init',
      'loadingFinished',
      'commercialBreak',
      'gameplayStart',
      'gameplayStop',
      'happyTime',
      'shareUrl',
      'canSellInPortal',
    ]);
  });

  it('puts the call log on the target and can stand in for poki or crazygames', async () => {
    const target: { __portalCalls?: PortalCall[] } = {};
    const poki = withPortalSpy(
      new ItchAdapter({ shareUrl: SHARE }),
      '?portalSpy=poki',
      target,
      true,
    );
    expect(poki.id).toBe('poki');
    expect(poki.canSellInPortal()).toBe(false);
    await poki.init();
    expect(target.__portalCalls).toEqual(['canSellInPortal', 'init']);

    const cg = withPortalSpy(
      new ItchAdapter({ shareUrl: SHARE }),
      '?portalSpy=crazygames',
      target,
      true,
    );
    expect(cg.id).toBe('crazygames');
    expect(cg.canSellInPortal()).toBe(true);
    expect(cg.shareUrl()).toBe(SHARE);

    const unknown = withPortalSpy(
      new ItchAdapter({ shareUrl: SHARE }),
      '?portalSpy=steam',
      target,
      true,
    );
    expect(unknown.id).toBe('itch');
  });

  it('returns the adapter untouched outside hooks builds', () => {
    const target: { __portalCalls?: PortalCall[] } = {};
    const itch = new ItchAdapter({ shareUrl: SHARE });
    expect(withPortalSpy(itch, '?portalSpy=poki', target, false)).toBe(itch);
    expect(target.__portalCalls).toBeUndefined();
  });
});
