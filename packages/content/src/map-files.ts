/**
 * The bundled map templates: every file in `packages/content/maps/`, imported statically like the
 * cards. A test fails if this list and the directory disagree.
 */
import type { MapFile } from './maps.js';
import mapD1_01 from '../maps/d1-01.json' with { type: 'json' };
import mapD1_02 from '../maps/d1-02.json' with { type: 'json' };
import mapD1_03 from '../maps/d1-03.json' with { type: 'json' };
import mapD1_04 from '../maps/d1-04.json' with { type: 'json' };
import mapD1_05 from '../maps/d1-05.json' with { type: 'json' };
import mapD1_06 from '../maps/d1-06.json' with { type: 'json' };
import mapD1_07 from '../maps/d1-07.json' with { type: 'json' };
import mapD1_08 from '../maps/d1-08.json' with { type: 'json' };
import mapD1_09 from '../maps/d1-09.json' with { type: 'json' };
import mapD1_10 from '../maps/d1-10.json' with { type: 'json' };
import mapD1_11 from '../maps/d1-11.json' with { type: 'json' };
import mapD1_12 from '../maps/d1-12.json' with { type: 'json' };

export const MAP_FILES: readonly MapFile[] = [
  { source: 'd1-01.json', data: mapD1_01 },
  { source: 'd1-02.json', data: mapD1_02 },
  { source: 'd1-03.json', data: mapD1_03 },
  { source: 'd1-04.json', data: mapD1_04 },
  { source: 'd1-05.json', data: mapD1_05 },
  { source: 'd1-06.json', data: mapD1_06 },
  { source: 'd1-07.json', data: mapD1_07 },
  { source: 'd1-08.json', data: mapD1_08 },
  { source: 'd1-09.json', data: mapD1_09 },
  { source: 'd1-10.json', data: mapD1_10 },
  { source: 'd1-11.json', data: mapD1_11 },
  { source: 'd1-12.json', data: mapD1_12 },
];
