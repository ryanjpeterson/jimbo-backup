/**
 * The dashboard's API client. The server (app/server.js) only ever reads
 * state that backup.sh writes and the job list, plus starting a run; nothing
 * here can change a backup except POST /api/backup.
 */

import type { SavedTheme, Theme } from "./theme";

export type JobStatus = "success" | "failed" | "skipped" | "running" | "never";

/** A volume a job's folder lives on, and whether it's mounted right now. Null for paths outside the volumes directory. */
export interface VolumeRef {
  name: string;
  detected: boolean;
}

/** One backup: a job file in jobs/, plus what happened last time it ran. */
export interface Job {
  id: string;
  file: string;
  name: string;
  /** Host paths, as written in the job file. */
  source: string;
  dest: string;
  /** A drive that comes and goes: missing means skipped, not failed. */
  removable: boolean;
  /** False for JOB_SCHEDULE=manual. */
  scheduled: boolean;
  hasHook: boolean;
  /** Set when the job file can't be used as written. */
  error: string | null;
  status: JobStatus;
  lastStart: string | null;
  lastEnd: string | null;
  lastSuccess: string | null;
  /** How long the most recent run took — not the last successful one. */
  durationSec: number | null;
  message: string;
  logFile: string | null;
  stale: boolean;
  sourceVolume: VolumeRef | null;
  destVolume: VolumeRef | null;
}

export interface Schedule {
  interval: string;
  time: string;
  day: string;
}

export interface Running {
  pid: number;
  /** Job id, or "scheduled" / "all" before the first job starts. */
  job: string;
  title: string;
  started: string;
  logFile: string;
}

export interface Status {
  now: string;
  schedule: Schedule;
  staleWarnHours: number;
  volumesDir: string;
  /** Everything mounted in the volumes directory. */
  volumes: { name: string; used: boolean }[];
  running: Running | null;
  jobs: Job[];
  jobsError: string | null;
}

export interface LogEntry {
  name: string;
  size: number;
  mtime: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body;
}

export const api = {
  getStatus: () => request<Status>("/api/status"),
  getLogs: () => request<{ logs: LogEntry[] }>("/api/logs").then((r) => r.logs),
  /** A run's log, or "current" for whatever is running now. Long logs come back tail-truncated. */
  getLog: (file: string) => request<{ name: string | null; text: string }>(`/api/log?file=${encodeURIComponent(file)}`),
  startBackup: (job: string) =>
    request<{ started: string }>("/api/backup", { method: "POST", body: JSON.stringify({ job }) }),

  // Theme (jimbo-ui's server contract). Stored next to state.json on the logs volume.
  getTheme: () => request<{ theme: SavedTheme | null; faviconUrl: string | null }>("/api/public/theme"),
  setTheme: (theme: Theme) => request<{ ok: true }>("/api/admin/theme", { method: "PUT", body: JSON.stringify(theme) }),
  resetTheme: () => request<{ ok: true }>("/api/admin/theme", { method: "DELETE" }),
};
