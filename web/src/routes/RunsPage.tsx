/**
 * Runs — every run's log, newest first, grouped by day. Logs are pruned after
 * LOG_RETENTION_DAYS, so this is the last month or so.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type LogEntry } from "@/lib/api";
import { jobTitle, parseLogName, runTitleFor } from "@/lib/backups";
import { Button } from "@/components/ui/button";
import { EmptyState, List, ListGroupLabel, Loading, LogSheet, PageHeader, RunRow, SelectField } from "@/components/ui/kit";

/** "Today", "Yesterday", "Mon, Sep 28". */
function dayLabel(date: string, today: Date): string {
  const d = new Date(`${date}T00:00:00`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function RunsPage() {
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const logs = useQuery({ queryKey: ["logs"], queryFn: api.getLogs, refetchInterval: 15_000 });
  // For job names, and to know which log is still being written.
  const status = useQuery({ queryKey: ["status"], queryFn: api.getStatus, refetchInterval: 3000 });
  const jobs = status.data?.jobs ?? [];
  const runningLog = status.data?.running?.logFile ?? null;

  const groups = useMemo(() => {
    const today = new Date();
    const out: { label: string; logs: LogEntry[] }[] = [];
    for (const log of logs.data ?? []) {
      const info = parseLogName(log.name);
      if (filter !== "all" && info?.id !== filter) continue;
      const label = dayLabel(info?.date ?? log.mtime.slice(0, 10), today);
      const last = out[out.length - 1];
      if (last?.label === label) last.logs.push(log);
      else out.push({ label, logs: [log] });
    }
    return out;
  }, [logs.data, filter]);

  const count = groups.reduce((n, g) => n + g.logs.length, 0);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="History" title="Runs" count={count} />
      {jobs.length > 1 && (
        <SelectField label="Show runs for" value={filter} onChange={setFilter}
          options={[{ value: "all", label: "Every backup" }, ...jobs.map((j) => ({ value: j.id, label: jobTitle(j) }))]} />
      )}

      {logs.isLoading ? (
        <Loading label="Reading the logs…" />
      ) : logs.isError ? (
        <EmptyState tone="error" title="Can't read the logs"
          body="The backup service didn't answer."
          action={<Button size="sm" variant="secondary" onClick={() => void logs.refetch()}>Try again</Button>} />
      ) : count === 0 ? (
        <EmptyState title="No runs here yet"
          body={filter === "all" ? "Each run writes a log. The first one shows up after the next scheduled run, or press Back up on Home." : "This backup hasn't run in the last month."} />
      ) : (
        <List>
          {groups.map((g) => (
            <div key={g.label}>
              <ListGroupLabel>{g.label}</ListGroupLabel>
              {g.logs.map((log) => (
                <RunRow key={log.name} log={log} title={runTitleFor(log.name, jobs)} running={log.name === runningLog} onOpen={() => setOpen(log.name)} />
              ))}
            </div>
          ))}
        </List>
      )}

      {open && <LogSheet file={open} title={runTitleFor(open, jobs)} live={open === runningLog} onClose={() => setOpen(null)} />}
    </div>
  );
}
