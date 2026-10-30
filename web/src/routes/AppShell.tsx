/**
 * The app shell: a sticky, frosted top bar (the app's name, tabs as text links on
 * desktop, round action buttons), the page frame, pull to refresh, and the
 * floating tab dock on phones.
 *
 * jimbo-ui reference: an app passes its tabs (five at most), its top-bar
 * actions and its routes as children.
 */

import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { HeaderTitle } from "@/components/HeaderTitle";
import { usePullToRefresh } from "@/lib/gestures";
import { cn } from "@/lib/cn";

export interface ShellTab {
  to: string;
  /** One word. */
  label: string;
  /** The icon's SVG shapes (paths, circles…) on a 24×24 grid; the dock draws the frame. */
  icon: ReactNode;
  /** Other paths that belong to this tab. */
  also?: string[];
}

const WIDTHS = { column: "max-w-5xl", wide: "max-w-7xl", full: "max-w-none" } as const;

export function AppShell({ tabs, actions, onRefresh, width = "column", children }: {
  tabs: ShellTab[];
  /** Page width: the reading column (default), wide (dashboards, galleries) or the full screen. */
  width?: keyof typeof WIDTHS;
  /** Round buttons on the right of the top bar — use TopBarButton. */
  actions?: ReactNode;
  /** Pull to refresh at the top of any page; omit to turn it off. */
  onRefresh?: () => Promise<unknown>;
  children: ReactNode;
}) {
  const location = useLocation();
  const { pull, refreshing } = usePullToRefresh(onRefresh ?? (async () => {}));
  const inTab = (t: ShellTab) =>
    [t.to, ...(t.also ?? [])].some((p) => (p === "/" ? location.pathname === "/" : location.pathname.startsWith(p)));

  return (
    <div className="min-h-full overflow-x-clip">
      {/* Top padding clears the status bar / notch in standalone mode. */}
      <header className="sticky top-0 z-40 border-b border-border bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className={cn("mx-auto flex h-14 items-center justify-between gap-4 px-4 sm:h-16 sm:px-6", WIDTHS[width])}>
          <div className="flex h-full items-center gap-8">
            <Link to="/" aria-label="Home"><HeaderTitle /></Link>
            {/* Desktop: bold links with an accent underline on the active one. */}
            <nav className="hidden h-full items-stretch gap-6 sm:flex">
              {tabs.filter((t) => t.to !== "/").map((t) => (
                <NavLink key={t.to} to={t.to}
                  className={cn(
                    "relative flex items-center text-[15px] font-semibold transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-t after:transition-colors",
                    inTab(t) ? "text-text-base after:bg-accent" : "text-text-muted hover:text-text-base after:bg-transparent",
                  )}>
                  {t.label}
                </NavLink>
              ))}
            </nav>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </header>

      {/* Pull-to-refresh indicator, sliding down from under the top bar. */}
      {onRefresh && (pull > 0 || refreshing) && (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 z-30 flex justify-center"
          style={{ top: `calc(3.5rem + env(safe-area-inset-top) + ${Math.round(Math.min(pull, 1) * 56)}px - 40px)` }}>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface shadow-xl" style={{ opacity: Math.min(pull, 1) }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              className={refreshing ? "animate-spin text-accent" : pull >= 1 ? "text-accent" : "text-text-muted"}
              style={refreshing ? undefined : { transform: `rotate(${pull * 270}deg)` }}>
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
            </svg>
          </div>
        </div>
      )}

      <main className={cn("mx-auto px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8", WIDTHS[width])}>{children}</main>

      {/* Phones: a floating, frosted dock above the home indicator; content fades out behind it. */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-[calc(6rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-bg via-bg/70 to-transparent sm:hidden" />
      <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 select-none px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:hidden">
        <div className="pointer-events-auto mx-auto grid max-w-md gap-1 rounded-[20px] border border-border bg-surface/95 p-1.5 shadow-[0_10px_40px_-8px_rgba(0,0,0,0.75)] ring-1 ring-black/30 backdrop-blur-md"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((t) => {
            const active = inTab(t);
            return (
              <NavLink key={t.to} to={t.to} end={t.to === "/"} aria-current={active ? "page" : undefined}
                onClick={(e) => {
                  // Tapping the tab you're on scrolls back to the top, like a native app.
                  if (location.pathname === t.to) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
                }}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-[14px] transition-[background-color,color,transform] duration-200 active:scale-[0.92]",
                  active ? "bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgb(var(--c-accent)/0.3)]" : "text-text-muted active:bg-white/5",
                )}>
                <DockIcon active={active}>{t.icon}</DockIcon>
                <span className={cn("text-[10.5px] tracking-wide", active ? "font-bold" : "font-semibold")}>{t.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/** A 24 px line icon; active ones get a soft fill, like filled tab-bar symbols on iOS. */
export function DockIcon({ active = false, children }: { active?: boolean; children: ReactNode }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.22 : undefined}
      stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** A 40 px round top-bar button: outlined, or filled with the accent for the main action. */
export function TopBarButton({ label, onClick, primary = false, children }: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  /** An 18 px icon. */
  children: ReactNode;
}) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full transition-[color,border-color,transform] active:scale-95",
        primary ? "lit-accent hover:bg-accent-hover" : "glass text-text-muted hover:border-accent hover:text-text-base",
      )}>
      {children}
    </button>
  );
}
