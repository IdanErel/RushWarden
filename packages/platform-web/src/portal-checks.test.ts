/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { AD_MARKERS, INERT_URLS, SDK_URLS, checkPortalFiles } from '../scripts/portal-checks.mjs';
import { CRAZYGAMES_SDK_URL, DEFAULT_SHARE_URL, POKI_SDK_URL } from './portal/index.js';

const file = (name: string, text: string): [string, Buffer] => [name, Buffer.from(text)];
const INDEX = file('index.html', '<script type="module" src="./assets/index-abc.js"></script>');
const build = (portal: 'poki' | 'crazygames', extra = ''): [string, Buffer][] => [
  INDEX,
  file(
    'assets/index-abc.js',
    `const s="${SDK_URLS[portal]}";const $id="${INERT_URLS[0] ?? ''}";async commercialBreak(){}${extra}`,
  ),
];

describe('portal artifact checks (ADR-024)', () => {
  it('knows the SDK URLs the adapters load', () => {
    expect(SDK_URLS).toEqual({ poki: POKI_SDK_URL, crazygames: CRAZYGAMES_SDK_URL });
  });

  it('passes a clean build of each portal', () => {
    expect(checkPortalFiles('poki', build('poki'))).toEqual([]);
    expect(checkPortalFiles('crazygames', build('crazygames'))).toEqual([]);
  });

  it('fails on our website, itch, stores or any other link (point 5)', () => {
    for (const url of [
      DEFAULT_SHARE_URL,
      'https://idanerel.itch.io/rushwarden',
      'https://store.steampowered.com/app/1',
      'https://api.rushwarden.com/ingest',
    ])
      expect(checkPortalFiles('poki', build('poki', `x="${url}"`))).toEqual([
        `assets/index-abc.js has a URL that is not approved for poki: ${url}`,
      ]);
  });

  it("fails on the other portal's SDK, and when its own SDK is missing", () => {
    expect(checkPortalFiles('poki', build('crazygames'))).toEqual([
      `assets/index-abc.js has a URL that is not approved for poki: ${CRAZYGAMES_SDK_URL}`,
      'no poki SDK URL in the bundle: is this a poki build?',
    ]);
  });

  it('allows the privacy policy only when the build sets it', () => {
    const policy = 'https://rushwarden.com/privacy';
    const files = build('crazygames', `p="${policy}"`);
    expect(checkPortalFiles('crazygames', files)).toHaveLength(1);
    expect(checkPortalFiles('crazygames', files, { privacyUrl: policy })).toEqual([]);
  });

  it('fails on ad API calls (decision 1) but not on WebGPU requestAdapter', () => {
    for (const marker of AD_MARKERS)
      expect(checkPortalFiles('poki', build('poki', `sdk.${marker}`))).toEqual([
        `assets/index-abc.js contains an ad API call (${marker})`,
      ]);
    expect(checkPortalFiles('poki', build('poki', 'await gpu.requestAdapter({})'))).toEqual([]);
  });

  it('keeps the itch checks: hooks, maps, root-absolute URLs', () => {
    const errors = checkPortalFiles('poki', [
      file('index.html', `<script src="/assets/x.js"></script>"${SDK_URLS.poki}"`),
      file('assets/x.js.map', '{}'),
      file('assets/h.js', 'window.__portalCalls=[]'),
    ]);
    expect(errors).toEqual([
      'index.html has root-absolute URLs: /assets/x.js',
      'source map in the artifact: assets/x.js.map',
      'assets/h.js contains test-hook code (__portalCalls)',
    ]);
  });
});
