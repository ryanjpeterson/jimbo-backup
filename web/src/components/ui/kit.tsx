/**
 * This app's kit: everything from jimbo-ui's reference kit (jimbo-kit.tsx, an
 * exact copy — update it by copying), plus jimbo-backup's own pieces built
 * from the same tokens: volume chips, backup rows, run rows and the log sheet.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Job, type LogEntry } from "@/lib/api";
import { ago, bytes, clock, duration, parseLogName, staleMatters, STATUS } from "@/lib/backups";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Chevron, DateBlock, Sheet, STATUS_DOT, TONES } from "./jimbo-kit";

export * from "./jimbo-kit";

/**
 * A running job's dot also pulses. Done uses the theme's accent, and when the
 * accent is yellow, a done dot and a running dot would be the same colour —
 * movement keeps them apart in every theme.
 */
export const RUNNING = "animate-pulse";

// ─────────────────────────────────────────────────────────────────────────────
// Volumes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether a volume is mounted. "Detected" means it's listed in the volumes
 * directory; backup.sh checks the actual folders right before anything is
 * copied, so the dashboard never has to touch the disk.
 */
export function VolumeChip({ detected, label }: { detected: boolean; label?: string }) {
  return (
    <span className={cn("chip py-1 text-xs", detected ? TONES.accent.chip : "")}>
      <span aria-hidden="true" className={cn(STATUS_DOT, detected ? TONES.accent.dot : TONES.muted.dot)} />
      {label ?? (detected ? "Detected" : "Not detected")}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup rows — one job
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What happened last time, and when the last good copy was made. These are two
 * different runs, so they get two lines: a failed run takes no time, and that
 * says nothing about how old the backup is.
 */
function lastRunLine(job: Job, now: number): { text: string; alert: boolean } {
  if (job.error) return { text: `Can't run: ${job.error}`, alert: true };
  switch (job.status) {
    case "success":
      return { text: `Backed up ${ago(job.lastEnd, now)}${job.durationSec != null ? ` · took ${duration(job.durationSec)}` : ""}`, alert: false };
    case "running":
      return { text: `Running since ${job.lastStart ? clock(job.lastStart) : "just now"}`, alert: false };
    case "failed":
      return { text: `Failed ${ago(job.lastEnd, now)}${job.message ? `: ${job.message}` : ""}`, alert: true };
    case "skipped":
      return { text: `Skipped ${ago(job.lastEnd, now)}${job.message ? `: ${job.message}` : ""}`, alert: false };
    default:
      return { text: "Never run", alert: false };
  }
}

/** Where a job copies from, kept short: the volume name, or the path outside the volumes directory. */
function fromLabel(job: Job): string {
  if (job.sourceVolume) return `from ${job.sourceVolume.name}`;
  return job.source ? `from ${job.source}` : "";
}

export function BackupRow({ job, now, disabledReason, busy = false, starting, error, onRun, onOpenLog }: {
  job: Job;
  now: number;
  /** Why the button is off for this job (a volume missing), shown under the row; or null. */
  disabledReason: string | null;
  /** Off without a note — another backup is running, and the page says so once. */
  busy?: boolean;
  starting: boolean;
  /** The last start attempt's error, shown inline under the row. */
  error: string | null;
  onRun: () => void;
  onOpenLog: (() => void) | null;
}) {
  const status = job.error ? STATUS.failed : STATUS[job.status];
  const last = lastRunLine(job, now);
  // The age of the last good copy matters most when the last run wasn't one.
  const showGood = !job.error && (job.status !== "success" || job.stale);

  const body = (
    <>
      <span title={status.label} aria-label={status.label}
        className={cn(STATUS_DOT, TONES[status.tone].dot, job.status === "running" && RUNNING)} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-text-base group-hover:text-accent sm:text-base">
          {job.name}
          <span className="ml-1.5 text-xs font-medium text-text-subtle">{fromLabel(job)}</span>
        </span>
        <span className={cn("mt-0.5 block text-sm", last.alert ? "text-highlight" : "text-text-muted")}>{last.text}</span>
        {showGood && (
          <span className={cn("mt-0.5 block text-xs", staleMatters(job) ? "font-semibold text-highlight" : "text-text-subtle")}>
            {job.lastSuccess ? `Last good copy ${ago(job.lastSuccess, now)}` : "No good copy yet"}
            {staleMatters(job) && job.lastSuccess ? " · stale" : ""}
          </span>
        )}
      </span>
    </>
  );

  // An <article>, not a <div>: jimbo-ui's divide-etched also rules lines
  // between the children of any <div> row (meant for grouped lists).
  return (
    <article className="px-4 py-3.5">
      <div className="flex min-h-[48px] items-center gap-3 sm:gap-4">
        {onOpenLog ? (
          <button type="button" onClick={onOpenLog} aria-label={`${job.name}: ${status.label}. Open the last log`}
            className="group flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-4">
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">{body}</div>
        )}
        <Button size="sm" variant="secondary" onClick={onRun} disabled={!!disabledReason || busy || starting || !!job.error}
          title={disabledReason ?? (busy ? "Another backup is running" : undefined)} className="shrink-0">
          {starting ? "Starting…" : "Back up"}
        </Button>
      </div>
      {(error || disabledReason) && (
        <p role={error ? "alert" : undefined}
          className={cn("mt-2 pl-[22px] text-sm sm:pl-[26px]", error ? "text-highlight" : "text-text-subtle")}>
          {error ?? disabledReason}
        </p>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Runs — one log file per job run
// ─────────────────────────────────────────────────────────────────────────────

/** A run in the history: its date as a ticket, which backup, when it started. */
export function RunRow({ log, title, running, onOpen }: { log: LogEntry; title: string; running: boolean; onOpen: () => void }) {
  const info = parseLogName(log.name);
  const date = info?.date ?? log.mtime.slice(0, 10);
  return (
    <button type="button" onClick={onOpen}
      className="group flex min-h-[76px] w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/70 active:bg-surface-2 sm:gap-4">
      <DateBlock date={date} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-text-base group-hover:text-accent sm:text-base">{title}</span>
        <span className="mt-0.5 block truncate text-sm text-text-muted">
          {running ? "Running now" : `Started ${clock(info ? `${info.date}T${info.time}:00` : log.mtime)}`} · {bytes(log.size)}
        </span>
      </span>
      {running && <span title="Running" aria-label="Running" className={cn(STATUS_DOT, TONES.yellow.dot, RUNNING)} />}
      <Chevron className="text-text-subtle group-hover:text-accent" />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Log sheet
// ─────────────────────────────────────────────────────────────────────────────

/** A run's log in the one modal. A running log follows along as it's written. */
export function LogSheet({ file, title, live, onClose }: { file: string; title: string; live: boolean; onClose: () => void }) {
  const info = parseLogName(file);
  const q = useQuery({
    queryKey: ["log", file],
    queryFn: () => api.getLog(file),
    refetchInterval: live ? 2000 : false,
  });
  const end = useRef<HTMLDivElement>(null);

  // Open at the end, where the outcome is — and stay there while it grows.
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [q.data?.text]);

  return (
    <Sheet wide onClose={onClose} title={title}
      subtitle={<>{info ? `${info.date} at ${info.time}` : file}{live && <span className="text-yellow-400"> · running</span>}</>}>
      <div className="p-4 sm:p-5">
        {q.isLoading ? (
          <p className="meta animate-pulse">Loading the log…</p>
        ) : q.isError ? (
          <p className="text-sm text-highlight">Couldn't read this log. It may have been pruned.</p>
        ) : (
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-bg-deep/80 p-3 font-mono text-[12px] leading-relaxed text-text-muted">
            {q.data?.text || "Empty so far."}
          </pre>
        )}
        <div ref={end} />
      </div>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small layout piece
// ─────────────────────────────────────────────────────────────────────────────

/** A label and a value on one line, for read-only settings. (A <p>, not a <div>: see BackupRow.) */
export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <p className="flex min-h-[56px] items-center justify-between gap-4 px-4 py-3">
      <span className="text-[15px] font-semibold text-text-base">{label}</span>
      <span className="min-w-0 text-right text-sm text-text-muted">{children}</span>
    </p>
  );
}
