// Build the static, self-contained demo.
//  1. data/golden/*.json  ->  public/golden.js  (window.GOLDEN)
//  2. public/{index.html,app.js,golden.js}  ->  dist/index.html  (single inlined file)
// The single file hosts anywhere (GitHub Pages, a private Artifact) and needs no server.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const files = (await readdir(join(ROOT, 'data', 'golden'))).filter((f) => f.endsWith('.json')).sort();
const golden = [];
for (const f of files) golden.push(JSON.parse(await readFile(join(ROOT, 'data', 'golden', f), 'utf8')));
const goldenJs = `window.GOLDEN = ${JSON.stringify(golden, null, 0)};`;
await writeFile(join(ROOT, 'public', 'golden.js'), goldenJs);

let html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8');
const app = await readFile(join(ROOT, 'public', 'app.js'), 'utf8');
html = html
  .replace('<script src="golden.js"></script>', `<script>window.STATIC_BUILD=true;${goldenJs}</script>`)
  .replace('<script src="app.js"></script>', `<script>${app}</script>`);
// Inline the vendored fonts as data URIs so the single-file builds render the brand type
// with no external requests (Artifact CSP / offline / GitHub Pages single file).
for (const w of ['400', '500', '700']) {
  const b64 = (await readFile(join(ROOT, 'public', 'vendor', `space-grotesk-${w}.woff2`))).toString('base64');
  html = html.replaceAll(`vendor/space-grotesk-${w}.woff2`, `data:font/woff2;base64,${b64}`);
}
// dist/ = portable single file · docs/ = GitHub Pages target (Settings > Pages > main /docs)
for (const d of ['dist', 'docs']) { await mkdir(join(ROOT, d), { recursive: true }); await writeFile(join(ROOT, d, 'index.html'), html); }
await writeFile(join(ROOT, 'docs', '.nojekyll'), '');

// artifact.html = body-content-only (no doctype/html/head/body) for claude.ai Artifact hosting,
// which supplies its own skeleton. Keep the <style>, drop the wrappers.
const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
const bodyInner = (html.match(/<body>([\s\S]*?)<\/body>/) || ['', ''])[1];
await writeFile(join(ROOT, 'dist', 'artifact.html'), `${style}\n${bodyInner}`);

console.log(`Built: ${golden.length} golden dossiers → public/golden.js`);
console.log(`       single-file demo → dist/index.html + docs/index.html (${(html.length / 1024).toFixed(0)} KB, self-contained)`);
console.log(`       targets: ${golden.map((g) => g.id).join(', ')}`);
