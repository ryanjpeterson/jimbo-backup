/**
 * Settings — what the container is set up to do (read-only: the schedule
 * lives in .env and the backups in jobs/), every mounted volume, and the way
 * into the look.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { describeSchedule } from "@/lib/backups";
import { Badge, KeyValue, LinkCard, Loading, PageHeader, Section, VolumeChip } from "@/components/ui/kit";

export function SettingsPage() {
  const q = useQuery({ queryKey: ["status"], queryFn: api.getStatus, refetchInterval: 10_000 });
  const s = q.data;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Settings" title="How it runs" />

      {q.isLoading || !s ? (
        <Loading label="Reading the settings…" />
      ) : (
        <>
          <Section title="Schedule" flush>
            <div className="divide-etched">
              <KeyValue label="Scheduled backups">{describeSchedule(s.schedule)}</KeyValue>
              <KeyValue label="Stale after">{s.staleWarnHours} hours</KeyValue>
            </div>
          </Section>

          <Section title="Backups" count={s.jobs.length} flush>
            {s.jobs.length === 0 ? (
              <p className="p-4 text-sm text-text-muted">None yet. Add a file to <code className="font-mono text-[12px]">jobs/</code>.</p>
            ) : (
              <div className="divide-etched">
                {s.jobs.map((job) => (
                  <article key={job.id} className="space-y-1.5 px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{job.name}</span>
                      <span className="font-mono text-[12px] text-text-subtle">{job.file}</span>
                      {job.removable && <Badge tone="muted">Removable</Badge>}
                      {!job.scheduled && <Badge tone="muted">Manual only</Badge>}
                      {job.hasHook && <Badge tone="purple">Runs a hook</Badge>}
                      {job.error && <Badge tone="red">Can't run</Badge>}
                    </div>
                    <p className="break-all font-mono text-[12px] leading-relaxed text-text-muted">
                      {job.source || "(no JOB_SOURCE)"}<br />→ {job.dest || "(no JOB_DEST)"}
                    </p>
                    {job.error && <p className="text-sm text-highlight">{job.error}</p>}
                  </article>
                ))}
              </div>
            )}
          </Section>

          <Section title="Mounted volumes" count={s.volumes.length} flush>
            {s.volumes.length === 0 ? (
              <p className="p-4 text-sm text-text-muted">
                Nothing found in <code className="font-mono text-[12px]">{s.volumesDir}</code>. Is it shared with Docker?
              </p>
            ) : (
              <div className="divide-etched">
                {s.volumes.map((v) => (
                  <KeyValue key={v.name} label={<span className="font-mono text-[13px]">{v.name}</span>}>
                    <VolumeChip detected={v.used} label={v.used ? "Used by a backup" : "Not used"} />
                  </KeyValue>
                ))}
              </div>
            )}
          </Section>

          <p className="meta px-0.5">
            The schedule comes from <code className="font-mono text-[12px]">.env</code> (change it, then{" "}
            <code className="font-mono text-[12px]">docker compose up -d</code>). Backups are the files in{" "}
            <code className="font-mono text-[12px]">jobs/</code>, read fresh every time — no restart needed.
          </p>
        </>
      )}

      <div className="space-y-3">
        <LinkCard to="/admin/brand" eyebrow="Look" title="Brand & theme" sub="Pick the colours — everyone sees the change" accent />
        <LinkCard to="/admin/style" eyebrow="Reference" title="Style guide" sub="Every component in the current colours" />
      </div>
    </div>
  );
}
