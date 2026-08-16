#!/usr/bin/env node
/**
 * Build a single self-contained HTML file of the Catan client.
 * - Local AI / resume work fully offline
 * - Online multiplayer still needs the remote server URL
 *
 * Usage: node scripts/build-single-html.mjs
 * Output: ~/Downloads/catan-single.html  (and catan/client/dist-single/catan.html)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const client = path.join(root, 'client');
const outDir = path.join(client, 'dist-single');
const downloads = path.join(process.env.HOME || '', 'Downloads');

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
    }[ext] || 'application/octet-stream'
  );
}

function toDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  return `data:${mimeFor(filePath)};base64,${buf.toString('base64')}`;
}

console.log('→ Building client (vite, base ./)…');
execSync('npx vite build --outDir dist-single --base ./', {
  cwd: client,
  stdio: 'inherit',
  env: { ...process.env },
});

const htmlPath = path.join(outDir, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Inline <script type="module" crossorigin src="./assets/...">
html = html.replace(
  /<script([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g,
  (full, pre, src, post) => {
    const abs = path.join(outDir, src.replace(/^\.\//, ''));
    if (!fs.existsSync(abs)) {
      console.warn('  missing script', src);
      return full;
    }
    let js = fs.readFileSync(abs, 'utf8');

    // Rewrite absolute/public asset paths used at runtime to data URLs
    const publicDir = path.join(client, 'public');
    const assetDir = path.join(publicDir, 'assets');
    if (fs.existsSync(assetDir)) {
      for (const name of fs.readdirSync(assetDir)) {
        const file = path.join(assetDir, name);
        if (!fs.statSync(file).isFile()) continue;
        const data = toDataUrl(file);
        // Match "/assets/name", "./assets/name", "assets/name"
        const patterns = [
          new RegExp(`(["'\`])/assets/${name.replace(/\./g, '\\.')}\\1`, 'g'),
          new RegExp(`(["'\`])\\./assets/${name.replace(/\./g, '\\.')}\\1`, 'g'),
          new RegExp(`(["'\`])assets/${name.replace(/\./g, '\\.')}\\1`, 'g'),
        ];
        for (const re of patterns) {
          js = js.replace(re, `$1${data}$1`);
        }
      }
    }

    // Also favicon / root public files if referenced
    for (const name of fs.readdirSync(publicDir)) {
      const file = path.join(publicDir, name);
      if (!fs.statSync(file).isFile()) continue;
      const data = toDataUrl(file);
      js = js.replaceAll(`"/${name}"`, `"${data}"`);
      js = js.replaceAll(`'/${name}'`, `'${data}'`);
    }

    console.log(`  inlined JS ${src} (${(js.length / 1024).toFixed(0)} KB)`);
    return `<script${pre}${post}>\n${js}\n</script>`;
  },
);

// Inline <link rel="stylesheet" href="...">
html = html.replace(
  /<link([^>]*?) rel="stylesheet"([^>]*?) href="([^"]+)"([^>]*)\/?>/g,
  (full, a, b, href) => {
    const abs = path.join(outDir, href.replace(/^\.\//, ''));
    if (!fs.existsSync(abs)) {
      console.warn('  missing css', href);
      return full;
    }
    let css = fs.readFileSync(abs, 'utf8');
    // Inline url(...) in CSS that point at relative assets
    css = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
      if (u.startsWith('data:') || u.startsWith('http')) return m;
      const rel = u.replace(/^\.\//, '');
      const candidates = [
        path.join(path.dirname(abs), rel),
        path.join(outDir, rel),
        path.join(client, 'public', rel.replace(/^\//, '')),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) {
          return `url(${q}${toDataUrl(c)}${q})`;
        }
      }
      return m;
    });
    console.log(`  inlined CSS ${href} (${(css.length / 1024).toFixed(0)} KB)`);
    return `<style>\n${css}\n</style>`;
  },
);

// Inline favicon if still external
html = html.replace(
  /<link[^>]+href="(\.?\/?favicon\.svg)"[^>]*>/i,
  () => {
    const fav = path.join(client, 'public', 'favicon.svg');
    if (!fs.existsSync(fav)) return '';
    return `<link rel="icon" href="${toDataUrl(fav)}" />`;
  },
);

// Banner comment
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
})();
const banner = `<!--
  Catan single-file export
  commit: ${commit}
  built: ${new Date().toISOString()}
  offline: local AI + resume
  online: still needs network to server if you pick multiplayer
-->\n`;
if (!html.startsWith('<!--')) html = banner + html;

const outFile = path.join(outDir, 'catan.html');
fs.writeFileSync(outFile, html);
console.log(`✓ Wrote ${outFile} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);

if (downloads && fs.existsSync(downloads)) {
  const dest = path.join(downloads, 'catan-single.html');
  fs.writeFileSync(dest, html);
  console.log(`✓ Copied ${dest}`);
}

console.log('Done.');
