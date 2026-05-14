/* Settings tab. Mirrors the SynodSettings shape so users can find every knob.
 *
 * Per Obsidian guidelines:
 *   - no top-level heading on the tab itself,
 *   - section headings use Setting.setHeading() instead of <h2>/<h3>,
 *   - heading text never contains the word "settings".
 */

import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import type SynodPlugin from "../main";
import type { ImporterKind, Provider } from "../settings";

export class SynodSettingsTab extends PluginSettingTab {
  private plugin: SynodPlugin;

  constructor(app: App, plugin: SynodPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.store.settings;
    containerEl.empty();

    // ── LLM provider (top section, no heading per guidelines) ────────────
    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Which backend hosts your LLMs.")
      .addDropdown((dd) => {
        dd.addOption("ollama", "Ollama (local)");
        dd.addOption("openrouter", "OpenRouter");
        dd.addOption("llama_swap", "llama-swap (OpenAI-compatible proxy)");
        dd.setValue(s.provider).onChange(async (v) => {
          await this.plugin.store.updateSettings({ provider: v as Provider });
          this.display();
        });
      });

    if (s.provider === "ollama") {
      this.textSetting(containerEl, "Ollama base URL", "", s.ollama.baseUrl, async (v) => {
        await this.plugin.store.updateSettings({ ollama: { ...s.ollama, baseUrl: v } });
      });
      this.textSetting(containerEl, "Agent model", "Used by value agents and the tension finder.", s.ollama.agentModel, async (v) => {
        await this.plugin.store.updateSettings({ ollama: { ...s.ollama, agentModel: v } });
      });
      this.textSetting(containerEl, "Compiler model", "Used by validator passes.", s.ollama.compilerModel, async (v) => {
        await this.plugin.store.updateSettings({ ollama: { ...s.ollama, compilerModel: v } });
      });
    } else if (s.provider === "openrouter") {
      this.textSetting(containerEl, "OpenRouter API key", "", s.openrouter.apiKey, async (v) => {
        await this.plugin.store.updateSettings({ openrouter: { ...s.openrouter, apiKey: v } });
      });
      this.textSetting(containerEl, "Agent model", "", s.openrouter.agentModel, async (v) => {
        await this.plugin.store.updateSettings({ openrouter: { ...s.openrouter, agentModel: v } });
      });
      this.textSetting(containerEl, "Compiler model", "", s.openrouter.compilerModel, async (v) => {
        await this.plugin.store.updateSettings({ openrouter: { ...s.openrouter, compilerModel: v } });
      });
    } else {
      this.textSetting(containerEl, "llama-swap base URL", "", s.llamaSwap.baseUrl, async (v) => {
        await this.plugin.store.updateSettings({ llamaSwap: { ...s.llamaSwap, baseUrl: v } });
      });
      this.textSetting(containerEl, "Agent model", "", s.llamaSwap.agentModel, async (v) => {
        await this.plugin.store.updateSettings({ llamaSwap: { ...s.llamaSwap, agentModel: v } });
      });
      this.textSetting(containerEl, "Compiler model", "", s.llamaSwap.compilerModel, async (v) => {
        await this.plugin.store.updateSettings({ llamaSwap: { ...s.llamaSwap, compilerModel: v } });
      });
    }

    // ── Importers ────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Importers").setHeading();
    new Setting(containerEl)
      .setName("Default importer")
      .addDropdown((dd) => {
        dd.addOption("rosebud", "Rosebud");
        dd.addOption("obsidian-folder", "Obsidian folder");
        dd.addOption("obsidian-journal", "Obsidian journal");
        dd.setValue(s.importers.defaultKind).onChange(async (v) => {
          await this.plugin.store.updateSettings({
            importers: { ...s.importers, defaultKind: v as ImporterKind },
          });
        });
      });

    this.textSetting(containerEl, "Source folder", "Vault folder used by the Obsidian importers.", s.importers.obsidianSourceFolder, async (v) => {
      await this.plugin.store.updateSettings({ importers: { ...s.importers, obsidianSourceFolder: v } });
    });
    this.textSetting(containerEl, "Journal date format", "Tokens: YYYY, MM, DD.", s.importers.journalDateFormat, async (v) => {
      await this.plugin.store.updateSettings({ importers: { ...s.importers, journalDateFormat: v } });
    });

    // ── Output ───────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Output").setHeading();
    this.textSetting(containerEl, "Vault root folder", "Where bulletins, values, and (optionally) entries are written.", s.output.rootFolder, async (v) => {
      await this.plugin.store.updateSettings({ output: { ...s.output, rootFolder: v } });
    });
    this.toggleSetting(containerEl, "Write entry files to vault", "Off by default. Enable only for Rosebud imports — your other source notes already exist in the vault.", s.output.writeEntryFiles, async (v) => {
      await this.plugin.store.updateSettings({ output: { ...s.output, writeEntryFiles: v } });
    });
    this.toggleSetting(containerEl, "Write value files to vault", "One short note per active value.", s.output.writeValueFiles, async (v) => {
      await this.plugin.store.updateSettings({ output: { ...s.output, writeValueFiles: v } });
    });

    // ── Prompts ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Prompts").setHeading();
    this.textSetting(containerEl, "Prompt folder", "Vault folder containing editable agent system prompts.", s.prompts.folder, async (v) => {
      await this.plugin.store.updateSettings({ prompts: { ...s.prompts, folder: v } });
      await this.plugin.prompts.ensureDefaults();
    });
    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Re-create default prompts").onClick(async () => {
        await this.plugin.prompts.ensureDefaults();
        new Notice("Default prompts ensured.");
      }),
    );

    // ── Schedule ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Schedule").setHeading();
    this.numberSetting(containerEl, "Bulletin interval (hours)", "168 = weekly.", s.schedule.bulletinIntervalHours, async (v) => {
      await this.plugin.store.updateSettings({ schedule: { ...s.schedule, bulletinIntervalHours: v } });
      this.plugin.rescheduleBulletin();
    });
    this.toggleSetting(containerEl, "Run on plugin startup", "Trigger a bulletin run when Obsidian opens, but only if the interval has elapsed.", s.schedule.runOnStartup, async (v) => {
      await this.plugin.store.updateSettings({ schedule: { ...s.schedule, runOnStartup: v } });
    });
    this.numberSetting(containerEl, "Minimum entries to run", "Skip the run if fewer entries exist for the period.", s.schedule.minEntries, async (v) => {
      await this.plugin.store.updateSettings({ schedule: { ...s.schedule, minEntries: v } });
    });

    // ── Prompt budgets ───────────────────────────────────────────────────
    new Setting(containerEl).setName("Prompt budgets").setHeading();
    this.numberSetting(containerEl, "Extractor max chars per call", "Roughly one token per four chars.", s.budgets.extractorMaxCharsPerCall, async (v) => {
      await this.plugin.store.updateSettings({ budgets: { ...s.budgets, extractorMaxCharsPerCall: v } });
    });
    this.numberSetting(containerEl, "Value-agent max chars per call", "", s.budgets.valueAgentMaxCharsPerCall, async (v) => {
      await this.plugin.store.updateSettings({ budgets: { ...s.budgets, valueAgentMaxCharsPerCall: v } });
    });

    // ── Tensions ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Tensions").setHeading();
    this.numberSetting(containerEl, "Severity threshold for escalation", "0 to 1.", s.tensions.severityThreshold, async (v) => {
      await this.plugin.store.updateSettings({ tensions: { ...s.tensions, severityThreshold: v } });
    });
    this.numberSetting(containerEl, "Escalation cooldown (hours)", "", s.tensions.escalationCooldownHours, async (v) => {
      await this.plugin.store.updateSettings({ tensions: { ...s.tensions, escalationCooldownHours: v } });
    });

    // ── Active values ────────────────────────────────────────────────────
    new Setting(containerEl).setName("Active values").setHeading();
    const values = this.plugin.store.values;
    if (!values.length) {
      const empty = new Setting(containerEl);
      empty.setDesc("No values yet. Open the Synod side panel and select Discover values.");
    } else {
      for (const v of values) {
        new Setting(containerEl)
          .setName(`${v.name}${v.definition_personalised ? "" : "  (boilerplate)"}`)
          .setDesc(v.definition)
          .addToggle((t) =>
            t
              .setValue(v.active)
              .setTooltip("Active")
              .onChange(async (val) => {
                await this.plugin.store.setValueActive(v.id, val);
              }),
          )
          .addButton((b) =>
            b
              .setButtonText("Delete")
              .setWarning()
              .onClick(async () => {
                await this.plugin.store.deleteValue(v.id);
                this.display();
              }),
          );
      }
    }
  }

  // ── Setting helpers — compact wrappers around obsidian.Setting ──────────
  private textSetting(c: HTMLElement, name: string, desc: string, val: string, save: (v: string) => Promise<void>) {
    new Setting(c).setName(name).setDesc(desc).addText((t) => {
      t.setValue(val).onChange(async (v) => save(v));
    });
  }
  private numberSetting(c: HTMLElement, name: string, desc: string, val: number, save: (v: number) => Promise<void>) {
    new Setting(c).setName(name).setDesc(desc).addText((t) => {
      t.setValue(String(val)).onChange(async (v) => {
        const n = Number(v);
        if (!Number.isNaN(n)) await save(n);
      });
    });
  }
  private toggleSetting(c: HTMLElement, name: string, desc: string, val: boolean, save: (v: boolean) => Promise<void>) {
    new Setting(c).setName(name).setDesc(desc).addToggle((t) => {
      t.setValue(val).onChange(async (v) => save(v));
    });
  }
}
