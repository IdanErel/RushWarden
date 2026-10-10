/**
 * @rushwarden/ui — Preact screens, i18n, share line and test hooks (GDD §8). Owner: UI Engineer.
 *
 * ```ts
 * import { toyRunConfig } from '@rushwarden/app';
 * import { spawnSimWorker } from '@rushwarden/render';
 * import { ControllerRun, mountGame } from '@rushwarden/ui';
 * const run = new ControllerRun({ config: toyRunConfig({ seed, cards }), env, catalog, analytics });
 * mountGame(document.getElementById('app')!, { run, spawnWorker: spawnSimWorker });
 * ```
 */
import './styles.css';

export { Game, mountGame, type GameEvents, type GameOptions } from './game.js';
export * from './run/port.js';
export {
  ControllerRun,
  DISTRICT_NAME,
  candidateTargets,
  markOf,
  segmentAt,
  toSimTarget,
  type CardCatalog,
  type CardInfo,
  type ControllerRunOptions,
} from './run/controller-run.js';
export {
  DEFAULT_CONFIG,
  type InstallIdProvider,
  type SoundControl,
  type UiConfig,
} from './config.js';
export { shareLine, shareText, copyText, MARK_GLYPH } from './share.js';
export { keyAction, type KeyAction } from './keys.js';
export { stateAttributes, type UiFlags } from './hooks.js';
export { ExitCounter } from './live.js';
export { t, format, setLanguage, type StringKey } from './i18n.js';
export { TAG_COLOR } from './tags.js';
