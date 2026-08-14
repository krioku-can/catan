// Build-time version injected by vite.config.ts (see `define.__APP_VERSION__`,
// declared globally in vite-env.d.ts). Falls back gracefully in dev/editor.
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__
    ? __APP_VERSION__
    : 'dev'
