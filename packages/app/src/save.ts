/**
 * SaveStore (GDD section 6): versioned, migratable JSON, written atomically. Save files store
 * inputs only (seeds, picks, placements); replays re-run the sim.
 *
 * Backends: localStorage/IndexedDB (web), Capacitor Preferences + Filesystem (mobile), app data
 * dir (desktop), and optional anonymous cloud sync keyed by a local UUID (section 10).
 */

/** Current save schema version. Bump it and add a migration whenever `SaveData` changes. */
export const SAVE_VERSION = 1;

/** The persisted document. Phase 0 shape; owners extend it through migrations. */
export interface SaveData {
  readonly version: number;
  /** Locally generated random UUID; the only identifier we ever send (section 10). */
  readonly installId: string;
  readonly settings: Readonly<Record<string, string | number | boolean>>;
  /** Free-form per-feature slices (run in progress, codex, mayor XP, run history). */
  readonly slices: Readonly<Record<string, unknown>>;
}

/** Raw key/value backend. `write` must be atomic: a crash leaves the old or the new value. */
export interface SaveBackend {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Upgrades a document from version `n` to `n + 1`. Index `n - 1` migrates from `n`. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

export interface SaveStore {
  /** Loads, migrating older documents forward. Returns a fresh document if none or corrupt. */
  load(): Promise<SaveData>;
  /** Persists atomically. */
  save(data: SaveData): Promise<void>;
  /** Deletes local data (settings "delete my data"). */
  clear(): Promise<void>;
}

/** In-memory backend for tests and the headless runner. */
export class MemoryBackend implements SaveBackend {
  readonly data = new Map<string, string>();
  async read(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async write(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}

const KEY = 'rushwarden-save';
/** Where an unreadable, newer or unmigratable save is parked instead of being overwritten. */
export const BACKUP_KEY = 'rushwarden-save.backup';

/** Default `SaveStore` over any backend, with forward migrations. */
export class JsonSaveStore implements SaveStore {
  constructor(
    private readonly backend: SaveBackend,
    private readonly newInstallId: () => string,
    private readonly migrations: readonly Migration[] = [],
    private readonly version: number = SAVE_VERSION,
  ) {
    if (migrations.length !== version - 1) {
      throw new RangeError(
        `need ${version - 1} migrations for version ${version}, got ${migrations.length}`,
      );
    }
  }

  private fresh(): SaveData {
    return { version: this.version, installId: this.newInstallId(), settings: {}, slices: {} };
  }

  /**
   * A save we cannot use is never silently lost (GDD §11 P0 "lost save"): its raw text is
   * copied to BACKUP_KEY before a fresh document is returned.
   */
  private async rescue(raw: string): Promise<SaveData> {
    await this.backend.write(BACKUP_KEY, raw);
    return this.fresh();
  }

  async load(): Promise<SaveData> {
    const raw = await this.backend.read(KEY);
    if (raw === null) return this.fresh();
    let doc: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return this.rescue(raw);
      }
      doc = parsed as Record<string, unknown>;
    } catch {
      return this.rescue(raw);
    }
    let v = typeof doc['version'] === 'number' ? doc['version'] : 0;
    if (v < 1 || v > this.version) return this.rescue(raw);
    try {
      while (v < this.version) {
        const m = this.migrations[v - 1];
        if (!m) return this.rescue(raw);
        doc = { ...m(doc), version: v + 1 };
        v += 1;
      }
    } catch {
      return this.rescue(raw);
    }
    return doc as unknown as SaveData;
  }

  async save(data: SaveData): Promise<void> {
    await this.backend.write(KEY, JSON.stringify({ ...data, version: this.version }));
  }

  async clear(): Promise<void> {
    await this.backend.remove(KEY);
  }
}
