import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Build-time version info: git short hash + build timestamp. Baked into the
// bundle so the deployed client always self-identifies which commit it is.
function buildVersion() {
  let hash = 'unknown'
  try {
    hash = execSync('git rev-parse --short HEAD', { cwd: process.cwd() })
      .toString().trim()
  } catch { /* not a git repo */ }
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16)
  return { hash, ts }
}

const v = buildVersion()

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`${v.hash} ${v.ts}`),
  },
})
