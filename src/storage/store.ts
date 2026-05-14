/* JSON-backed store. Wraps Plugin.loadData() / saveData(). All mutations go
 * through here so we have one place to invalidate caches and notify the UI.
 *
 * The DataFile lives in `<vault>/.obsidian/plugins/synod/data.json`. Settings
 * live in the same file under a `settings` key (Obsidian convention).
 */

import type { Plugin } from "obsidian";

import type { Entry } from "../ingestion/types";
import { DEFAULT_SETTINGS, SynodSettings } from "../settings";
import { EMPTY_DATA, DataFile, PipelineStatus, StoredDecisionPacket, StoredValueReport, Value } from "./types";

interface PersistShape {
  settings: SynodSettings;
  data: DataFile;
}

type StatusListener = (s: PipelineStatus) => void;
type DataListener = () => void;

export class Store {
  private plugin: Plugin;
  private cache: PersistShape;
  private statusListeners = new Set<StatusListener>();
  private dataListeners = new Set<DataListener>();

  private constructor(plugin: Plugin, cache: PersistShape) {
    this.plugin = plugin;
    this.cache = cache;
  }

  static async open(plugin: Plugin): Promise<Store> {
    const raw = ((await plugin.loadData()) ?? {}) as Partial<PersistShape>;
    const settings = mergeSettings(raw.settings);
    const cache: PersistShape = {
      settings,
      data: { ...EMPTY_DATA, ...(raw.data ?? {}) },
    };
    return new Store(plugin, cache);
  }

  // ── Settings ──
  get settings(): SynodSettings {
    return this.cache.settings;
  }

  async updateSettings(patch: Partial<SynodSettings>): Promise<void> {
    this.cache.settings = { ...this.cache.settings, ...patch };
    await this.persist();
  }

  // ── Entries ──
  get entries(): Entry[] {
    return Object.values(this.cache.data.entries);
  }

  async addEntries(entries: Entry[]): Promise<{ added: number; duplicates: number }> {
    let added = 0;
    let duplicates = 0;
    for (const e of entries) {
      if (this.cache.data.entries[e.id]) {
        duplicates++;
      } else {
        this.cache.data.entries[e.id] = e;
        added++;
      }
    }
    if (added) {
      await this.persist();
      this.notifyData();
    }
    return { added, duplicates };
  }

  entriesInRange(startIso: string, endIso: string): Entry[] {
    const s = startIso, e = endIso;
    return this.entries
      .filter((x) => x.written_at >= s && x.written_at <= e)
      .sort((a, b) => a.written_at.localeCompare(b.written_at));
  }

  recentEntries(limit: number): Entry[] {
    return this.entries
      .slice()
      .sort((a, b) => b.written_at.localeCompare(a.written_at))
      .slice(0, limit);
  }

  // ── Values ──
  get values(): Value[] {
    return Object.values(this.cache.data.values).sort((a, b) => a.name.localeCompare(b.name));
  }

  activeValues(): Value[] {
    return this.values.filter((v) => v.active);
  }

  async upsertValue(v: Value): Promise<void> {
    this.cache.data.values[v.id] = v;
    await this.persist();
    this.notifyData();
  }

  async setValueActive(id: string, active: boolean): Promise<void> {
    const v = this.cache.data.values[id];
    if (!v) return;
    v.active = active;
    await this.persist();
    this.notifyData();
  }

  async deleteValue(id: string): Promise<void> {
    delete this.cache.data.values[id];
    await this.persist();
    this.notifyData();
  }

  // ── Reports / packets ──
  async saveReport(r: StoredValueReport): Promise<void> {
    const idx = this.cache.data.reports.findIndex((x) => x.id === r.id);
    if (idx >= 0) this.cache.data.reports[idx] = r;
    else this.cache.data.reports.push(r);
    await this.persist();
  }

  async savePacket(p: StoredDecisionPacket): Promise<void> {
    this.cache.data.packets.push(p);
    await this.persist();
    this.notifyData();
  }

  get packets(): StoredDecisionPacket[] {
    return this.cache.data.packets;
  }

  latestPacket(): StoredDecisionPacket | null {
    return this.packets.length ? this.packets[this.packets.length - 1] : null;
  }

  // ── Scheduler bookkeeping ──
  lastRunFor(jobId: string): string | null {
    return this.cache.data.lastRun[jobId] ?? null;
  }

  async markRun(jobId: string): Promise<void> {
    this.cache.data.lastRun[jobId] = new Date().toISOString();
    await this.persist();
    this.notifyData();
  }

  // ── Status (in-memory + persisted snapshot for status view restore) ──
  get status(): PipelineStatus {
    return this.cache.data.status;
  }

  async setStatus(patch: Partial<PipelineStatus>): Promise<void> {
    this.cache.data.status = { ...this.cache.data.status, ...patch };
    for (const l of this.statusListeners) {
      try {
        l(this.cache.data.status);
      } catch {
        /* noop */
      }
    }
    await this.persist();
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Fires whenever entries, values, packets, or lastRun bookkeeping change.
   *  The status view uses this to refresh the counts panel without waiting
   *  for the next phase event. */
  onDataChange(fn: DataListener): () => void {
    this.dataListeners.add(fn);
    return () => this.dataListeners.delete(fn);
  }

  // ── Internals ──
  private async persist(): Promise<void> {
    await this.plugin.saveData(this.cache);
  }

  private notifyData(): void {
    for (const l of this.dataListeners) {
      try {
        l();
      } catch {
        /* noop */
      }
    }
  }
}

/** Merge persisted settings into the defaults, defending against:
 *   - missing nested objects (older versions, partial writes),
 *   - the legacy importers shape (`obsidianSourceFolder`/`journalDateFormat`).
 */
function mergeSettings(raw: Partial<SynodSettings> | undefined): SynodSettings {
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as SynodSettings;
  if (!raw) return out;

  // Provider + provider-specific creds — shallow merge per nested object.
  if (raw.provider) out.provider = raw.provider;
  if (raw.ollama) out.ollama = { ...out.ollama, ...raw.ollama };
  if (raw.openrouter) out.openrouter = { ...out.openrouter, ...raw.openrouter };
  if (raw.llamaSwap) out.llamaSwap = { ...out.llamaSwap, ...raw.llamaSwap };

  // Importers — handle both the new shape and the legacy flat fields.
  if (raw.importers) {
    const ri = raw.importers as Partial<SynodSettings["importers"]> & {
      obsidianSourceFolder?: string;
      journalDateFormat?: string;
    };
    if (ri.defaultKind) out.importers.defaultKind = ri.defaultKind;
    if (ri.configs) {
      if (ri.configs["obsidian-folder"]) {
        out.importers.configs["obsidian-folder"] = {
          ...out.importers.configs["obsidian-folder"],
          ...ri.configs["obsidian-folder"],
        };
      }
      if (ri.configs["obsidian-journal"]) {
        out.importers.configs["obsidian-journal"] = {
          ...out.importers.configs["obsidian-journal"],
          ...ri.configs["obsidian-journal"],
        };
      }
    }
    // Legacy migration: the old shape stored a single shared folder + format.
    if (ri.obsidianSourceFolder) {
      out.importers.configs["obsidian-folder"].folder = ri.obsidianSourceFolder;
      out.importers.configs["obsidian-journal"].folder = ri.obsidianSourceFolder;
    }
    if (ri.journalDateFormat) {
      out.importers.configs["obsidian-journal"].dateFormat = ri.journalDateFormat;
    }
  }

  if (raw.output) out.output = { ...out.output, ...raw.output };
  if (raw.prompts) out.prompts = { ...out.prompts, ...raw.prompts };
  if (raw.schedule) out.schedule = { ...out.schedule, ...raw.schedule };
  if (raw.budgets) out.budgets = { ...out.budgets, ...raw.budgets };
  if (raw.tensions) out.tensions = { ...out.tensions, ...raw.tensions };

  return out;
}
