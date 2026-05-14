/* User-facing settings. Every knob from the Python `config.py` lives here so
 * the settings tab can expose it.
 */

export type Provider = "ollama" | "openrouter" | "llama_swap";

export type ImporterKind = "rosebud" | "obsidian-folder" | "obsidian-journal";

export interface SynodSettings {
  // ── LLM provider ──
  provider: Provider;

  ollama: {
    baseUrl: string;
    agentModel: string;
    compilerModel: string;
  };
  openrouter: {
    apiKey: string;
    agentModel: string;
    compilerModel: string;
  };
  llamaSwap: {
    baseUrl: string;
    agentModel: string;
    compilerModel: string;
  };

  // ── Importers ──
  importers: {
    /** Last-used importer kind. The import modal opens on this. */
    defaultKind: ImporterKind;
    /** Per-kind remembered configuration. Switching kinds in the import
     *  modal never overwrites another kind's saved values. */
    configs: {
      "obsidian-folder": { folder: string };
      "obsidian-journal": { folder: string; dateFormat: string };
    };
  };

  // ── Output (in-vault) ──
  output: {
    /** Vault folder where Synod writes Entries/, Values/, Bulletins/ */
    rootFolder: string;
    writeEntryFiles: boolean;
    writeValueFiles: boolean;
  };

  // ── Editable agent prompts ──
  prompts: {
    /** Vault folder containing user-editable system prompts.
     *  Files: value-agent.md, compiler-finder.md, compiler-validator.md,
     *         compiler-report-validator.md, schwartz-extractor.md
     */
    folder: string;
  };

  // ── Schedule ──
  schedule: {
    bulletinIntervalHours: number; // 168 = weekly
    runOnStartup: boolean;
    minEntries: number;
  };

  // ── Budgets ──
  budgets: {
    extractorMaxCharsPerCall: number;
    valueAgentMaxCharsPerCall: number;
    bulletinMaxChars: number;
  };

  // ── Tensions / escalation ──
  tensions: {
    severityThreshold: number;
    escalationCooldownHours: number;
  };
}

export const DEFAULT_SETTINGS: SynodSettings = {
  provider: "ollama",

  ollama: {
    baseUrl: "http://localhost:11434",
    agentModel: "qwen2.5:32b",
    compilerModel: "llama3:70b",
  },
  openrouter: {
    apiKey: "",
    agentModel: "qwen/qwen-2.5-72b-instruct",
    compilerModel: "meta-llama/llama-3.1-70b-instruct",
  },
  llamaSwap: {
    baseUrl: "http://localhost:8080",
    agentModel: "uncensored-r",
    compilerModel: "uncensored-r",
  },

  importers: {
    defaultKind: "obsidian-folder",
    configs: {
      "obsidian-folder": { folder: "Journal" },
      "obsidian-journal": { folder: "Journal", dateFormat: "YYYY-MM-DD" },
    },
  },

  output: {
    rootFolder: "Synod",
    writeEntryFiles: false,
    writeValueFiles: true,
  },

  prompts: {
    folder: "Synod/_prompts",
  },

  schedule: {
    bulletinIntervalHours: 168,
    runOnStartup: false,
    minEntries: 1,
  },

  budgets: {
    extractorMaxCharsPerCall: 24_000,
    valueAgentMaxCharsPerCall: 32_000,
    bulletinMaxChars: 0, // 0 = no cap
  },

  tensions: {
    severityThreshold: 0.8,
    escalationCooldownHours: 72,
  },
};

export function agentModelFor(s: SynodSettings): string {
  return s.provider === "openrouter"
    ? s.openrouter.agentModel
    : s.provider === "llama_swap"
      ? s.llamaSwap.agentModel
      : s.ollama.agentModel;
}

export function compilerModelFor(s: SynodSettings): string {
  return s.provider === "openrouter"
    ? s.openrouter.compilerModel
    : s.provider === "llama_swap"
      ? s.llamaSwap.compilerModel
      : s.ollama.compilerModel;
}
