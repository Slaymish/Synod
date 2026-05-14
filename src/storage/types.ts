/* Persisted records — mirrors the SQLite schema used by the Python service,
 * but flattened to JSON so it sits inside Obsidian's plugin data directory.
 */

import type { Entry } from "../ingestion/types";
import type { DecisionPacket, ValueReport } from "../agents/types";

export interface Value {
  id: string;
  name: string;
  definition: string;
  schwartz_anchor: string | null;
  confirmed_at: string | null;
  active: boolean;
  /** True once the user has personalised the definition in their own words. */
  definition_personalised: boolean;
  version: number;
}

export interface StoredValueReport {
  id: string;          // `${value_id}_${period_end}`
  value_id: string;
  period_start: string;
  period_end: string;
  report: ValueReport;
  generated_at: string;
  model_used: string;
}

export interface StoredDecisionPacket {
  id: string;
  period_start: string;
  period_end: string;
  packet: DecisionPacket;
  delivered_at: string | null;
}

export interface DataFile {
  schemaVersion: 1;
  entries: Record<string, Entry>;        // by id
  values: Record<string, Value>;          // by id
  reports: StoredValueReport[];
  packets: StoredDecisionPacket[];
  /** Last time each scheduler job ran. */
  lastRun: Record<string, string>;
  /** UI / pipeline state — last known status for the status view. */
  status: PipelineStatus;
}

export interface PipelineStatus {
  phase: "idle" | "ingesting" | "extracting" | "agents" | "compiling" | "writing" | "done" | "error";
  detail: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: { current: number; total: number } | null;
  error: string | null;
}

export const EMPTY_DATA: DataFile = {
  schemaVersion: 1,
  entries: {},
  values: {},
  reports: [],
  packets: [],
  lastRun: {},
  status: {
    phase: "idle",
    detail: "Never run.",
    startedAt: null,
    finishedAt: null,
    progress: null,
    error: null,
  },
};
