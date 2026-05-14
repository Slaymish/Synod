/* Import modal: choose importer kind + source, run the import, report counts.
 *
 * Stability notes:
 *   - State is held per-kind during the modal's lifetime, so flipping the
 *     dropdown never destroys the values typed for another kind.
 *   - On a successful import, the chosen kind's config is persisted back to
 *     settings under `importers.configs[kind]`. Other kinds are untouched.
 *   - The body is rendered by a single `render()` helper rather than a
 *     recursive `onOpen()`; the dropdown re-renders only the body, not the
 *     modal title/frame.
 */

import { App, Modal, Notice, Setting, normalizePath, TFolder } from "obsidian";

import { ingest } from "../ingestion/ingest";
import { runImport } from "../importers";
import type { Store } from "../storage/store";
import type { ImporterKind } from "../settings";
import { FolderSuggest } from "./folder-suggest";

interface ObsidianFolderState {
  folder: string;
}
interface ObsidianJournalState {
  folder: string;
  dateFormat: string;
}

export class ImportModal extends Modal {
  private store: Store;
  private kind: ImporterKind;

  /** Per-kind in-modal state. Seeded from settings, mutated as the user types,
   *  preserved across dropdown switches, and written back on success. */
  private folderState: ObsidianFolderState;
  private journalState: ObsidianJournalState;

  /** File chosen via the file input or drag-and-drop (rosebud only). */
  private fileInputEl: HTMLInputElement | null = null;
  private droppedFile: File | null = null;

  /** Element re-rendered when the kind changes. The modal title and dropdown
   *  live above this and are not re-created. */
  private bodyEl: HTMLElement | null = null;

  constructor(app: App, store: Store) {
    super(app);
    this.store = store;
    this.kind = store.settings.importers.defaultKind;
    const cfg = store.settings.importers.configs;
    this.folderState = { ...cfg["obsidian-folder"] };
    this.journalState = { ...cfg["obsidian-journal"] };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Import journal entries");

    new Setting(contentEl)
      .setName("Importer")
      .setDesc("Choose the source format")
      .addDropdown((dd) => {
        dd.addOption("rosebud", "Rosebud (.md or .zip file)");
        dd.addOption("obsidian-folder", "Obsidian folder (any markdown notes)");
        dd.addOption("obsidian-journal", "Obsidian Journals plugin format");
        dd.setValue(this.kind);
        dd.onChange((v) => {
          this.kind = v as ImporterKind;
          this.renderBody();
        });
      });

    this.bodyEl = contentEl.createDiv();
    this.renderBody();

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Import")
        .setCta()
        .onClick(() => this.runImport()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
    this.bodyEl = null;
    this.fileInputEl = null;
    this.droppedFile = null;
  }

  private renderBody(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    // The file input is kind-specific; null it out so we never accidentally
    // read a stale handle from a previous render.
    this.fileInputEl = null;

    if (this.kind === "rosebud") {
      this.renderRosebud(this.bodyEl);
    } else if (this.kind === "obsidian-folder") {
      this.renderObsidianFolder(this.bodyEl);
    } else {
      this.renderObsidianJournal(this.bodyEl);
    }
  }

  // ── Per-kind body renderers ────────────────────────────────────────────

  private renderRosebud(host: HTMLElement): void {
    this.droppedFile = null;
    host.createEl("p", { text: "Choose a Rosebud .md or .zip export from disk:" });
    this.fileInputEl = host.createEl("input", {
      type: "file",
      attr: { accept: ".md,.zip" },
    });

    const dropZone = host.createDiv({ cls: "synod-import-dropzone" });
    dropZone.setText("…or drag and drop a .md or .zip file here");
    const dropStatus = host.createDiv({ cls: "synod-import-dropstatus" });

    const refreshStatus = () => {
      const f = this.droppedFile ?? this.fileInputEl?.files?.[0] ?? null;
      dropStatus.setText(f ? `Selected: ${f.name}` : "");
    };

    this.fileInputEl.addEventListener("change", () => {
      this.droppedFile = null;
      refreshStatus();
    });

    const setHover = (on: boolean) => dropZone.toggleClass("is-active", on);

    dropZone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      setHover(true);
    });
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setHover(true);
    });
    dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      setHover(false);
    });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      setHover(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".md") && !lower.endsWith(".zip")) {
        new Notice("Only .md or .zip files are accepted.");
        return;
      }
      this.droppedFile = file;
      refreshStatus();
    });

    dropZone.addEventListener("click", () => this.fileInputEl?.click());
  }

  private renderObsidianFolder(host: HTMLElement): void {
    new Setting(host)
      .setName("Vault folder")
      .setDesc("Folder inside this vault containing your journal notes")
      .addText((t) => {
        t.setValue(this.folderState.folder).onChange((v) => (this.folderState.folder = v));
        new FolderSuggest(this.app, t.inputEl);
      });
  }

  private renderObsidianJournal(host: HTMLElement): void {
    new Setting(host)
      .setName("Vault folder")
      .setDesc("Folder inside this vault containing your journal notes")
      .addText((t) => {
        t.setValue(this.journalState.folder).onChange((v) => (this.journalState.folder = v));
        new FolderSuggest(this.app, t.inputEl);
      });
    new Setting(host)
      .setName("Date format in filename")
      .setDesc("Tokens: YYYY, MM, DD")
      .addText((t) => {
        t.setValue(this.journalState.dateFormat).onChange((v) => (this.journalState.dateFormat = v));
      });
  }

  // ── Validation + run ───────────────────────────────────────────────────

  private folderExists(path: string): boolean {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return f instanceof TFolder;
  }

  private async runImport(): Promise<void> {
    try {
      let raws;
      if (this.kind === "rosebud") {
        const file = this.droppedFile ?? this.fileInputEl?.files?.[0];
        if (!file) {
          new Notice("Choose or drop a file first.");
          return;
        }
        const bytes = await file.arrayBuffer();
        raws = await runImport(this.app, "rosebud", { kind: "file", filename: file.name, bytes });
      } else if (this.kind === "obsidian-folder") {
        const folder = this.folderState.folder.trim();
        if (!folder) {
          new Notice("Enter a vault folder.");
          return;
        }
        if (!this.folderExists(folder)) {
          new Notice(`Folder not found in this vault: ${folder}`);
          return;
        }
        raws = await runImport(this.app, "obsidian-folder", { kind: "folder", folder });
      } else {
        const folder = this.journalState.folder.trim();
        const dateFormat = this.journalState.dateFormat.trim();
        if (!folder) {
          new Notice("Enter a vault folder.");
          return;
        }
        if (!this.folderExists(folder)) {
          new Notice(`Folder not found in this vault: ${folder}`);
          return;
        }
        if (!dateFormat) {
          new Notice("Enter a date format.");
          return;
        }
        raws = await runImport(this.app, "obsidian-journal", { kind: "folder", folder, dateFormat });
      }

      // Persist only the kind that was actually used; the other kind's saved
      // configuration is preserved exactly as it was on disk.
      const prevImporters = this.store.settings.importers;
      const nextConfigs = { ...prevImporters.configs };
      if (this.kind === "obsidian-folder") {
        nextConfigs["obsidian-folder"] = { folder: this.folderState.folder.trim() };
      } else if (this.kind === "obsidian-journal") {
        nextConfigs["obsidian-journal"] = {
          folder: this.journalState.folder.trim(),
          dateFormat: this.journalState.dateFormat.trim(),
        };
      }
      await this.store.updateSettings({
        importers: {
          ...prevImporters,
          defaultKind: this.kind,
          configs: nextConfigs,
        },
      });

      const { added, duplicates } = await ingest(this.store, raws);
      new Notice(`Imported ${added} new entr${added === 1 ? "y" : "ies"} (${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped).`);
      this.close();
    } catch (e) {
      new Notice(`Import failed: ${(e as Error).message}`);
    }
  }
}
