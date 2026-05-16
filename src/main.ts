/* SynodPlugin entry point.
 *
 * Lifecycle:
 *   onload:  open store, ensure default prompts exist, register status view,
 *            register settings tab, register commands, schedule bulletin job.
 *   onunload: clear scheduler interval, abort any active run.
 *
 * The plugin is the single owner of an in-flight bulletin run. Manual,
 * command-palette, and scheduled runs all go through `startBulletinRun()`
 * so a second trigger never overlaps the first and cancellation always has
 * exactly one AbortController to abort.
 */

import { Notice, Plugin, WorkspaceLeaf, normalizePath } from "obsidian";

import { PromptStore } from "./prompts";
import { Store } from "./storage/store";
import { SynodSettingsTab } from "./ui/settings-tab";
import { SYNOD_VIEW_TYPE, SynodStatusView } from "./ui/status-view";
import { ImportModal } from "./ui/import-modal";
import { CandidateValueModal } from "./ui/candidate-modal";
import { discoverValues, RunResult, runFullCycle } from "./pipeline";
import { isCancelError } from "./util/cancel";
import { log } from "./util/log";

interface ActiveRun {
  abort: AbortController;
  promise: Promise<RunResult>;
}

export default class SynodPlugin extends Plugin {
  store!: Store;
  prompts!: PromptStore;
  private scheduleHandle: number | null = null;
  private currentRun: ActiveRun | null = null;
  private runListeners = new Set<() => void>();

  async onload(): Promise<void> {
    this.store = await Store.open(this);
    this.prompts = new PromptStore(this.app, this.store.settings.prompts.folder);
    await this.prompts.ensureDefaults();

    // ── Status view ──
    this.registerView(SYNOD_VIEW_TYPE, (leaf) => new SynodStatusView(leaf, this));
    this.addRibbonIcon("users", "Open Synod", () => this.activateStatusView());

    // ── Settings ──
    this.addSettingTab(new SynodSettingsTab(this.app, this));

    // ── Commands ──
    // Obsidian prefixes command IDs with the plugin ID automatically; do not
    // include "synod-" here.
    this.addCommand({
      id: "open-status-view",
      name: "Open status view",
      callback: () => this.activateStatusView(),
    });
    this.addCommand({
      id: "import-entries",
      name: "Import journal entries",
      callback: () => new ImportModal(this.app, this.store).open(),
    });
    this.addCommand({
      id: "discover-values",
      name: "Discover candidate values",
      callback: async () => {
        try {
          const candidates = await discoverValues(this.store, this.prompts);
          if (!candidates.length) new Notice("No candidate values discovered.");
          else new CandidateValueModal(this.app, this.store, candidates).open();
        } catch (e) {
          new Notice(`Value discovery failed: ${(e as Error).message}`);
        }
      },
    });
    this.addCommand({
      id: "run-bulletin-cycle",
      name: "Run bulletin cycle now",
      callback: () => void this.startBulletinRun(),
    });
    this.addCommand({
      id: "cancel-bulletin-cycle",
      name: "Cancel running bulletin cycle",
      checkCallback: (checking) => {
        if (!this.currentRun) return false;
        if (!checking) this.cancelBulletinRun();
        return true;
      },
    });
    this.addCommand({
      id: "open-bulletin",
      name: "Open most recent bulletin",
      callback: () => void this.openLatestBulletinFile(),
    });

    // ── Schedule ──
    this.rescheduleBulletin();
    if (this.store.settings.schedule.runOnStartup) {
      // Defer so the workspace is ready and the status view can render the run.
      window.setTimeout(() => {
        void this.maybeRunIfDue();
      }, 5_000);
    }

    log.info("Synod plugin loaded");
  }

  onunload(): void {
    if (this.scheduleHandle !== null) window.clearInterval(this.scheduleHandle);
    // Best-effort: tell any in-flight run to stop on the next checkpoint.
    this.currentRun?.abort.abort();
  }

  /** Open or focus the status view in the right sidebar. */
  async activateStatusView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(SYNOD_VIEW_TYPE);
    let leaf: WorkspaceLeaf | null;
    if (leaves.length) {
      leaf = leaves[0];
    } else {
      leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: SYNOD_VIEW_TYPE, active: true });
    }
    if (leaf) await this.app.workspace.revealLeaf(leaf);
  }

  /** Re-arm the periodic bulletin job. Safe to call from settings-tab edits. */
  rescheduleBulletin(): void {
    if (this.scheduleHandle !== null) {
      window.clearInterval(this.scheduleHandle);
      this.scheduleHandle = null;
    }
    const hours = this.store.settings.schedule.bulletinIntervalHours;
    if (!hours || hours <= 0) return;
    // Check every 30 minutes; the job runs only if `hours` have elapsed
    // since the last successful bulletin.
    const interval = 30 * 60 * 1000;
    this.scheduleHandle = window.setInterval(() => {
      void this.maybeRunIfDue();
    }, interval);
    this.registerInterval(this.scheduleHandle);
  }

  /** Centralised single-flight runner. UI, command palette, and scheduler
   *  all funnel through here so runs cannot overlap and cancellation has
   *  one well-defined target. */
  startBulletinRun(): Promise<RunResult> | null {
    if (this.currentRun) {
      new Notice("A bulletin run is already in progress.");
      return null;
    }
    if (!this.store.activeValues().length) {
      new Notice("Confirm at least one value first.");
      return null;
    }
    const abort = new AbortController();
    const days = Math.max(
      1,
      Math.round(this.store.settings.schedule.bulletinIntervalHours / 24),
    );
    const promise = runFullCycle(this.app, this.store, this.prompts, days, { signal: abort.signal })
      .then(
        (res) => {
          new Notice(`Bulletin written to ${res.bulletinPath}`);
          return res;
        },
        (e) => {
          if (isCancelError(e)) {
            new Notice("Bulletin run cancelled.");
          } else {
            new Notice(`Bulletin run failed: ${(e as Error).message}`);
          }
          throw e;
        },
      )
      .finally(() => {
        this.currentRun = null;
        this.notifyRunStateChange();
      });
    this.currentRun = { abort, promise };
    this.notifyRunStateChange();
    return promise;
  }

  /** Ask the active run to stop at the next cancellation checkpoint. The
   *  in-flight LLM call cannot be aborted (Obsidian's requestUrl ignores
   *  AbortSignal), so the run continues until that returns. */
  cancelBulletinRun(): void {
    if (!this.currentRun) return;
    this.currentRun.abort.abort();
    new Notice("Cancelling after current model call…");
  }

  isRunning(): boolean {
    return this.currentRun !== null;
  }

  /** Subscribe to "run started / run finished" transitions so the status
   *  view can show or hide the Cancel button without polling. */
  onRunStateChange(fn: () => void): () => void {
    this.runListeners.add(fn);
    return () => this.runListeners.delete(fn);
  }

  private notifyRunStateChange(): void {
    for (const l of this.runListeners) {
      try {
        l();
      } catch {
        /* noop */
      }
    }
  }

  private async openLatestBulletinFile(): Promise<void> {
    const folder = normalizePath(`${this.store.settings.output.rootFolder}/Bulletins`);
    const files = this.app.vault
      .getFiles()
      .filter((f) => f.path.startsWith(`${folder}/`) && f.extension === "md")
      .sort((a, b) => b.name.localeCompare(a.name));
    if (!files.length) {
      new Notice("No bulletins found. Run a cycle first.");
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(files[0]);
  }

  private async maybeRunIfDue(): Promise<void> {
    const s = this.store.settings;
    if (this.currentRun) return;
    const last = this.store.lastRunFor("bulletin");
    if (last) {
      const elapsedHours = (Date.now() - new Date(last).getTime()) / 3_600_000;
      if (elapsedHours < s.schedule.bulletinIntervalHours) return;
    }
    if (!this.store.activeValues().length) {
      log.info("Skipping scheduled bulletin: no active values yet.");
      return;
    }
    const days = Math.max(1, Math.round(s.schedule.bulletinIntervalHours / 24));
    const entries = this.store.entriesInRange(
      new Date(Date.now() - days * 86_400_000).toISOString(),
      new Date().toISOString(),
    );
    if (entries.length < s.schedule.minEntries) {
      log.info(`Skipping scheduled bulletin: only ${entries.length} entries in window.`);
      return;
    }
    try {
      await this.startBulletinRun();
    } catch (e) {
      // Notices were already surfaced by startBulletinRun; just log.
      log.error(`Scheduled bulletin failed: ${(e as Error).message}`);
    }
  }
}
