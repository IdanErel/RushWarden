/**
 * The bundled card set: every file in `packages/content/cards/`, imported statically so both Vite
 * and Node bundle it. Adding a card means adding its JSON file and one line here; a test fails if
 * the two disagree.
 */
import type { CardFile } from './card.js';
import busPriority from '../cards/bus-priority.json' with { type: 'json' };
import expressStop from '../cards/express-stop.json' with { type: 'json' };
import fareHoliday from '../cards/fare-holiday.json' with { type: 'json' };
import roundabout from '../cards/roundabout.json' with { type: 'json' };
import speedLimitUp from '../cards/speed-limit-up.json' with { type: 'json' };
import yieldCulture from '../cards/yield-culture.json' with { type: 'json' };

export const CARD_FILES: readonly CardFile[] = [
  { source: 'bus-priority.json', data: busPriority },
  { source: 'express-stop.json', data: expressStop },
  { source: 'fare-holiday.json', data: fareHoliday },
  { source: 'roundabout.json', data: roundabout },
  { source: 'speed-limit-up.json', data: speedLimitUp },
  { source: 'yield-culture.json', data: yieldCulture },
];
