/* Status view — the answer to "what is Synod doing right now?".
 *
 * Shows live pipeline phase, progress bar, last-run timestamp, recent log
 * lines, the four primary actions (Import, Discover values, Run cycle,
 * Open latest bulletin), plus a Cancel button while a cycle is in flight
 * and a list of recent bulletins. The counts panel auto-refreshes whenever
 * the store's underlying data changes (no need to poke another button).
 */

import { ItemView, Notice, TFile, WorkspaceLeaf, normalizePath } from "obsidian";

import type SynodPlugin from "../main";
import type { Store } from "../storage/store";
import type { PromptStore } from "../prompts";
import { discoverValues } from "../pipeline";
import { LogEntry, subscribe } from "../util/log";
import { CandidateValueModal } from "./candidate-modal";
import { ImportModal } from "./import-modal";

export const SYNOD_VIEW_TYPE = "synod-status-view";

const RECENT_BULLETINS_MAX = 5;

export class SynodStatusView extends ItemView {
  private plugin: SynodPlugin;
  private store: Store;
  private prompts: PromptStore;
  private unsubStatus: (() => void) | null = null;
  private unsubData: (() => void) | null = null;
  private unsubLog: (() => void) | null = null;
  private unsubRun: (() => void) | null = null;
  private logBuffer: LogEntry[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: SynodPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.store = plugin.store;
    this.prompts = plugin.prompts;
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
    // Re-render when entries / values / packets / last-run change so the
    // counts panel updates immediately after an import or value confirm,
    // not just after the next button press.
    this.unsubData = this.store.onDataChange(() => this.render());
    this.unsubRun = this.plugin.onRunStateChange(() => this.render());
    this.unsubLog = subscribe((entry) => {
      this.logBuffer.push(entry);
      if (this.logBuffer.length > 50) this.logBuffer.shift();
      this.renderLog();
    });
  }

  async onClose(): Promise<void> {
    this.unsubStatus?.();
    this.unsubData?.();
    this.unsubLog?.();
    this.unsubRun?.();
  }

  private render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("synod-view");

    root.createDiv({ cls: "synod-title", text: "Synod" });

    const entryCount = this.store.entries.length;
    const valueCount = this.store.activeValues().length;
    const lastBulletin = this.store.lastRunFor("bulletin");

    // ── First-run guidance ──
    // Show a short, friendly checklist if the user has not yet completed
    // the three-step setup. Disappears once a bulletin has been written.
    if (!lastBulletin) {
      const guide = root.createDiv({ cls: "synod-guide" });
      guide.createDiv({
        cls: "synod-guide-title",
        text: "Get started in three steps",
      });
      const steps = guide.createEl("ol", { cls: "synod-guide-steps" });
      const step1 = steps.createEl("li");
      step1.setText(
        entryCount > 0
          ? `Imported ${entryCount} journal ${entryCount === 1 ? "entry" : "entries"}.`
          : "Import your journal — Rosebud export, an Obsidian folder, or daily notes.",
      );
      if (entryCount > 0) step1.addClass("is-done");

      const step2 = steps.createEl("li");
      step2.setText(
        valueCount > 0
          ? `Confirmed ${valueCount} active value${valueCount === 1 ? "" : "s"}.`
          : "Discover the values that already show up in what you write, then keep the ones that ring true.",
      );
      if (valueCount > 0) step2.addClass("is-done");

      const step3 = steps.createEl("li");
      step3.setText(
        "Run a bulletin. Each value gets its own agent, a compiler surfaces the tensions between them, and the result lands in your vault.",
      );

      guide.createEl("small", {
        cls: "synod-guide-hint",
        text:
          "Synod talks to LLMs through Ollama, OpenRouter, or any OpenAI-compatible endpoint — pick yours under Settings → Community plugins → Synod.",
      });
    }

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
    if (this.plugin.isRunning()) {
      const cancelBtn = statusBox.createEl("button", {
        text: "Cancel run",
        cls: "synod-cancel-button",
      });
      cancelBtn.setAttr(
        "title",
        "Stop the run at the next checkpoint. The current model call cannot be aborted mid-flight.",
      );
      cancelBtn.onclick = () => this.plugin.cancelBulletinRun();
    }

    // ── Counts block ──
    const counts = root.createDiv({ cls: "synod-counts" });
    counts.createEl("div", { text: `Entries: ${entryCount}` });
    counts.createEl("div", { text: `Active values: ${valueCount}` });
    counts.createEl("div", {
      text: `Last bulletin: ${lastBulletin ? new Date(lastBulletin).toLocaleString() : "never"}`,
    });

    // ── Actions ──
    const actions = root.createDiv({ cls: "synod-actions" });

    const importBtn = actions.createEl("button", { text: "1. Import journal entries" });
    importBtn.setAttr("title", "Bring your journal into Synod from Rosebud, an Obsidian folder, or daily notes.");
    importBtn.onclick = () => new ImportModal(this.app, this.store).open();

    const discoverBtn = actions.createEl("button", { text: "2. Discover values" });
    discoverBtn.setAttr(
      "title",
      "Read your entries, propose the values that already show up in your writing, and let you keep the ones that ring true.",
    );
    discoverBtn.onclick = async () => {
      if (!this.store.entries.length) {
        new Notice("Import some journal entries first.");
        return;
      }
      try {
        const candidates = await discoverValues(this.store, this.prompts);
        if (!candidates.length) {
          new Notice("No candidate values discovered. Import more entries and try again.");
          return;
        }
        new CandidateValueModal(this.app, this.store, candidates).open();
      } catch (e) {
        new Notice(`Value discovery failed: ${(e as Error).message}`);
      }
    };

    const runBtn = actions.createEl("button", { text: "3. Run bulletin cycle" });
    runBtn.setAttr(
      "title",
      "Each active value gets its own agent. The compiler surfaces tensions between them and writes a bulletin to your vault.",
    );
    if (this.plugin.isRunning()) {
      runBtn.setAttr("disabled", "true");
      runBtn.setText("3. Run bulletin cycle (running…)");
    }
    runBtn.onclick = () => {
      // Notices and validation live inside startBulletinRun(); ignore the
      // returned promise here so a long run doesn't block the click handler.
      void this.plugin.startBulletinRun();
    };

    const openBtn = actions.createEl("button", { text: "Open latest bulletin" });
    openBtn.onclick = async () => {
      const latest = this.store.latestPacket();
      if (!latest) {
        new Notice("No bulletins yet. Run a cycle first.");
        return;
      }
      const path = normalizePath(
        `${this.store.settings.output.rootFolder}/Bulletins/${latest.period_end.slice(0, 10)}.md`,
      );
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
      else new Notice(`File not found: ${path}`);
    };

    // ── Recent bulletins ──
    this.renderRecentBulletins(root);

    // ── Log block ──
    root.createDiv({ cls: "synod-section-label", text: "Recent log" });
    root.createDiv({ cls: "synod-log", attr: { id: "synod-log" } });
    this.renderLog();
  }

  private renderRecentBulletins(root: HTMLElement): void {
    const folderPath = normalizePath(
      `${this.store.settings.output.rootFolder}/Bulletins`,
    );
    const files = this.app.vault
      .getFiles()
      .filter((f) => f.path.startsWith(`${folderPath}/`) && f.extension === "md")
      .sort((a, b) => b.basename.localeCompare(a.basename))
      .slice(0, RECENT_BULLETINS_MAX);
    if (!files.length) return;

    root.createDiv({ cls: "synod-section-label", text: "Recent bulletins" });
    const list = root.createDiv({ cls: "synod-bulletin-list" });
    for (const f of files) {
      const row = list.createDiv({ cls: "synod-bulletin-row" });
      const link = row.createEl("a", {
        cls: "synod-bulletin-link",
        text: f.basename,
      });
      link.setAttr("href", "#");
      link.onclick = (e) => {
        e.preventDefault();
        void this.app.workspace.getLeaf(false).openFile(f);
      };
    }
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
