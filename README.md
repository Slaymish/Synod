# Synod

**A council of LLM agents that read your journal, surface the tensions you haven't resolved, and refuse to suggest a compromise.**

Most journaling tools nudge you toward calm. Synod does the opposite. It treats each of your stated values — *honesty*, *family*, *ambition*, whatever they happen to be — as its own agent, lets each one read the same period of journal entries in isolation, then has a compiler look across their reports for the places where they pull in different directions. The output is a short bulletin in your vault: where you contradicted yourself, what each value would have you do, and what's left unresolved.

It runs entirely inside Obsidian. The default backend is Ollama on your own machine, so by default nothing leaves your laptop. You can swap to OpenRouter or any OpenAI-compatible endpoint later if you want.

---

## Why this exists

Daily-journal LLMs tend to validate. They're great at "great work today" and terrible at "you keep saying you want to write more, and you keep saying yes to projects that prevent it."

Synod is a small bet that the more useful pattern is the opposite — quiet agents that hold a single value each, and a compiler whose only job is to point out where those values disagree. No therapy. No compromises. Just the friction.

If that sounds like something you'd want a longer answer to, the bulletins do the answering.

---

## What you actually get

- **Three importers** — pull from a Rosebud export, a folder of free-form notes, or your daily-notes / Journals plugin.
- **Value discovery** — a one-shot extractor proposes the values that already show up in what you write. You confirm the ones that ring true and rewrite the definitions in your own words.
- **Per-value agents** — every confirmed value gets its own agent run with its own system prompt, never seeing the others' output.
- **A compiler** that runs three independent passes (evidentiary gate → tension finder → tension validator) before anything is written to disk.
- **Bulletins in your vault** — plain markdown, one per period, sitting alongside your other notes. Backlinkable, gitable, yours.
- **A status panel** — live phase, progress bar, recent bulletins list, recent log, four big buttons, plus a cancel button while a run is in flight. Nothing hidden in a command palette.
- **Editable prompts** — every agent's system prompt is a markdown file in your vault. Change them; the next run picks it up.
- **Resilient runs** — transient backend hiccups (network blips, HTTP 5xx) are retried automatically with backoff. A run can be cancelled at any cooperative checkpoint. If Obsidian quits mid-run, the next launch surfaces the interrupted state instead of pretending the pipeline is still going.

```diagram
╭─────────────────────╮     ╭──────────────────╮     ╭────────────────╮
│ Import journal      │────▶│ Per-value agent  │────▶│ Compiler       │
│ (Rosebud / folder / │     │ (parallel, fully │     │ (3 passes)     │
│  daily notes)       │     │  isolated)       │     │                │
╰─────────────────────╯     ╰──────────────────╯     ╰────────┬───────╯
                                                              │
                                                              ▼
                                              ╭──────────────────────╮
                                              │ Bulletin (.md in     │
                                              │ vault) + side-panel  │
                                              │ status               │
                                              ╰──────────────────────╯
```

---

## Three steps to your first bulletin

1. Open the Synod side panel from the ribbon icon.
2. **Import journal entries** → pick your source. Re-running an import is safe; duplicates are detected by content hash.
3. **Discover values** → tick the ones that ring true, rewrite the wording, **Confirm**.
4. **Run bulletin cycle** → opens the result in your vault when it's done.

After that, scheduling takes over (defaults to weekly; configurable).

---

## Privacy

Synod does not phone home and does not bundle remote code.

- The default backend is Ollama on `localhost`. Nothing leaves your machine.
- If you choose OpenRouter or llama-swap, the only outbound traffic is to the endpoint you configure.
- Your journal text, value definitions, and bulletins live inside this vault — structured records in `data.json`, human-readable bulletins as plain markdown.

---

## Importers

Pick yours from the *Import journal entries* command (or the **Import** button in the side panel). Each importer remembers its own folder and date-format settings, and the modal opens on whichever you used last.

| Importer            | Source                              | Use when…                          |
|---------------------|-------------------------------------|-------------------------------------|
| `rosebud`           | Rosebud `.md` or `.zip` export      | You're migrating off Rosebud.       |
| `obsidian-folder`   | Any folder of markdown notes        | Your journal is free-form notes.    |
| `obsidian-journal`  | Obsidian Journals / Daily Notes     | Filenames are dates (`YYYY-MM-DD`). |

The Rosebud picker also accepts drag-and-drop. Imports are deduped on the SHA-256 of the normalised user text, so re-running is always safe.

---

## Editable prompts

On first load, Synod writes default prompt files into `<vault>/Synod/_prompts/` (path configurable):

- `value-agent.md` — per-value agent system prompt
- `compiler-finder.md` — Pass 1, the tension finder
- `compiler-validator.md` — Pass 2, the tension validator
- `compiler-report-validator.md` — Pass 0, the evidentiary gate
- `schwartz-extractor.md` — value-discovery prompt

Edit them like any other markdown note. The next run reads the changes. Use `{value_name}` / `{value_definition}` placeholders.

---

## Settings, in one place

Everything sits under **Settings → Community plugins → Synod**:

- **Provider** — Ollama / OpenRouter / llama-swap, with separate models for the *agent* and *compiler* roles, plus a *Test connection* button.
- **Output** — vault root folder, optional value-note and entry-note mirroring.
- **Prompts** — folder location and a *Restore defaults* button.
- **Schedule** — bulletin interval (hours), run-on-startup toggle, minimum-entries floor.
- **Prompt budgets** — character ceilings for the extractor and value-agent calls.
- **Tensions** — severity threshold and escalation cooldown.
- **Active values** — toggle each value on/off or delete it.

---

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

---

## Architecture, in a paragraph each

- **Storage**: JSON via `Plugin.loadData() / saveData()`. No SQLite, no vector DB. Entries fit in context for typical journal sizes; if/when they don't, plug a vector store into `agents/value-agent.ts`.
- **Isolation contract**: `runValueAgent()` takes only one value's `(id, name, definition)` plus the shared corpus. The compiler is the only module that ever sees all reports; its output is never fed back into the agents.
- **LLM single-flight**: `llm/index.ts` funnels generation through one Promise so single-GPU backends don't trample each other when value agents fan out. Hosted backends can lift this gate.
- **Prompt budgeting**: char-based proxy for tokens. Long entries are split into labelled `[date — part k/N]` blocks across LLM calls — never silently truncated.

---

## License

MIT — see `LICENSE`.

Repository: <https://github.com/Slaymish/Synod> · Issues and PRs welcome.
