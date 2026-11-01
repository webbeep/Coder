import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

// Writes gui-experimental.cjs next to server.ts: OpenCode loads a local plugin folder's GUI from there.
export default defineConfig({
  plugins: [gui({ entry: "src/gui.tsx", outFile: "gui-experimental.cjs" })],
  build: { minify: true, sourcemap: false },
})
