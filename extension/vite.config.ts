import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    // Vite's default modulepreload injects <link rel="modulepreload" crossorigin> tags. In MV3
    // extension pages this trips a real Chrome bug — "cross-world extension resource mismatch" —
    // on some Stable Chrome installs (reported by users here, same error also hit MetaMask:
    // https://github.com/MetaMask/metamask-extension/issues/44792). The entry script still fetches
    // its chunks fine via native ES `import` at runtime; modulepreload was a pure perf hint we don't
    // need for a small local side-panel bundle, so disabling it removes the tag entirely.
    modulePreload: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
})
