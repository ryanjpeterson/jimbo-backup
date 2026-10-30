/**
 * The words and numbers the dashboard shows: how a job's status maps onto
 * jimbo-ui's fixed tones, human times, and grouping.
 */

import type { Job, JobStatus, Schedule } from "./api";
import type { RowStatus } from "@/components/ui/jimbo-kit";

/** jimbo-ui tones: done = accent, in progress = yellow, failed = red, set aside = muted. */
export const STATUS: Record<JobStatus, RowStatus> = {
  success: { tone: "accent", label: "Backed up" },
  running: { tone: "yellow", label: "Running" },
  failed: { tone: "red", label: "Failed" },
  skipped: { tone: "muted", label: "Skipped" },
  never: { tone: "muted", label: "Never run" },
};

/**
 * An old copy is only a problem for a scheduled job on a drive that should
 * always be there: a removable drive comes and goes, and a manual-only job
 * runs when someone presses the button.
 */
export function staleMatters(job: Job): boolean {
  return job.stale && job.scheduled && !job.removable;
}

/** Needs a look: failed, can't run as written, or a copy that's too old when it shouldn't be. */
export function needsLook(job: Job): boolean {
  return job.status === "failed" || !!job.error || staleMatters(job);
}

/** "14h ago", "9d ago". */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** 0 → "under a second", 760 → "12m 40s", 5400 → "1h 30m". */
export function duration(sec: number | null): string {
  if (sec == null) return "";
  if (sec < 1) return "under a second";
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}h ${m}m` : `${m}m ${s}s`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Mirrors describe() in scripts/scheduler.sh — keep the two in step. */
export function describeSchedule({ interval, time, day }: Schedule): string {
  if (interval === "off") return "off — manual only";
  if (interval === "hourly") return "every hour";
  if (interval === "daily") return `daily at ${time}`;
  if (interval === "weekly") return `${day}s at ${time}`;
  let m = /^(\d+)h$/.exec(interval);
  if (m) return `every ${m[1]} hours`;
  m = /^(\d+)d$/.exec(interval);
  if (m) return `every ${m[1]} days at ${time}`;
  return `unrecognised (“${interval}”)`;
}

export interface RunInfo {
  /** The job id the log belongs to. */
  id: string;
  /** "2026-09-30" */
  date: string;
  /** Local start time as written in the name, "16:34". */
  time: string;
}

/** backup.sh names its logs <job-id>_<YYYY-MM-DD>_<HH-MM-SS>.log. */
export function parseLogName(name: string): RunInfo | null {
  const m = /^(.+)_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-\d{2}\.log$/.exec(name);
  if (!m) return null;
  return { id: m[1]!, date: m[2]!, time: `${m[3]}:${m[4]}` };
}

/** "Music → internal-backup": a job's name and where it goes. */
export function jobTitle(job: Pick<Job, "name" | "destVolume" | "dest">): string {
  const to = job.destVolume?.name ?? job.dest;
  return to ? `${job.name} → ${to}` : job.name;
}

/** A run's title from its log name, using the job list when the job still exists. */
export function runTitleFor(logName: string, jobs: Job[]): string {
  const info = parseLogName(logName);
  if (!info) return logName;
  const job = jobs.find((j) => j.id === info.id);
  return job ? jobTitle(job) : info.id.replace(/[_-]+/g, " ");
}

/** Jobs grouped by the volume they back up to, in job order. */
export function byDestination(jobs: Job[]): { key: string; volume: Job["destVolume"]; jobs: Job[] }[] {
  const groups: { key: string; volume: Job["destVolume"]; jobs: Job[] }[] = [];
  for (const job of jobs) {
    const key = job.destVolume?.name ?? "Other locations";
    const g = groups.find((x) => x.key === key);
    if (g) g.jobs.push(job);
    else groups.push({ key, volume: job.destVolume, jobs: [job] });
  }
  return groups;
}
