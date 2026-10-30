/**
 * Home — every backup job, grouped by the volume it copies to, with how each
 * one is doing and a button to run it now.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Job, type Status } from "@/lib/api";
import { byDestination, clock, describeSchedule, jobTitle, needsLook } from "@/lib/backups";
import { Button } from "@/components/ui/button";
import { BackupRow, EmptyState, Loading, LogSheet, PageHeader, RUNNING, Section, STATUS_DOT, TONES, VolumeChip } from "@/components/ui/kit";
import { cn } from "@/lib/cn";

/** Why a job can't be started right now, or null. */
function blockedBecause(job: Job): string | null {
  if (job.error) return null; // the row already says why
  if (job.destVolume && !job.destVolume.detected) {
    return job.removable ? `Plug in ${job.destVolume.name} to back up to it.` : `${job.destVolume.name} isn't mounted.`;
  }
  if (job.sourceVolume && !job.sourceVolume.detected) return `${job.sourceVolume.name} isn't mounted.`;
  return null;
}

export function HomePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["status"], queryFn: api.getStatus, refetchInterval: 3000 });
  const [log, setLog] = useState<{ file: string; title: string; live: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const run = useMutation({
    mutationFn: (id: string) => api.startBackup(id),
    onMutate: (id) => setErrors((e) => ({ ...e, [id]: undefined })),
    onError: (err, id) => setErrors((e) => ({ ...e, [id]: err.message })),
    // backup.sh takes a moment to write its lock; ask again shortly so the buttons lock too.
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["status"] }); setTimeout(() => void qc.invalidateQueries({ queryKey: ["status"] }), 800); },
  });

  if (q.isLoading) return <Loading label="Checking the backups…" />;
  if (q.isError || !q.data) {
    return (
      <EmptyState tone="error" title="Can't reach the backup service"
        body="The dashboard is up but its API didn't answer. Check the container with docker compose logs."
        action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>Try again</Button>} />
    );
  }

  const s = q.data;
  const now = new Date(s.now).getTime();

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Status" title="Backups" />
      <div className="-mt-3 space-y-1">
        <Verdict status={s} />
        <p className="meta">Scheduled backups run {describeSchedule(s.schedule)}.</p>
      </div>

      {s.running && (
        <div className="card-glass flex items-center gap-3 p-4">
          <span aria-hidden="true" className={cn(STATUS_DOT, TONES.yellow.dot, RUNNING)} />
          <p className="min-w-0 flex-1 text-[15px]">
            <span className="font-semibold">{s.running.title}</span>
            <span className="meta block">Running since {clock(s.running.started)}</span>
          </p>
          {s.running.logFile && (
            <Button size="sm" variant="secondary"
              onClick={() => setLog({ file: s.running!.logFile, title: s.running!.title, live: true })}>Watch</Button>
          )}
        </div>
      )}

      {s.jobsError ? (
        <EmptyState tone="error" title="Can't read the backup jobs" body={s.jobsError} />
      ) : s.jobs.length === 0 ? (
        <EmptyState title="No backups set up yet"
          body="Each backup is a small file in the jobs folder naming a source and a backup location. Copy jobs/example.sh.disabled to get started; jobs/README.md has the details." />
      ) : (
        byDestination(s.jobs).map((g) => (
          <Section key={g.key} title={g.key} flush
            action={g.volume ? <VolumeChip detected={g.volume.detected} /> : undefined}>
            <div className="divide-etched">
              {g.jobs.map((job) => {
                const live = job.status === "running" && s.running?.logFile === job.logFile;
                const reason = blockedBecause(job);
                return (
                  <BackupRow key={job.id} job={job} now={now}
                    disabledReason={reason} busy={!!s.running}
                    starting={run.isPending && run.variables === job.id}
                    error={errors[job.id] ?? null}
                    onRun={() => run.mutate(job.id)}
                    onOpenLog={job.logFile ? () => setLog({ file: job.logFile!, title: jobTitle(job), live }) : null} />
                );
              })}
            </div>
          </Section>
        ))
      )}

      {log && <LogSheet file={log.file} title={log.title} live={log.live} onClose={() => setLog(null)} />}
    </div>
  );
}

/** One line that answers "are my backups fine?" before the details. */
function Verdict({ status }: { status: Status }) {
  const jobs = status.jobs;
  if (jobs.length === 0) return null;
  const trouble = jobs.filter(needsLook);
  if (trouble.length === 0) {
    const fresh = jobs.filter((j) => !j.stale).length;
    return (
      <p className="text-[15px] font-semibold text-accent">
        {fresh === jobs.length ? "Every backup is fresh." : "Nothing's failing."}
      </p>
    );
  }
  return (
    <p className="text-[15px] font-semibold text-highlight">
      {trouble.length === 1 ? "One backup needs a look." : `${trouble.length} backups need a look.`}
    </p>
  );
}
