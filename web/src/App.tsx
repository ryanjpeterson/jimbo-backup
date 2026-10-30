import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell, type ShellTab } from "@/routes/AppShell";
import { HomePage } from "@/routes/HomePage";
import { RunsPage } from "@/routes/RunsPage";
import { SettingsPage } from "@/routes/SettingsPage";
import { JimboConfigPage } from "@/routes/JimboConfigPage";
import { useApplyBrand } from "@/lib/useBrand";

const queryClient = new QueryClient({
  defaultOptions: {
    // Polling stops while the tab is in the background (react-query's default),
    // so nothing asks the server about the drives when nobody is looking.
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

const TABS: ShellTab[] = [
  { to: "/", label: "Home", icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /> },
  { to: "/runs", label: "Runs", icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> },
  {
    to: "/settings",
    label: "Settings",
    also: ["/jimbo-ui"],
    icon: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  },
];

function Shell() {
  useApplyBrand();
  const qc = useQueryClient();
  return (
    <AppShell tabs={TABS} onRefresh={() => qc.invalidateQueries()}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* No accounts in this app (jimbo-ui.json: "auth": "none"), so anyone using it can configure the look. */}
        <Route path="/jimbo-ui" element={<JimboConfigPage canConfigure />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
