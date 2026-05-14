/* Settings tab. Mirrors the SynodSettings shape so users can find every knob.
 *
 * Per Obsidian guidelines:
 *   - no top-level heading on the tab itself,
 *   - section headings use Setting.setHeading() instead of <h2>/<h3>,
 *   - heading text never contains the word "settings".
 */

import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import { getLlm } from "../llm";
import type SynodPlugin from "../main";
import { agentModelFor, type Provider } from "../settings";
import { FolderSuggest } from "./folder-suggest";

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
      .setDesc(
        "Where the LLMs run. Ollama keeps everything on your machine; OpenRouter and llama-swap are remote / OpenAI-compatible endpoints.",
      )
      .addDropdown((dd) => {
        dd.addOption("ollama", "Ollama (local, recommended)");
        dd.addOption("openrouter", "OpenRouter");
        dd.addOption("llama_swap", "llama-swap (OpenAI-compatible proxy)");
        dd.setValue(s.provider).onChange(async (v) => {
          await this.plugin.store.updateSettings({ provider: v as Provider });
          this.display();
        });
      });

    if (s.provider === "ollama") {
      this.textSetting(containerEl, "Ollama base URL", "Where Ollama is listening. Default: http://localhost:11434", s.ollama.baseUrl, async (v) => {
        await this.plugin.store.updateSettings({ ollama: { ...s.ollama, baseUrl: v } });
      });
      this.textSetting(containerEl, "Agent model", "Drives the per-value agents and tension finder. A solid 7B–32B instruct model is plenty.", s.ollama.agentModel, async (v) => {
        await this.plugin.store.updateSettings({ ollama: { ...s.ollama, agentModel: v } });
      });
      this.textSetting(containerEl, "Compiler model", "Validates and assembles the bulletin. Larger models give cleaner output; the same model as the agent is fine.", s.ollama.compilerModel, async (v) => {
        await this.plugin.store.updateSettings({ ollama: { ...s.ollama, compilerModel: v } });
      });
    } else if (s.provider === "openrouter") {
      this.textSetting(containerEl, "OpenRouter API key", "Get one at openrouter.ai. Stored only in this vault's plugin data.", s.openrouter.apiKey, async (v) => {
        await this.plugin.store.updateSettings({ openrouter: { ...s.openrouter, apiKey: v } });
      });
      this.textSetting(containerEl, "Agent model", "OpenRouter model slug for value agents (e.g. qwen/qwen-2.5-72b-instruct).", s.openrouter.agentModel, async (v) => {
        await this.plugin.store.updateSettings({ openrouter: { ...s.openrouter, agentModel: v } });
      });
      this.textSetting(containerEl, "Compiler model", "OpenRouter model slug for the compiler passes.", s.openrouter.compilerModel, async (v) => {
        await this.plugin.store.updateSettings({ openrouter: { ...s.openrouter, compilerModel: v } });
      });
    } else {
      this.textSetting(containerEl, "llama-swap base URL", "Endpoint of your llama-swap (or any OpenAI-compatible) proxy.", s.llamaSwap.baseUrl, async (v) => {
        await this.plugin.store.updateSettings({ llamaSwap: { ...s.llamaSwap, baseUrl: v } });
      });
      this.textSetting(containerEl, "Agent model", "Model name as the proxy exposes it.", s.llamaSwap.agentModel, async (v) => {
        await this.plugin.store.updateSettings({ llamaSwap: { ...s.llamaSwap, agentModel: v } });
      });
      this.textSetting(containerEl, "Compiler model", "Model name as the proxy exposes it. Can match the agent model.", s.llamaSwap.compilerModel, async (v) => {
        await this.plugin.store.updateSettings({ llamaSwap: { ...s.llamaSwap, compilerModel: v } });
      });
    }

    // ── Test connection ───────────────────────────────────────────────────
    const testSetting = new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Sends a one-token probe to confirm the agent model responds. Run this whenever you change a model or URL.");
    testSetting.addButton((b) =>
      b.setButtonText("Test connection").onClick(async () => {
        b.setDisabled(true).setButtonText("Testing…");
        testSetting.setDesc("Contacting model…");
        try {
          const settings = this.plugin.store.settings;
          const model = agentModelFor(settings);
          const llm = getLlm(settings, "agent");
          const reply = await llm("You are a connectivity probe.", "Reply with the single word OK.", {
            temperature: 0,
          });
          const trimmed = (reply ?? "").trim();
          const preview = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
          testSetting.setDesc(`✓ Connected to ${settings.provider} (${model}). Reply: ${preview || "(empty)"}`);
          new Notice("Connection succeeded.");
        } catch (e) {
          const msg = (e as Error).message;
          testSetting.setDesc(`✗ Connection failed: ${msg}`);
          new Notice(`Connection failed: ${msg}`);
        } finally {
          b.setDisabled(false).setButtonText("Test connection");
        }
      }),
    );

    // ── Output ───────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Output").setHeading();
    this.folderSetting(containerEl, "Vault root folder", "Synod writes Bulletins/, Values/, and Entries/ inside this folder.", s.output.rootFolder, async (v) => {
      await this.plugin.store.updateSettings({ output: { ...s.output, rootFolder: v } });
    });
    this.toggleSetting(containerEl, "Write entry files to vault", "Mostly useful for Rosebud imports — your existing notes are already in the vault, so leave this off if your source is an Obsidian folder.", s.output.writeEntryFiles, async (v) => {
      await this.plugin.store.updateSettings({ output: { ...s.output, writeEntryFiles: v } });
    });
    this.toggleSetting(containerEl, "Write value files to vault", "Saves one short note per active value, handy for backlinking from your bulletins.", s.output.writeValueFiles, async (v) => {
      await this.plugin.store.updateSettings({ output: { ...s.output, writeValueFiles: v } });
    });

    // ── Prompts ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Prompts").setHeading();
    this.folderSetting(containerEl, "Prompt folder", "All agent system prompts live here as plain markdown — edit them like any other note. Changes apply on the next run.", s.prompts.folder, async (v) => {
      await this.plugin.store.updateSettings({ prompts: { ...s.prompts, folder: v } });
      await this.plugin.prompts.ensureDefaults();
    });
    new Setting(containerEl)
      .setName("Restore default prompts")
      .setDesc("Re-creates any missing prompt files. Existing edits are not overwritten.")
      .addButton((b) =>
        b.setButtonText("Restore defaults").onClick(async () => {
          await this.plugin.prompts.ensureDefaults();
          new Notice("Default prompt files ensured.");
        }),
      );

    // ── Schedule ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Schedule").setHeading();
    this.numberSetting(containerEl, "Bulletin interval (hours)", "How often Synod writes a new bulletin in the background. 168 = weekly, 24 = daily, 0 = manual only.", s.schedule.bulletinIntervalHours, async (v) => {
      await this.plugin.store.updateSettings({ schedule: { ...s.schedule, bulletinIntervalHours: v } });
      this.plugin.rescheduleBulletin();
    });
    this.toggleSetting(containerEl, "Run on plugin startup", "Trigger a run when Obsidian opens — but only if the interval has elapsed since the last bulletin.", s.schedule.runOnStartup, async (v) => {
      await this.plugin.store.updateSettings({ schedule: { ...s.schedule, runOnStartup: v } });
    });
    this.numberSetting(containerEl, "Minimum entries to run", "Skip a scheduled run if the period contains fewer than this many entries. Useful if you journal sporadically.", s.schedule.minEntries, async (v) => {
      await this.plugin.store.updateSettings({ schedule: { ...s.schedule, minEntries: v } });
    });

    // ── Prompt budgets ───────────────────────────────────────────────────
    new Setting(containerEl).setName("Prompt budgets").setHeading();
    this.numberSetting(containerEl, "Extractor max chars per call", "Rough soft cap for the value-discovery prompt. ~4 chars ≈ 1 token. Lower it if your model has a small context window.", s.budgets.extractorMaxCharsPerCall, async (v) => {
      await this.plugin.store.updateSettings({ budgets: { ...s.budgets, extractorMaxCharsPerCall: v } });
    });
    this.numberSetting(containerEl, "Value-agent max chars per call", "Same idea, but for each per-value agent. Long entries are split across multiple calls rather than truncated.", s.budgets.valueAgentMaxCharsPerCall, async (v) => {
      await this.plugin.store.updateSettings({ budgets: { ...s.budgets, valueAgentMaxCharsPerCall: v } });
    });

    // ── Tensions ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Tensions").setHeading();
    this.numberSetting(containerEl, "Severity threshold for escalation", "Tensions scoring above this (0–1) are flagged as headline items in the bulletin. Higher = quieter, only the sharpest disagreements surface.", s.tensions.severityThreshold, async (v) => {
      await this.plugin.store.updateSettings({ tensions: { ...s.tensions, severityThreshold: v } });
    });
    this.numberSetting(containerEl, "Escalation cooldown (hours)", "Don't re-escalate the same tension more often than this, even if it stays unresolved.", s.tensions.escalationCooldownHours, async (v) => {
      await this.plugin.store.updateSettings({ tensions: { ...s.tensions, escalationCooldownHours: v } });
    });

    // ── Active values ────────────────────────────────────────────────────
    new Setting(containerEl).setName("Active values").setHeading();
    const values = this.plugin.store.values;
    if (!values.length) {
      const empty = new Setting(containerEl);
      empty.setDesc(
        "No values yet. Open the Synod side panel (ribbon icon) and run \"Discover values\" once you've imported some entries.",
      );
    } else {
      for (const v of values) {
        new Setting(containerEl)
          .setName(`${v.name}${v.definition_personalised ? "" : "  (default wording)"}`)
          .setDesc(v.definition)
          .addToggle((t) =>
            t
              .setValue(v.active)
              .setTooltip("Include this value in the next bulletin")
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
  private folderSetting(c: HTMLElement, name: string, desc: string, val: string, save: (v: string) => Promise<void>) {
    new Setting(c).setName(name).setDesc(desc).addText((t) => {
      t.setValue(val).onChange(async (v) => save(v));
      new FolderSuggest(this.app, t.inputEl);
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
