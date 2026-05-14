# Synod

A council of LLM "value agents" reads your journal, surfaces tensions you
haven't resolved, and never suggests compromises. Runs entirely inside
Obsidian; LLMs are reached via local Ollama, OpenRouter, or any
OpenAI-compatible endpoint (e.g. llama-swap).

## What it does

```diagram
╭─────────────────────╮     ╭──────────────────╮     ╭────────────────╮
│ Import journal      │────▶│ Per-value agent  │────▶│ Compiler       │
│ (Rosebud / vault    │     │ (parallel, fully │     │ (3 passes)     │
│ folder / journals)  │     │  isolated)       │     │                │
╰─────────────────────╯     ╰──────────────────╯     ╰────────┬───────╯
                                                              │
                                                              ▼
                                              ╭──────────────────────╮
                                              │ Bulletin (.md in     │
                                              │ vault) + side panel  │
                                              │ status               │
                                              ╰──────────────────────╯
```

## Three importers

Pick from the *Import journal entries* command, or set a default in
**Settings → Synod → Importers**:

| Importer            | Source                              | Use when…                          |
|---------------------|-------------------------------------|-------------------------------------|
| `rosebud`           | Rosebud `.md` or `.zip` export      | You're migrating off Rosebud.       |
| `obsidian-folder`   | Any folder of markdown notes        | Your journal is free-form notes.    |
| `obsidian-journal`  | Obsidian Journals / Daily Notes     | Filenames are dates (`YYYY-MM-DD`). |

Imports are deduped on SHA-256 of the normalised user text, so re-running an
import never creates phantom duplicates.

## Editable system prompts

On first load the plugin writes default prompt files into
`<vault>/Synod/_prompts/` (path configurable):

- `value-agent.md` — per-value agent system prompt
- `compiler-finder.md` — Pass 1 tension finder
- `compiler-validator.md` — Pass 2 tension validator
- `compiler-report-validator.md` — Pass 0 evidentiary gate
- `schwartz-extractor.md` — value-discovery prompt

Edit them like any markdown note. The next pipeline run reads the changes.
Use `{value_name}` / `{value_definition}` placeholder syntax.

## Settings

Every knob is in **Settings → Community plugins → Synod**:

- **Provider**: Ollama / OpenRouter / llama-swap, with separate models for
  the *agent* role and the *compiler* role.
- **Importers**: default kind, source folder, journal date format.
- **Output**: vault root folder, mirror entries / values to vault toggles.
- **Prompts**: folder location, "re-create defaults" button.
- **Schedule**: bulletin interval (hours), run-on-startup, minimum entries.
- **Prompt budgets**: char-per-call ceilings for extractor and value agents.
- **Tensions**: severity threshold, escalation cooldown.
- **Active values**: list with Active toggle and Delete.

## Status & progress

Open the side panel via the ribbon icon (or *Synod: Open status view*).
The view shows the live phase
(`ingesting → extracting → agents → compiling → writing → done`),
a progress bar, last-run timestamp, counts, and a tail of the log.

## Privacy & network

- Default backend is Ollama on `localhost`. Nothing leaves your machine.
- OpenRouter / llama-swap modes only send data to the endpoint you
  configure in settings. The plugin makes no other network calls.
- All journal text, value definitions, and reports are stored locally:
  - structured records in the plugin's `data.json`,
  - human-readable bulletins / value notes inside your vault.
- No telemetry. No background uploads. No bundled remote code.

## Build from source

```bash
npm install
npm run build      # bundles to main.js
npm test           # pure-function smoke tests (parsers, hashing, packing)
```

To install into a vault during development:

```bash
ln -s "$(pwd)" "/path/to/Vault/.obsidian/plugins/synod"
```

Then in Obsidian: **Settings → Community plugins → enable Synod**.

## Releasing a new version

1. Bump `version` in `manifest.json` (SemVer).
2. Add an entry to `versions.json` mapping the new plugin version to the
   minimum compatible Obsidian version.
3. Commit and push.
4. Create and push a tag whose name exactly matches the version
   (no leading `v`):
   ```bash
   git tag -a 0.2.0 -m "0.2.0"
   git push origin 0.2.0
   ```
5. The GitHub Actions workflow at `.github/workflows/release.yml` builds
   the plugin, runs tests, and publishes a draft release with
   `main.js`, `manifest.json`, and `styles.css` attached.
6. Edit the draft release with notes, then publish.

## Architecture notes

- **Storage**: JSON via `Plugin.loadData()/saveData()`. No SQLite, no
  vector DB. Entries fit in context for typical journal sizes; if/when
  they don't, plug a vector store into `agents/value-agent.ts`.
- **Isolation contract**: `runValueAgent()` takes only one value's
  `(id, name, definition)` plus the shared corpus. The Compiler is the
  only module that sees all reports; its output is never fed back into
  the agents.
- **LLM single-flight**: `llm/index.ts` funnels generation through one
  Promise so single-GPU backends don't trample each other when value
  agents fan out in parallel. Hosted backends can lift this gate.
- **Prompt budgeting**: char-based proxy for tokens. Long entries are
  split into labelled `[date — part k/N]` blocks across LLM calls — never
  silently truncated.

## License

MIT — see `LICENSE`.
