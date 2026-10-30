/**
 * This app's brand settings — the only theme values that differ between apps
 * built on jimbo-ui. Owned by the app: jimbo-ui updates never overwrite it.
 */

import type { Theme } from "./theme";

export const BRAND = {
  /** The app's name — the header text in the top bar; a dot in it takes the accent ("jimbo.ui"). */
  name: "jimbo.backup",
  /** The look before anyone changes it: jimbo-ui's Deep sea template (teal, coral, periwinkle).
   *  Keep src/styles/tokens.css in step (jimbo-ui: scripts/tokens.mjs). */
  defaultTheme: { accent: "#3DFFC5", highlight: "#FF7A59", background: "#071A1F", support: "#9BB0FF" } satisfies Theme,
  /** localStorage key prefix; index.html's pre-paint script reads `<prefix>.themeVars`. */
  storagePrefix: "jimbobackup",
};
