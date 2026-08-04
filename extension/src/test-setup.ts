import { vi } from 'vitest'

// confluence-extractor.ts registers a chrome.runtime.onMessage listener at module load time.
// The extension APIs don't exist under Vitest's happy-dom environment, so stub the bit we touch.
Object.assign(globalThis, {
  chrome: {
    runtime: {
      onMessage: {
        addListener: vi.fn(),
      },
    },
  },
})
