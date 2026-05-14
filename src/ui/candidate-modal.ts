/* HITL value confirmation. After value extraction the user picks which
 * candidates become active values. They can also rewrite the definition
 * inline; doing so flips `definition_personalised = true` so future
 * agents stop relying on the academic boilerplate.
 */

import { App, Modal, Notice, Setting } from "obsidian";

import type { CandidateValue } from "../values/extractor";
import type { Store } from "../storage/store";
import { nowIso } from "../util/time";

export class CandidateValueModal extends Modal {
  private store: Store;
  private candidates: CandidateValue[];
  private selected = new Set<string>();
  private edits = new Map<string, { name: string; definition: string }>();

  constructor(app: App, store: Store, candidates: CandidateValue[]) {
    super(app);
    this.store = store;
    this.candidates = candidates;
    for (const c of candidates) {
      this.edits.set(c.id, { name: c.name, definition: c.definition });
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Confirm your values");
    contentEl.createEl("p", {
      cls: "synod-modal-intro",
      text:
        "These showed up in what you've been writing. Tick the ones that ring true — Synod will give each its own agent. " +
        "Rewriting the definition in your own words makes that agent reason much more like you. You can re-run discovery any time.",
    });

    for (const c of this.candidates) {
      const card = contentEl.createDiv({ cls: "synod-candidate" });
      const header = card.createDiv({ cls: "synod-candidate-header" });
      const cb = header.createEl("input", { type: "checkbox" });
      cb.onchange = () => {
        if (cb.checked) this.selected.add(c.id);
        else this.selected.delete(c.id);
      };
      header.createSpan({
        text: ` ${c.name}  (score ${c.score.toFixed(2)}${c.schwartz_anchor ? `, ${c.schwartz_anchor}` : ", custom"})`,
        cls: "synod-candidate-title",
      });

      new Setting(card)
        .setName("Name")
        .addText((t) => {
          t.setValue(c.name).onChange((v) => {
            const e = this.edits.get(c.id)!;
            e.name = v;
          });
        });
      new Setting(card)
        .setName("Definition")
        .addTextArea((t) => {
          t.setValue(c.definition).onChange((v) => {
            const e = this.edits.get(c.id)!;
            e.definition = v;
          });
          t.inputEl.rows = 3;
          t.inputEl.addClass("synod-definition-input");
        });

      if (c.evidence.length) {
        const ev = card.createDiv({ cls: "synod-evidence" });
        ev.createEl("strong", { text: "Evidence:" });
        const list = ev.createEl("ul");
        for (const q of c.evidence.slice(0, 3)) list.createEl("li", { text: q });
      }
    }

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Confirm selected")
        .setCta()
        .onClick(() => this.commit()),
    );
  }

  private async commit(): Promise<void> {
    let count = 0;
    for (const c of this.candidates) {
      if (!this.selected.has(c.id)) continue;
      const edit = this.edits.get(c.id)!;
      const personalised =
        edit.definition.trim() !== c.definition.trim() || edit.name.trim() !== c.name.trim();
      await this.store.upsertValue({
        id: c.id,
        name: edit.name.trim(),
        definition: edit.definition.trim(),
        schwartz_anchor: c.schwartz_anchor,
        confirmed_at: nowIso(),
        active: true,
        definition_personalised: personalised,
        version: 1,
      });
      count++;
    }
    new Notice(`Confirmed ${count} value${count === 1 ? "" : "s"}.`);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
