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

// client.ts가 fetch로 쓰는 것과 같은 변수(VITE_API_BASE_URL)로 백엔드 주소를 지정하면(예: 클라우드에
// 배포한 주소), 그 origin도 host_permissions에 넣는다 — 안 그러면 MV3가 그 주소로 나가는 요청을
// 그냥 막아버린다. 로컬 개발용 localhost:8000은 항상 남겨둬서 이 변수를 안 줘도 기존처럼 동작한다.
const apiBaseUrl = process.env.VITE_API_BASE_URL
const deployedApiOrigin = apiBaseUrl ? [`${apiBaseUrl}/*`] : []

export default defineManifest({
  manifest_version: 3,
  name: '써니C 기획서 품질 검증 도우미',
  version: pkg.version,
  description: '기획서들의 검토 기준과 프로세스를 일관되고 통일시키는 에이전트 서비스',
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
  content_scripts: [
    {
      // localhost/127.0.0.1 항목은 backend의 /mock-confluence 목 서버(회사 컨플루언스 없이
      // 로컬에서 왕복 테스트하기 위한 용도)에서만 쓰는 개발용 패턴 — 실배포 시 제거 대상.
      matches: ['*://*.atlassian.net/*', 'http://localhost:8000/*', 'http://127.0.0.1:8000/*'],
      js: ['src/content/confluence-extractor.ts', 'src/content/issueOverlay.ts'],
    },
  ],
  permissions: ['sidePanel', 'storage'],
  host_permissions: [
    '*://*.atlassian.net/*',
    'http://localhost:8000/*',
    'http://127.0.0.1:8000/*',
    ...deployedApiOrigin,
  ],
  ...(devKey ? { key: devKey } : {}),
})
