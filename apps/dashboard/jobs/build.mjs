import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

// Platform spec - Scheduled job (unit SYNC2): one self-contained bundle,
// built with the `react-server` condition so `server-only` resolves to an
// empty module (no alias; V14). "@" is the dashboard root.
const dashboard = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(dashboard, "jobs/sync-litellm-users.ts")],
  outfile: join(dashboard, "jobs/sync-litellm-users.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  conditions: ["react-server"],
  alias: { "@": dashboard },
  // `import.meta.url` is empty in a cjs bundle. The one reader, the app-config
  // loader, resolves `../../config/config.yaml` from `lib/config/`, so point it
  // at that folder relative to the bundle in `jobs/`.
  define: { "import.meta.url": "__bundleModuleUrl" },
  banner: {
    js: 'const __bundleModuleUrl = require("node:url").pathToFileURL(require("node:path").join(__dirname, "../lib/config/app-config.js")).href;',
  },
  logLevel: "warning",
});
