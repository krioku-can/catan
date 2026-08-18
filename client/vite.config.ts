import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Build-time version info baked into the bundle so the deployed client
// self-identifies which commit it is. Precedence:
//   1. VERCEL_GIT_COMMIT_SHA  — provided by Vercel build (most reliable)
//   2. git rev-parse --short  — local builds
//   3. 'unknown'              — fallback (no git / no Vercel env)
function buildVersion() {
  let hash = 'unknown'
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    hash = process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  } else {
    try {
      hash = execSync('git rev-parse --short HEAD', { cwd: process.cwd() })
        .toString().trim()
    } catch { /* not a git repo */ }
  }
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16)
  return { hash, ts }
}

const v = buildVersion()

export default defineConfig({
  plugins: [react()],
  server: {
    // Expose the dev server on the LAN so phones on the same WiFi can load the
    // game from the Mac (Family games hosted off your own machine).
    host: true,
    port: 5173,
    strictPort: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(`${v.hash} ${v.ts}`),
  },
})
