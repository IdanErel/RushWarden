/** Turns shape-grammar data into Pixi drawing calls. */
import type { GraphicsContext } from 'pixi.js';
import type { Palette } from '../palette.js';
import type { Shape } from '../shapes.js';

/**
 * Draws `shapes` into `ctx`, scaling shape units by `scale` px and offsetting by (ox, oy) px.
 * Shapes are built in their own units so the same data serves 12 px vehicles and 48 px glyphs.
 */
export function drawShapes(
  ctx: GraphicsContext,
  shapes: readonly Shape[],
  palette: Palette,
  scale: number,
  ox = 0,
  oy = 0,
): GraphicsContext {
  for (const s of shapes) {
    switch (s.kind) {
      case 'rect':
        ctx.roundRect(ox + s.x * scale, oy + s.y * scale, s.w * scale, s.h * scale, s.r * scale);
        break;
      case 'circle':
        ctx.circle(ox + s.x * scale, oy + s.y * scale, s.r * scale);
        break;
      case 'poly':
        ctx.poly(
          s.points.map((v, i) => (i % 2 === 0 ? ox : oy) + v * scale),
          true,
        );
        break;
    }
    if (s.fill) ctx.fill(palette[s.fill]);
    if (s.stroke)
      ctx.stroke({
        color: palette[s.stroke],
        width: Math.max(1, (s.strokeWidth ?? 0.05) * scale),
        alignment: 0.5,
      });
  }
  return ctx;
}
