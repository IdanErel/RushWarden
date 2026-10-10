/**
 * Store-asset compositor (P1-QA-03), loaded with the clip page so it shares its bundle: it runs
 * src/store.ts's draw operations on a 2D canvas. cli/store.ts grabs the frames with the clip
 * page first, then calls `store.compose` on a fresh page.
 */
import { SHOTS, storeAssets, type ShotFrame, type StoreOp } from '../src/store.js';

export interface ComposedAsset {
  readonly id: string;
  readonly store: string;
  readonly role: string;
  readonly width: number;
  readonly height: number;
  readonly shots: readonly string[];
  /** How much a frame was enlarged to fill its slot; over 1 means some softness. */
  readonly maxUpscale: number | null;
  readonly png: string;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function draw(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  ops: readonly StoreOp[],
  transparent: boolean,
  bitmaps: ReadonlyMap<string, ImageBitmap>,
): void {
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  for (const op of ops) {
    g.globalAlpha = 1;
    if (op.op === 'fill') {
      if (transparent) continue;
      g.fillStyle = hex(op.color);
      g.fillRect(0, 0, w, h);
    } else if (op.op === 'rect') {
      g.globalAlpha = op.alpha ?? 1;
      g.fillStyle = hex(op.color);
      g.beginPath();
      g.roundRect(op.x, op.y, op.w, op.h, op.radius ?? 0);
      g.fill();
    } else if (op.op === 'image') {
      const b = bitmaps.get(op.shot);
      if (!b) throw new Error(`no frame for shot "${op.shot}"`);
      const { src: s, dst: d } = op;
      g.drawImage(b, s.x, s.y, s.w, s.h, d.x, d.y, d.w, d.h);
    } else {
      g.strokeStyle = hex(op.color);
      g.lineWidth = op.width;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const line of op.lines) {
        g.beginPath();
        line.forEach(([x, y], k) => (k === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
        g.stroke();
      }
    }
  }
}

/** Composes every asset (or those in `only`) from the grabbed frames and their PNG data URLs. */
async function compose(
  frames: readonly ShotFrame[],
  images: Readonly<Record<string, string>>,
  only: readonly string[] | null,
): Promise<ComposedAsset[]> {
  const bitmaps = new Map<string, ImageBitmap>();
  for (const [k, url] of Object.entries(images))
    bitmaps.set(k, await createImageBitmap(await (await fetch(url)).blob()));
  const assets = storeAssets(new Map(frames.map((f) => [f.id, f])));
  const out: ComposedAsset[] = [];
  for (const a of assets) {
    if (only && !only.includes(a.id)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = a.width;
    canvas.height = a.height;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no 2d context');
    draw(g, a.width, a.height, a.ops, a.transparent, bitmaps);
    const images = a.ops.flatMap((o) => (o.op === 'image' ? [o] : []));
    out.push({
      id: a.id,
      store: a.store,
      role: a.role,
      width: a.width,
      height: a.height,
      shots: [...new Set(images.map((o) => o.shot))],
      maxUpscale: images.length
        ? Number(Math.max(...images.map((o) => o.dst.w / o.src.w)).toFixed(3))
        : null,
      png: canvas.toDataURL('image/png'),
    });
  }
  return out;
}

Object.assign(window, { store: { shots: SHOTS, compose } });
