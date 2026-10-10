import { describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { handleIngest, type IngestEnv } from '../src/ingest/handler.js';
import { fakeD1 } from './fake-d1.js';
import { INSTALL, INSTALL_2, VALID } from './fixtures.js';

const ORIGIN = 'https://html-classic.itch.zone';
const IP = '203.0.113.77';
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);

function setup(over: Partial<IngestEnv> = {}, without: (keyof IngestEnv)[] = []) {
  const { db, raw } = fakeD1();
  const env: IngestEnv = {
    DB: db,
    INGEST_ENABLED: 'true',
    ALLOWED_ORIGINS: 'https://*.itch.zone, https://rushwarden.com',
    STATS_TOKEN: 'secret-token',
    ...over,
  };
  for (const key of without) Reflect.deleteProperty(env, key);
  let clock = NOW;
  const call = (req: Request) => handleIngest(req, env, { now: () => clock });
  const rows = () =>
    raw.prepare('SELECT * FROM events ORDER BY id').all() as Record<string, unknown>[];
  return { env, call, rows, raw, setClock: (t: number) => (clock = t) };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://api.rushwarden.com/ingest', {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'text/plain;charset=UTF-8',
      'cf-connecting-ip': IP,
      'x-forwarded-for': IP,
      'x-real-ip': IP,
      'user-agent': 'Mozilla/5.0 test',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /ingest', () => {
  it('stores each valid event with the server receipt time and nothing else', async () => {
    const t = setup();
    for (const e of Object.values(VALID)) {
      const res = await t.call(post(e));
      expect(res?.status).toBe(204);
      expect(res?.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    }
    const rows = t.rows();
    expect(rows).toHaveLength(4);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        'device_class',
        'event',
        'id',
        'install',
        'locale',
        'platform',
        'props',
        'received_at',
        'version',
      ].sort(),
    );
    expect(rows.map((r) => r['received_at'])).toEqual([NOW, NOW, NOW, NOW]);
    expect(JSON.parse(rows[2]!['props'] as string)).toEqual(VALID.round_end.props);
  });

  it('never stores an IP address or user agent, wherever they appear in the request', async () => {
    const t = setup();
    await t.call(post(VALID.run_start));
    const dump = JSON.stringify(t.raw.prepare('SELECT * FROM events').all());
    expect(dump).not.toContain(IP);
    expect(dump).not.toContain('Mozilla');
    const columns = t.raw.prepare("SELECT name FROM pragma_table_info('events')").all();
    expect(JSON.stringify(columns)).not.toMatch(/ip|agent|addr/i);
  });

  it('rejects other events, extra fields and a client timestamp, storing nothing', async () => {
    const t = setup();
    const bad = [
      { ...VALID.app_open, event: 'share' },
      { ...VALID.app_open, ts: NOW - 5000 },
      { ...VALID.app_open, ip: IP },
      [VALID.app_open, VALID.run_start],
      'not json',
    ];
    for (const b of bad) expect((await t.call(post(b)))?.status).toBe(400);
    expect(t.rows()).toHaveLength(0);
  });

  it('stores nothing while ingest is off (the default)', async () => {
    for (const flag of [undefined, 'false', 'TRUE', '1']) {
      const t =
        flag === undefined ? setup({}, ['INGEST_ENABLED']) : setup({ INGEST_ENABLED: flag });
      expect((await t.call(post(VALID.app_open)))?.status).toBe(503);
      expect(t.rows()).toHaveLength(0);
    }
  });

  it('accepts only allowed origins and requires one', async () => {
    const t = setup();
    expect((await t.call(post(VALID.app_open, { origin: 'https://evil.example' })))?.status).toBe(
      403,
    );
    expect(
      (await t.call(post(VALID.app_open, { origin: 'https://itch.zone.evil.example' })))?.status,
    ).toBe(403);
    expect(
      (await t.call(post(VALID.app_open, { origin: 'http://html-classic.itch.zone' })))?.status,
    ).toBe(403);
    const noOrigin = new Request('https://api.rushwarden.com/ingest', {
      method: 'POST',
      body: JSON.stringify(VALID.app_open),
    });
    expect((await t.call(noOrigin))?.status).toBe(403);
    expect((await t.call(post(VALID.app_open, { origin: 'https://rushwarden.com' })))?.status).toBe(
      204,
    );
    expect(t.rows()).toHaveLength(1);
  });

  it('answers the CORS preflight for allowed origins', async () => {
    const t = setup();
    const res = await t.call(
      new Request('https://api.rushwarden.com/ingest', {
        method: 'OPTIONS',
        headers: { origin: ORIGIN },
      }),
    );
    expect(res?.status).toBe(204);
    expect(res?.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('rejects oversized bodies and wrong methods', async () => {
    const t = setup();
    const big = JSON.stringify({ ...VALID.app_open, pad: 'x'.repeat(3000) });
    expect((await t.call(post(big)))?.status).toBe(413);
    expect((await t.call(post(big, { 'content-length': '999999' })))?.status).toBe(413);
    const get = new Request('https://api.rushwarden.com/ingest', { headers: { origin: ORIGIN } });
    expect((await t.call(get))?.status).toBe(405);
  });

  it('rate-limits by install ID, never by IP', async () => {
    const keys: string[] = [];
    const t = setup({
      RATE_LIMITER: {
        limit: async ({ key }) => {
          keys.push(key);
          return { success: keys.length < 2 };
        },
      },
    });
    expect((await t.call(post(VALID.app_open)))?.status).toBe(204);
    expect((await t.call(post(VALID.app_open)))?.status).toBe(429);
    expect(keys).toEqual([INSTALL, INSTALL]);
    expect(t.rows()).toHaveLength(1);
  });
});

describe('DELETE /ingest/:install', () => {
  it('deletes every event of one install, even while ingest is off', async () => {
    const t = setup();
    await t.call(post(VALID.app_open));
    await t.call(post({ ...VALID.app_open, install: INSTALL_2 }));
    t.env.INGEST_ENABLED = 'false';
    const del = (id: string) =>
      t.call(new Request(`https://api.rushwarden.com/ingest/${id}`, { method: 'DELETE' }));
    expect((await del(INSTALL))?.status).toBe(204);
    expect((await del(INSTALL))?.status).toBe(204);
    expect((await del('nope'))?.status).toBe(400);
    expect(t.rows().map((r) => r['install'])).toEqual([INSTALL_2]);
  });
});

describe('GET /ingest/sessions', () => {
  const get = (q: string, token?: string) =>
    new Request(`https://api.rushwarden.com/ingest/sessions?${q}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('returns the session summary for a platform and window, without install IDs', async () => {
    const t = setup();
    t.setClock(NOW);
    await t.call(post(VALID.app_open));
    t.setClock(NOW + 150_000);
    await t.call(post(VALID.run_end));
    t.setClock(NOW + 1000);
    await t.call(post({ ...VALID.app_open, install: INSTALL_2 }));
    await t.call(post({ ...VALID.app_open, platform: 'poki' }));

    const res = await t.call(
      get(`platform=itch&from=${NOW}&to=2026-10-11T00:00:00Z`, 'secret-token'),
    );
    expect(res?.status).toBe(200);
    const text = await res!.text();
    expect(JSON.parse(text)).toMatchObject({
      platform: 'itch',
      sessions: 2,
      installs: 2,
      medianMs: 0,
      p75Ms: 150_000,
    });
    expect(text).not.toContain(INSTALL);
  });

  it('requires the token, and does not exist without one', async () => {
    const t = setup();
    expect((await t.call(get('platform=itch&from=0&to=1')))?.status).toBe(401);
    expect((await t.call(get('platform=itch&from=0&to=1', 'wrong-token!')))?.status).toBe(401);
    expect((await t.call(get('platform=mars&from=0&to=1', 'secret-token')))?.status).toBe(400);
    const off = setup({}, ['STATS_TOKEN']);
    expect((await off.call(get('platform=itch&from=0&to=1', 'secret-token')))?.status).toBe(404);
  });
});

describe('worker entry', () => {
  it('routes /ingest and 404s everything else', async () => {
    const { env, rows } = setup();
    expect((await worker.fetch(post(VALID.app_open), env)).status).toBe(204);
    expect(rows()[0]!['received_at']).toBeGreaterThan(NOW - 365 * 86_400_000);
    expect(
      (await worker.fetch(new Request('https://api.rushwarden.com/leaderboard'), env)).status,
    ).toBe(404);
    expect(
      (await worker.fetch(new Request('https://api.rushwarden.com/ingest/x'), env)).status,
    ).toBe(404);
  });
});
