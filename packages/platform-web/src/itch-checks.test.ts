/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  HOOK_MARKERS,
  MAX_FILES,
  ZIP_LIMIT,
  checkItchFiles,
  checkZipSize,
} from '../scripts/itch-checks.mjs';

const file = (name: string, text: string): [string, Buffer] => [name, Buffer.from(text)];
const INDEX = file('index.html', '<script type="module" src="./assets/index-abc.js"></script>');
const JS = file('assets/index-abc.js', 'console.log("sim ok")');
const clean = (): [string, Buffer][] => [INDEX, JS];

describe('itch artifact checks', () => {
  it('passes a clean build', () => {
    expect(checkItchFiles(clean())).toEqual([]);
    expect(checkZipSize(ZIP_LIMIT)).toEqual([]);
  });

  it('fails when test hooks leak into the build', () => {
    for (const marker of HOOK_MARKERS) {
      const errors = checkItchFiles([...clean(), file('assets/hooks-x.js', `window.${marker}=[]`)]);
      expect(errors).toEqual([`assets/hooks-x.js contains test-hook code (${marker})`]);
    }
  });

  it('fails on source maps and sourceMappingURL comments', () => {
    expect(checkItchFiles([...clean(), file('assets/index-abc.js.map', '{}')])).toEqual([
      'source map in the artifact: assets/index-abc.js.map',
    ]);
    expect(
      checkItchFiles([
        INDEX,
        file('assets/index-abc.js', 'x\n//# sourceMappingURL=index-abc.js.map'),
      ]),
    ).toEqual(['assets/index-abc.js references a source map']);
  });

  it('fails on root-absolute URLs, a missing index.html, too many files or a big zip', () => {
    expect(checkItchFiles([file('index.html', '<link href="/a.css">'), JS])).toEqual([
      'index.html has root-absolute URLs: /a.css',
    ]);
    expect(checkItchFiles([JS])).toEqual(['index.html must be at the root of the zip']);
    const many = Array.from({ length: MAX_FILES }, (_, i) => file(`assets/f${i}.bin`, ''));
    expect(checkItchFiles([...clean(), ...many])).toEqual([
      `${MAX_FILES + 2} files; the limit is ${MAX_FILES}`,
    ]);
    expect(checkZipSize(ZIP_LIMIT + 1)[0]).toMatch(/^zip is 7\.500 MB; budget 7\.5 MB$/);
  });

  it('does not scan binary assets for markers', () => {
    expect(checkItchFiles([...clean(), file('assets/font.woff2', 'portalSpy')])).toEqual([]);
  });
});
