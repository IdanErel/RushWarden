/**
 * The bundled card set: every file in `packages/content/cards/`, imported statically so both Vite
 * and Node bundle it. Adding a card means adding its JSON file and one line here; a test fails if
 * the two disagree.
 */
import type { CardFile } from './card.js';
import busLane from '../cards/bus-lane.json' with { type: 'json' };
import busPriority from '../cards/bus-priority.json' with { type: 'json' };
import deliveryWindow from '../cards/delivery-window.json' with { type: 'json' };
import detour from '../cards/detour.json' with { type: 'json' };
import expressStop from '../cards/express-stop.json' with { type: 'json' };
import fareHoliday from '../cards/fare-holiday.json' with { type: 'json' };
import noHeavy from '../cards/no-heavy.json' with { type: 'json' };
import oneWay from '../cards/one-way.json' with { type: 'json' };
import overtime from '../cards/overtime.json' with { type: 'json' };
import pilotProgram from '../cards/pilot-program.json' with { type: 'json' };
import recount from '../cards/recount.json' with { type: 'json' };
import removeSignal from '../cards/remove-signal.json' with { type: 'json' };
import roundabout from '../cards/roundabout.json' with { type: 'json' };
import secondShift from '../cards/second-shift.json' with { type: 'json' };
import smartSignal from '../cards/smart-signal.json' with { type: 'json' };
import speedLimitUp from '../cards/speed-limit-up.json' with { type: 'json' };
import staggeredHours from '../cards/staggered-hours.json' with { type: 'json' };
import tollBooth from '../cards/toll-booth.json' with { type: 'json' };
import turnLane from '../cards/turn-lane.json' with { type: 'json' };
import yieldCulture from '../cards/yield-culture.json' with { type: 'json' };

export const CARD_FILES: readonly CardFile[] = [
  { source: 'bus-lane.json', data: busLane },
  { source: 'bus-priority.json', data: busPriority },
  { source: 'delivery-window.json', data: deliveryWindow },
  { source: 'detour.json', data: detour },
  { source: 'express-stop.json', data: expressStop },
  { source: 'fare-holiday.json', data: fareHoliday },
  { source: 'no-heavy.json', data: noHeavy },
  { source: 'one-way.json', data: oneWay },
  { source: 'overtime.json', data: overtime },
  { source: 'pilot-program.json', data: pilotProgram },
  { source: 'recount.json', data: recount },
  { source: 'remove-signal.json', data: removeSignal },
  { source: 'roundabout.json', data: roundabout },
  { source: 'second-shift.json', data: secondShift },
  { source: 'smart-signal.json', data: smartSignal },
  { source: 'speed-limit-up.json', data: speedLimitUp },
  { source: 'staggered-hours.json', data: staggeredHours },
  { source: 'toll-booth.json', data: tollBooth },
  { source: 'turn-lane.json', data: turnLane },
  { source: 'yield-culture.json', data: yieldCulture },
];
