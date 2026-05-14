/* Importer registry. A new importer is a single async function that takes
 * an opaque source descriptor and returns RawEntry[]. The plugin shell
 * dispatches based on `kind`.
 *
 * Two source shapes are supported:
 *   - File contents (Rosebud .md/.zip pasted via "Import file" command)
 *   - Vault folder (any folder of markdown notes — Obsidian Folder /
 *                   Obsidian Journals format)
 */

import type { App } from "obsidian";

import type { ImporterKind } from "../settings";
import type { RawEntry } from "../ingestion/types";
import { parseRosebud } from "./rosebud";
import { importObsidianFolder } from "./obsidian-folder";
import { importObsidianJournal } from "./obsidian-journal";

export interface FileSource {
  kind: "file";
  filename: string;
  bytes: ArrayBuffer;
}

export interface FolderSource {
  kind: "folder";
  folder: string;          // vault-relative
  dateFormat?: string;     // for journal-style imports
}

export type ImportSource = FileSource | FolderSource;

/** Dispatch to the right parser. Throws on unknown combinations. */
export async function runImport(
  app: App,
  importer: ImporterKind,
  source: ImportSource,
): Promise<RawEntry[]> {
  if (importer === "rosebud") {
    if (source.kind !== "file") {
      throw new Error("Rosebud importer expects a .md or .zip file.");
    }
    return parseRosebud(source.filename, source.bytes);
  }
  if (importer === "obsidian-folder") {
    if (source.kind !== "folder") {
      throw new Error("Obsidian-folder importer expects a vault folder.");
    }
    return importObsidianFolder(app, source.folder);
  }
  if (importer === "obsidian-journal") {
    if (source.kind !== "folder") {
      throw new Error("Obsidian-journal importer expects a vault folder.");
    }
    return importObsidianJournal(app, source.folder, source.dateFormat ?? "YYYY-MM-DD");
  }
  // exhaustiveness — should be unreachable
  throw new Error(`Unknown importer: ${importer as string}`);
}
