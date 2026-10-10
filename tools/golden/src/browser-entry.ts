import { runGolden } from './rounds.js';

// Exposed for Playwright: the browser test calls this and compares with fixtures/hashes.json.
(globalThis as unknown as { runGolden: typeof runGolden }).runGolden = runGolden;
