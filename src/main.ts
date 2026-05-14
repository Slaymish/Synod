/* SynodPlugin entry point.
 *
 * Lifecycle:
 *   onload:  open store, ensure default prompts exist, register status view,
 *            register settings tab, register commands, schedule bulletin job.
 *   onunload: clear scheduler interval.
 */

import { Notice, Plugin, WorkspaceLeaf } from "obsidian";

import { PromptStore } from "./prompts";
import { Store } from "./storage/store";
import { SynodSettingsTab } from "./ui/settings-tab";
import { SYNOD_VIEW_TYPE, SynodStatusView } from "./ui/status-view";
import { ImportModal } from "./ui/import-modal";
import { CandidateValueModal } from "./ui/candidate-modal";
import { discoverValues, runFullCycle } from "./pipeline";
import { log } from "./util/log";

export default class SynodPlugin extends Plugin {
  store!: Store;
  prompts!: PromptStore;
  private scheduleHandle: number | null = null;

  async onload(): Promise<void> {
    this.store = await Store.open(this);
    this.prompts = new PromptStore(this.app, this.store.settings.prompts.folder);
    await this.prompts.ensureDefaults();

    // ── Status view ──
    this.registerView(SYNOD_VIEW_TYPE, (leaf) => new SynodStatusView(leaf, this.store, this.prompts));
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
      callback: async () => {
        try {
          const days = Math.max(1, Math.round(this.store.settings.schedule.bulletinIntervalHours / 24));
          const { bulletinPath } = await runFullCycle(this.app, this.store, this.prompts, days);
          new Notice(`Bulletin written to ${bulletinPath}`);
        } catch (e) {
          new Notice(`Bulletin run failed: ${(e as Error).message}`);
        }
      },
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

  private async maybeRunIfDue(): Promise<void> {
    const s = this.store.settings;
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
      const { bulletinPath } = await runFullCycle(this.app, this.store, this.prompts, days);
      new Notice(`Synod bulletin: ${bulletinPath}`);
    } catch (e) {
      log.error(`Scheduled bulletin failed: ${(e as Error).message}`);
    }
  }
}
