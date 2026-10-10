/**
 * Card rules text, generated from effect data (GDD section 4: "Card text is generated from the
 * effect data by a template, never hand-written, so the text can never lie about the effect").
 * English only for now; section 8 moves these templates into per-language i18n files.
 *
 * Every primitive has a template (the `Templates` type makes a missing one a compile error).
 * A template states only what its effect's fields say.
 */
import {
  type ControllerKind,
  DEFAULT_SWITCH_TICKS,
  type Effect,
  type EffectKind,
  type RoadClass,
  type Side,
  TICKS_PER_SECOND,
  type VehicleType,
} from '@rushwarden/sim';
import { VEHICLE_NAMES } from './card-schema.js';
import { type CardDef, resolveCard, type TargetKind, type Tier } from './card.js';

const PLURALS: Record<(typeof VEHICLE_NAMES)[number], string> = {
  car: 'cars',
  taxi: 'taxis',
  bus: 'buses',
  truck: 'trucks',
  emergency: 'emergency vehicles',
  bike: 'bikes',
};

const WHERE: Record<TargetKind, string> = {
  intersection: 'this intersection',
  segment: 'this segment',
  edge: 'this edge',
  district: 'the district',
};

const CONTROLLER_NAMES: Record<ControllerKind, string> = {
  uncontrolled: 'an uncontrolled junction',
  signal: 'a signal',
  roundabout: 'a roundabout',
  'stop-all': 'an all-way stop',
  priority: 'a priority junction',
};

const ROAD_CLASS_NAMES: Record<RoadClass, string> = {
  local: 'local (1-lane)',
  arterial: 'arterial (multi-lane)',
};

/** Ticks as seconds when whole ("5 seconds"), else ticks. */
function duration(ticks: number): string {
  return ticks % TICKS_PER_SECOND === 0
    ? plural1((ticks - (ticks % TICKS_PER_SECOND)) / TICKS_PER_SECOND, 'second')
    : plural1(ticks, 'tick');
}

const SIDE_NAMES: Record<Side, string> = { n: 'north', e: 'east', s: 'south', w: 'west' };

const singular = (t: VehicleType): string => VEHICLE_NAMES[t];
const plural = (t: VehicleType): string => PLURALS[VEHICLE_NAMES[t]];

/** "+1", "−2" (true minus sign, as in the GDD card list). */
export function signed(n: number): string {
  return n < 0 ? `−${-n}` : `+${n}`;
}

/** Per-mille as a percent string without floats: 100 → "10", 25 → "2.5". */
function permilleToPercent(p: number): string {
  const abs = p < 0 ? -p : p;
  const whole = (abs - (abs % 10)) / 10;
  const tenth = abs % 10;
  return tenth === 0 ? `${whole}` : `${whole}.${tenth}`;
}

function list(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** "all vehicles", "buses and bikes", or "all vehicles except trucks" when that is shorter. */
function whichVehicles(types: readonly VehicleType[] | undefined): string {
  if (types === undefined || types.length === VEHICLE_NAMES.length) return 'all vehicles';
  const excluded = VEHICLE_NAMES.map((_, i) => i as VehicleType).filter((t) => !types.includes(t));
  if (excluded.length < types.length) return `all vehicles except ${list(excluded.map(plural))}`;
  return list(types.map(plural));
}

function plural1(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type Template<K extends EffectKind> = (
  e: Extract<Effect, { kind: K }>,
  target: TargetKind,
) => string;
type Templates = { readonly [K in EffectKind]: Template<K> };

const TEMPLATES: Templates = {
  setController: (e, target) => {
    const subject = target === 'district' ? 'Every intersection becomes' : 'Becomes';
    let s = `${subject} ${CONTROLLER_NAMES[e.controller]}`;
    if (e.direction !== undefined) s += ` with right of way from the ${SIDE_NAMES[e.direction]}`;
    if (e.capacity !== undefined) s += ` holding up to ${plural1(e.capacity, 'vehicle')}`;
    return `${s}.`;
  },
  setSignalPhase: (e, target) => {
    const s =
      e.mode === 'adaptive'
        ? 'Signal is adaptive: the longest queue gets green.'
        : e.mode === 'wave'
          ? `Signals along ${WHERE[target]} share a green wave timed to the speed limit.`
          : 'All signals share one district-wide cycle.';
    if (e.switchTicks !== undefined)
      return `${s} Phases switch in ${plural1(e.switchTicks, 'tick')}.`;
    if (e.switchTicksDelta !== undefined) {
      const d = e.switchTicksDelta;
      const total = DEFAULT_SWITCH_TICKS + d;
      const how = d < 0 ? `${plural1(-d, 'tick')} faster` : `${plural1(d, 'tick')} slower`;
      return `${s} Phases switch ${how} (${plural1(total, 'tick')}).`;
    }
    return s;
  },
  setLaneCount: (e, target) =>
    `${plural1(e.lanes, 'lane')} each way on ${e.scope === 'ring' ? 'the ring road' : WHERE[target]}.`,
  setSpeedLimit: (e, target) => {
    const speed =
      e.delta === 0
        ? `Top speed at most ${e.max ?? 0}`
        : e.max === undefined
          ? `${signed(e.delta)} top speed`
          : `${signed(e.delta)} top speed, up to ${e.max},`;
    const where =
      e.cells === undefined
        ? WHERE[target]
        : `the first ${plural1(e.cells, 'cell')} of ${WHERE[target]}`;
    return `${speed} on ${where} for ${whichVehicles(e.types)}.`;
  },
  banType: (e, target) => {
    const who = capitalize(plural(e.vehicleType));
    if (e.scope === undefined || e.scope === 'target') {
      return `${who} are banned from ${WHERE[target]} and route around it.`;
    }
    return `${who} are banned from every ${ROAD_CLASS_NAMES[e.scope.roadClass]} road in the district and route around them.`;
  },
  preferType: (e, target) => {
    const who = list([e.vehicleType, ...(e.alsoTypes ?? [])].map(plural));
    const where = target === 'district' ? 'every intersection' : WHERE[target];
    return `${capitalize(who)} get green on approach to ${where}.`;
  },
  // ADR-014: only valid where the segment already has a bus stop; it changes that stop's dwell.
  addBusStop: (e, target) =>
    `Buses dwell ${plural1(e.dwellTicks, 'tick')} at the bus stop on ${WHERE[target]}.`,
  addBikeLane: (e, target) => {
    const cars = e.carVmaxDelta === 0 ? '' : `; cars ${signed(e.carVmaxDelta)} top speed`;
    return `Adds a bike lane on ${WHERE[target]}: bikes top speed ${e.bikeVmax}${cars}.`;
  },
  setOneWay: (e, target) => {
    const lanes = e.doubleLanes ? ', with its lanes doubled that way' : '';
    const heading =
      e.direction === undefined
        ? 'in the direction you place it'
        : `heading ${SIDE_NAMES[e.direction]}`;
    return `${capitalize(WHERE[target])} becomes one-way ${heading}${lanes}.`;
  },
  addTurnLane: (e) =>
    e.turns === 'left'
      ? 'Left turns get their own lane and stop blocking through traffic.'
      : 'Left and right turns get their own lanes and stop blocking through traffic.',
  reserveLane: (e, target) =>
    `One lane of ${WHERE[target]} is reserved for ${list(e.vehicleTypes.map(plural))}.`,
  reroute: (e, target) => {
    const who = e.vehicleTypes === undefined ? 'spawns' : list(e.vehicleTypes.map(plural));
    const to = e.to === 'adjacent' ? 'the next edge clockwise' : 'an edge you choose';
    return `${e.percent}% of ${who} from ${WHERE[target]} move to ${to}.`;
  },
  spawnModifier: (e, target) => {
    const at = target === 'district' ? '' : ` at ${WHERE[target]}`;
    return `${signed(e.percent)}% ${singular(e.vehicleType)} spawns${at}.`;
  },
  smoothDemand: (e) =>
    `Rush hour spreads out: peak demand ${permilleToPercent(e.peakPermille)}% lower, spread over the round.`,
  spawnWindow: (e, target) => {
    const at = target === 'district' ? '' : ` at ${WHERE[target]}`;
    const when =
      e.fromTick === 0
        ? `in the first ${duration(e.toTick)}`
        : `between ${duration(e.fromTick)} and ${duration(e.toTick)} in`;
    return `${capitalize(plural(e.vehicleType))} spawn${at} only ${when}.`;
  },
  scoreModifier: (e, target) => {
    const who = e.vehicleType === undefined ? 'Vehicles' : capitalize(plural(e.vehicleType));
    switch (e.condition) {
      case 'above-quota':
        return `Each vehicle exited above quota scores ${signed(e.delta)}.`;
      case 'same-tick-window':
        return `${who} exiting in the same tick window score ${signed(e.delta)}.`;
      case 'on-arrival':
        return `${who} score ${signed(e.delta)} on arrival at ${WHERE[target]}.`;
      default:
        return `${who} score ${signed(e.delta)}.`;
    }
  },
  setPSlow: (e, target) =>
    `${e.deltaPermille < 0 ? '−' : '+'}${permilleToPercent(e.deltaPermille)}% chance to slow down for everyone on ${WHERE[target]}.`,
  yieldRule: (e, target) =>
    target === 'district'
      ? `Uncontrolled intersections resolve ${plural1(e.fasterTicks, 'tick')} faster.`
      : `This intersection resolves ${plural1(e.fasterTicks, 'tick')} faster while uncontrolled.`,
  drawModifier: (e) =>
    e.delta > 0
      ? `Draw ${plural1(e.delta, 'extra card')} next round.`
      : `Draw ${plural1(-e.delta, 'fewer card')} next round.`,
  energyModifier: (e) => {
    const when =
      e.perRound === true
        ? e.when === 'now'
          ? ' every round, starting this round'
          : ' every round, starting next round'
        : e.when === 'now'
          ? ' this round'
          : ' next round';
    const cond = e.condition === 'replaced-signal' ? ' if it replaced a signal' : '';
    return `${signed(e.delta)} energy${when}${cond}.`;
  },
  costModifier: (e) => {
    const which = e.cards === 'all' ? 'All cards' : list([...e.cards]);
    return `${which} cost ${signed(e.delta)} energy.`;
  },
  redraw: (e) =>
    e.keep === 0 ? 'Redraw your hand.' : 'Keep 1 card, then redraw the rest of your hand.',
  fundsModifier: (e, target) =>
    e.per === undefined
      ? `${signed(e.delta)} funds.`
      : `${signed(e.delta)} funds per ${plural1(e.per, 'vehicle')} through ${WHERE[target]}.`,
};

/** The sentence for one effect on a target kind. */
export function effectText(effect: Effect, target: TargetKind): string {
  const template = TEMPLATES[effect.kind] as Template<EffectKind>;
  return template(effect as never, target);
}

/** The full rules text of a card at a tier: one sentence per effect, in order. */
export function cardText(card: CardDef, tier: Tier = 1): string {
  const resolved = resolveCard(card, tier);
  return resolved.effects.map((e) => effectText(e, resolved.target)).join(' ');
}
