#!/usr/bin/env node
// EKPS 2.0 enforcement gate — dependency-free. Run: node .antigravity/scripts/validate.mjs
// Enforces: valid package.meta.json per domain, registry<->folders agree, no dependency cycles,
// no stub .md (<200 bytes), no Mermaid anywhere. Exit 0 = pass, 1 = fail.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const isDomain = (n) => /^[0-9]{3}_[a-z0-9_]+$/.test(n);

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}

// 1. Domains + package.meta.json
const domains = readdirSync(ROOT).filter((n) => {
  try { return statSync(join(ROOT, n)).isDirectory() && isDomain(n); } catch { return false; }
});
const meta = {};
for (const d of domains) {
  const mp = join(ROOT, d, 'package.meta.json');
  if (!existsSync(mp)) { errors.push(`[meta] ${d}: missing package.meta.json`); continue; }
  let m; try { m = JSON.parse(readFileSync(mp, 'utf8')); } catch (e) { errors.push(`[meta] ${d}: invalid JSON (${e.message})`); continue; }
  for (const k of ['id', 'name', 'version', 'status', 'owners', 'dependsOn', 'provides'])
    if (!(k in m)) errors.push(`[meta] ${d}: missing required field '${k}'`);
  if (m.id !== d) errors.push(`[meta] ${d}: id '${m.id}' != folder name`);
  if (m.version && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(m.version)) errors.push(`[meta] ${d}: bad semver '${m.version}'`);
  if (!existsSync(join(ROOT, d, 'README.md'))) errors.push(`[pkg] ${d}: missing README.md`);
  if (!existsSync(join(ROOT, d, 'INDEX.md'))) errors.push(`[pkg] ${d}: missing INDEX.md`);
  meta[d] = m || {};
}

// 2. Registry <-> folders
try {
  const reg = JSON.parse(readFileSync(join(ROOT, 'registry', 'registry.json'), 'utf8'));
  const regIds = new Set(reg.packages.map((p) => p.id));
  for (const d of domains) if (!regIds.has(d)) errors.push(`[registry] domain '${d}' not in registry.json`);
  for (const id of regIds) if (!domains.includes(id)) errors.push(`[registry] registry lists '${id}' but no such domain folder`);
} catch (e) { errors.push(`[registry] cannot read registry.json (${e.message})`); }

// 3. Dependency cycle detection (over package.meta.json dependsOn)
const graph = Object.fromEntries(Object.entries(meta).map(([id, m]) => [id, m.dependsOn || []]));
const WHITE = 0, GRAY = 1, BLACK = 2; const color = {};
function dfs(n, stack) {
  color[n] = GRAY; stack.push(n);
  for (const dep of graph[n] || []) {
    if (!(dep in graph)) { errors.push(`[deps] ${n}: dependsOn unknown package '${dep}'`); continue; }
    if (color[dep] === GRAY) errors.push(`[deps] CYCLE: ${[...stack, dep].join(' -> ')}`);
    else if (color[dep] === WHITE) dfs(dep, stack);
  }
  stack.pop(); color[n] = BLACK;
}
for (const n of Object.keys(graph)) if (color[n] === undefined || color[n] === WHITE) dfs(n, []);

// 4. No stubs + no Mermaid across the whole repo
for (const f of walk(ROOT)) {
  const rel = f.slice(ROOT.length + 1);
  const ext = extname(f).toLowerCase();
  if (ext === '.mmd' || ext === '.mermaid') errors.push(`[diagram] Mermaid file prohibited: ${rel}`);
  if (ext === '.md') {
    const buf = readFileSync(f, 'utf8');
    // no-stub rule applies to domain content docs (NNN_...), not root metadata (README/VERSION/etc.)
    if (/^[0-9]{3}_/.test(rel) && buf.length < 200) errors.push(`[stub] ${rel}: ${buf.length} bytes (< 200; stubs are prohibited)`);
    // Mermaid fence = a code fence at the start of a line; inline prose mentioning it is allowed.
    if (/^\s*```mermaid/m.test(buf)) errors.push(`[diagram] Mermaid fence prohibited in ${rel}`);
  }
}

// Report
if (errors.length) {
  console.error(`EKPS validation FAILED — ${errors.length} issue(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`EKPS validation PASSED: ${domains.length} domains, no stubs, no Mermaid, no cycles, registry consistent.`);
