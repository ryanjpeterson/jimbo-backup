import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts: the weights the guide uses (Archivo 500–900, Inter 400–700,
// JetBrains Mono 400/600), bundled so nothing is fetched from the internet.
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/archivo/800.css";
import "@fontsource/archivo/900.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./styles/globals.css";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element.");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
