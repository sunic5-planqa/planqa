import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

const dir = path.dirname(fileURLToPath(import.meta.url))

// Pins the extension's id across dev reloads/rebuilds — see scripts/generate-dev-key.mjs.
// Not the Chrome Web Store publishing key.
let devKey: string | undefined
try {
  devKey = readFileSync(path.join(dir, 'dev-key.public.txt'), 'utf-8').trim()
} catch {
  devKey = undefined
}

export default defineManifest({
  manifest_version: 3,
  name: '써니C — 기획서 QA',
  version: pkg.version,
  description: 'LLM 기반 서비스 기획서 QA 검증 사이드패널',
  icons: {
    16: 'public/icons/icon16.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
  action: {},
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  permissions: ['sidePanel', 'storage'],
  host_permissions: ['*://*.atlassian.net/*'],
  ...(devKey ? { key: devKey } : {}),
})
