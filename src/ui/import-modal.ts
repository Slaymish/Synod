/* Import modal: choose importer kind + source, run the import, report counts. */

import { App, Modal, Notice, Setting } from "obsidian";

import { ingest } from "../ingestion/ingest";
import { runImport } from "../importers";
import type { Store } from "../storage/store";
import type { ImporterKind } from "../settings";

export class ImportModal extends Modal {
  private store: Store;
  private kind: ImporterKind;
  private folder: string;
  private journalDateFormat: string;
  private fileInputEl: HTMLInputElement | null = null;

  constructor(app: App, store: Store) {
    super(app);
    this.store = store;
    this.kind = store.settings.importers.defaultKind;
    this.folder = store.settings.importers.obsidianSourceFolder;
    this.journalDateFormat = store.settings.importers.journalDateFormat;
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
          this.onOpen(); // re-render dependent fields
        });
      });

    if (this.kind === "rosebud") {
      const wrap = contentEl.createDiv();
      wrap.createEl("p", { text: "Choose a Rosebud .md or .zip export from disk:" });
      this.fileInputEl = wrap.createEl("input", {
        type: "file",
        attr: { accept: ".md,.zip" },
      });
    } else {
      new Setting(contentEl)
        .setName("Vault folder")
        .setDesc("Folder inside this vault containing your journal notes")
        .addText((t) => {
          t.setValue(this.folder).onChange((v) => (this.folder = v));
        });
      if (this.kind === "obsidian-journal") {
        new Setting(contentEl)
          .setName("Date format in filename")
          .setDesc("Tokens: YYYY, MM, DD")
          .addText((t) => {
            t.setValue(this.journalDateFormat).onChange((v) => (this.journalDateFormat = v));
          });
      }
    }

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Import")
        .setCta()
        .onClick(() => this.runImport()),
    );
  }

  private async runImport(): Promise<void> {
    try {
      let raws;
      if (this.kind === "rosebud") {
        const file = this.fileInputEl?.files?.[0];
        if (!file) {
          new Notice("Choose a file first.");
          return;
        }
        const bytes = await file.arrayBuffer();
        raws = await runImport(this.app, "rosebud", { kind: "file", filename: file.name, bytes });
      } else if (this.kind === "obsidian-folder") {
        raws = await runImport(this.app, "obsidian-folder", { kind: "folder", folder: this.folder });
      } else {
        raws = await runImport(this.app, "obsidian-journal", {
          kind: "folder",
          folder: this.folder,
          dateFormat: this.journalDateFormat,
        });
      }
      const { added, duplicates } = await ingest(this.store, raws);
      new Notice(`Imported ${added} new entr${added === 1 ? "y" : "ies"} (${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped).`);
      this.close();
    } catch (e) {
      new Notice(`Import failed: ${(e as Error).message}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
