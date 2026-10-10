/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { readZip as readBack, zipEntries } from '../scripts/zip.mjs';

/** Reads a zip's central directory back: the format check for our writer. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26);
    const body = zip.subarray(dataStart, dataStart + size);
    out.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    p += 46 + nameLen;
  }
  return out;
}

describe('itch zip writer', () => {
  const entries: [string, Buffer][] = [
    ['index.html', Buffer.from('<!doctype html>'.repeat(50))],
    ['assets/index-abc.js', Buffer.from('console.log(1)')],
  ];

  it('round-trips files, deflated or stored', () => {
    const files = readZip(zipEntries(entries));
    expect([...files.keys()]).toEqual(['index.html', 'assets/index-abc.js']);
    for (const [name, data] of entries) expect(files.get(name)?.equals(data)).toBe(true);
  });

  it('is byte-identical for the same input (no timestamps)', () => {
    expect(zipEntries(entries).equals(zipEntries(entries))).toBe(true);
  });

  it('readZip (used by the itch smoke test) returns exactly the entries written', () => {
    expect(readBack(zipEntries(entries))).toEqual(entries);
  });
});
