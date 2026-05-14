/* Status view — the answer to "status and current progress".
 *
 * Shows live pipeline phase, progress bar, last-run timestamp, recent log
 * lines, plus the four primary actions: Import, Discover values, Run cycle,
 * Open latest bulletin.
 */

import { App, ItemView, Notice, TFile, WorkspaceLeaf, normalizePath } from "obsidian";

import type { Store } from "../storage/store";
import type { PromptStore } from "../prompts";
import { discoverValues, runFullCycle } from "../pipeline";
import { LogEntry, subscribe } from "../util/log";
import { CandidateValueModal } from "./candidate-modal";
import { ImportModal } from "./import-modal";

export const SYNOD_VIEW_TYPE = "synod-status-view";

export class SynodStatusView extends ItemView {
  private store: Store;
  private prompts: PromptStore;
  private unsubStatus: (() => void) | null = null;
  private unsubLog: (() => void) | null = null;
  private logBuffer: LogEntry[] = [];

  constructor(leaf: WorkspaceLeaf, store: Store, prompts: PromptStore) {
    super(leaf);
    this.store = store;
    this.prompts = prompts;
  }

  getViewType(): string {
    return SYNOD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Synod";
  }

  getIcon(): string {
    return "users";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.unsubStatus = this.store.onStatus(() => this.render());
    this.unsubLog = subscribe((entry) => {
      this.logBuffer.push(entry);
      if (this.logBuffer.length > 50) this.logBuffer.shift();
      this.renderLog();
    });
  }

  async onClose(): Promise<void> {
    this.unsubStatus?.();
    this.unsubLog?.();
  }

  private render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("synod-view");

    root.createDiv({ cls: "synod-title", text: "Synod" });

    // ── Status block ──
    const status = this.store.status;
    const statusBox = root.createDiv({ cls: "synod-status-box" });
    statusBox.createDiv({
      text: `Phase: ${status.phase}`,
      cls: `synod-phase synod-phase-${status.phase}`,
    });
    statusBox.createDiv({ text: status.detail, cls: "synod-detail" });
    if (status.progress) {
      const { current, total } = status.progress;
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      const bar = statusBox.createDiv({ cls: "synod-progress" });
      const fill = bar.createDiv({ cls: "synod-progress-fill" });
      // Dynamic value — set via CSS custom property the stylesheet reads.
      fill.style.setProperty("--synod-progress", `${pct}%`);
      statusBox.createDiv({ text: `${current} / ${total}`, cls: "synod-progress-text" });
    }
    if (status.startedAt) {
      statusBox.createEl("small", { text: `Started: ${new Date(status.startedAt).toLocaleString()}` });
    }
    if (status.finishedAt) {
      statusBox.createEl("small", {
        text: `Finished: ${new Date(status.finishedAt).toLocaleString()}`,
      });
    }
    if (status.error) {
      statusBox.createEl("div", { text: `Error: ${status.error}`, cls: "synod-error" });
    }

    // ── Counts block ──
    const counts = root.createDiv({ cls: "synod-counts" });
    counts.createEl("div", { text: `Entries: ${this.store.entries.length}` });
    counts.createEl("div", { text: `Active values: ${this.store.activeValues().length}` });
    const last = this.store.lastRunFor("bulletin");
    counts.createEl("div", {
      text: `Last bulletin: ${last ? new Date(last).toLocaleString() : "never"}`,
    });

    // ── Actions ──
    const actions = root.createDiv({ cls: "synod-actions" });

    const importBtn = actions.createEl("button", { text: "Import entries" });
    importBtn.onclick = () => new ImportModal(this.app, this.store).open();

    const discoverBtn = actions.createEl("button", { text: "Discover values" });
    discoverBtn.onclick = async () => {
      try {
        const candidates = await discoverValues(this.store, this.prompts);
        if (!candidates.length) {
          new Notice("No candidate values discovered. Add more entries and try again.");
          return;
        }
        new CandidateValueModal(this.app, this.store, candidates).open();
      } catch (e) {
        new Notice(`Value discovery failed: ${(e as Error).message}`);
      }
    };

    const runBtn = actions.createEl("button", { text: "Run bulletin cycle" });
    runBtn.onclick = async () => {
      if (!this.store.activeValues().length) {
        new Notice("No active values. Discover and confirm at least one value first.");
        return;
      }
      try {
        const days = Math.max(1, Math.round(this.store.settings.schedule.bulletinIntervalHours / 24));
        const { bulletinPath } = await runFullCycle(this.app, this.store, this.prompts, days);
        new Notice(`Bulletin written to ${bulletinPath}`);
      } catch (e) {
        new Notice(`Bulletin run failed: ${(e as Error).message}`);
      }
    };

    const openBtn = actions.createEl("button", { text: "Open latest bulletin" });
    openBtn.onclick = async () => {
      const latest = this.store.latestPacket();
      if (!latest) {
        new Notice("No bulletins yet.");
        return;
      }
      const path = normalizePath(
        `${this.store.settings.output.rootFolder}/Bulletins/${latest.period_end.slice(0, 10)}.md`,
      );
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
      else new Notice(`File not found: ${path}`);
    };

    // ── Log block ──
    root.createDiv({ cls: "synod-section-label", text: "Recent log" });
    root.createDiv({ cls: "synod-log", attr: { id: "synod-log" } });
    this.renderLog();
  }

  private renderLog(): void {
    const box = this.containerEl.querySelector("#synod-log");
    if (!box) return;
    box.empty();
    for (const entry of this.logBuffer.slice(-20)) {
      const line = box.createDiv({ cls: `synod-log-line synod-log-${entry.level}` });
      line.createSpan({ text: entry.ts.slice(11, 19) + " ", cls: "synod-log-ts" });
      line.createSpan({ text: entry.msg });
    }
  }
}
