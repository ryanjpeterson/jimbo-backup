/**
 * jimbo-ui config — /jimbo-ui
 *
 * The one place for every brand, theme and style guide option, the same in
 * every app: Theme, Brand, Style guide, About, and an optional App tab for the
 * app's own additions. Reached from the app's settings or admin area, never a
 * dock tab. The app passes `canConfigure`: its admin check when it has auth
 * (the server checks admin on every save too), or `true` when it has none.
 * Without it the section redirects home and its link doesn't render.
 *
 * All panels stay mounted so an unsaved look follows you from Theme into the
 * Style guide; the save bar floats over every tab.
 *
 * jimbo-ui reference, adapted: no favicon upload (the built-in favicon follows
 * the theme), so the Brand tab is the name only.
 */

import type { ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { BRAND } from "@/lib/brand.config";
import { JIMBO_APP, JIMBO_UI } from "@/lib/jimbo";
import { HeaderTitle } from "@/components/HeaderTitle";
import { LinkCard, PageHeader, PillTabs } from "@/components/ui/kit";
import { ThemePanel } from "./config/ThemePanel";
import { StyleGuidePanel } from "./config/StyleGuidePanel";

type Tab = "theme" | "brand" | "style" | "about" | "app";

export function JimboConfigPage({ canConfigure, app }: { canConfigure: boolean; app?: { label?: string; content: ReactNode } }) {
  const [params, setParams] = useSearchParams();
  if (!canConfigure) return <Navigate to="/" replace />;
  const tabs: { value: Tab; label: string }[] = [
    { value: "theme", label: "Theme" }, { value: "brand", label: "Brand" }, { value: "style", label: "Style guide" }, { value: "about", label: "About" },
    ...(app ? [{ value: "app" as const, label: app.label ?? "App" }] : []),
  ];
  const tab = (tabs.find((t) => t.value === params.get("tab"))?.value ?? "theme") as Tab;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Settings" title="jimbo-ui config" />
      <PillTabs value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} options={tabs} />
      <div hidden={tab !== "theme"}><ThemePanel /></div>
      <div hidden={tab !== "brand"}><BrandPanel /></div>
      <div hidden={tab !== "style"}><StyleGuidePanel /></div>
      <div hidden={tab !== "about"}><AboutPanel /></div>
      {app && <div hidden={tab !== "app"}>{app.content}</div>}
    </div>
  );
}

/** The entry in the app's settings or admin area; renders nothing for people who can't configure. */
export function JimboConfigLink({ canConfigure }: { canConfigure: boolean }) {
  if (!canConfigure) return null;
  return <LinkCard to="/jimbo-ui" eyebrow="Look" title="jimbo-ui config" sub="Theme, brand and style guide" />;
}

function BrandPanel() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="px-0.5">
          <h2 className="h-section">Name</h2>
          <p className="meta mt-1">The brand is the app's name as header text; a dot takes the accent. Set in <code>brand.config.ts</code>.</p>
        </div>
        <div className="card space-y-4 p-5">
          {(["sm", "md", "lg"] as const).map((s) => <div key={s}><HeaderTitle size={s} /></div>)}
          <p className="meta">{BRAND.name}</p>
        </div>
      </section>
    </div>
  );
}

function AboutPanel() {
  const a = JIMBO_APP;
  const behind = a?.version && a.version !== JIMBO_UI.version;
  const local = a?.components?.local ?? [];
  const rows: [string, ReactNode][] = [
    ["jimbo-ui", `${JIMBO_UI.version}${behind ? ` (jimbo-ui.json says ${a!.version})` : ""}`],
    ["Access", a?.auth === "admin" ? "Admins only" : a?.auth === "none" ? "Anyone using the app" : "—"],
    ["Registered", a?.registry?.registered ?? "Not in the registry yet"],
    ["Last audited", a?.registry?.audited ?? "—"],
    ["Kit components used", a?.components?.uses?.length ?? "—"],
    ["Own components", a ? `${local.filter((l) => l.kind === "domain").length} domain, ${local.filter((l) => l.kind === "candidate").length} candidates` : "—"],
  ];
  return (
    <div className="space-y-4">
      <div className="card divide-y divide-border">
        {rows.map(([k, v]) => (
          <p key={k} className="flex min-h-[56px] items-center justify-between gap-4 px-4 py-3">
            <span className="text-[15px] font-semibold">{k}</span><span className="text-right text-sm text-text-muted">{v}</span>
          </p>
        ))}
      </div>
      <a href={JIMBO_UI.showcase} target="_blank" rel="noreferrer" className="card flex items-center justify-between gap-3 p-4 hover:border-accent">
        <span><span className="eyebrow block">Showcase</span><span className="mt-0.5 block text-[15px] font-semibold">See this release in action</span></span>
        <span className="text-text-subtle">›</span>
      </a>
    </div>
  );
}
