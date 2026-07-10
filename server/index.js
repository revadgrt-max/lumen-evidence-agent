import Fastify from 'fastify';
import fstatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { runDossierLive, runDossierReplay } from './agent.js';
import { TOOLS } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const app = Fastify({ logger: false });

await app.register(fstatic, { root: join(ROOT, 'public'), prefix: '/' });

// --- Pre-flight health: ping all five live APIs so the founder knows before presenting.
app.get('/api/health', async () => {
  const probes = {
    clinicaltrials: () => TOOLS.search_clinical_trials.fn({ query: 'cancer', pageSize: 1 }),
    pubmed: () => TOOLS.search_pubmed.fn({ query: 'cancer', retmax: 1 }),
    openfda: () => TOOLS.search_openfda.fn({ query: 'pembrolizumab' }),
    opentargets: () => TOOLS.query_open_targets.fn({ query: 'EGFR' }),
    europepmc: () => TOOLS.search_europepmc.fn({ query: 'cancer', pageSize: 1 }),
  };
  const out = {};
  await Promise.all(Object.entries(probes).map(async ([k, fn]) => {
    const t0 = Date.now();
    try { await fn(); out[k] = { ok: true, ms: Date.now() - t0 }; }
    catch (e) { out[k] = { ok: false, ms: Date.now() - t0, error: e.message }; }
  }));
  out.anthropicKey = !!process.env.ANTHROPIC_API_KEY;
  return out;
});

app.get('/api/golden', async () => {
  const dir = join(ROOT, 'data', 'golden');
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    const list = await Promise.all(files.map(async (f) => {
      const g = JSON.parse(await readFile(join(dir, f), 'utf8'));
      return { id: g.id, name: g.name, modality: g.modality, molecularTarget: g.molecularTarget, scorecard: g.scorecard || null };
    }));
    return { golden: list };
  } catch { return { golden: [] }; }
});

// --- The dossier stream (SSE).
app.get('/api/dossier', async (req, reply) => {
  const { target, mode = 'live', id, speed } = req.query;
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  const send = ({ event, data }) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    let gen;
    if (mode === 'replay') {
      const g = JSON.parse(await readFile(join(ROOT, 'data', 'golden', `${id || target}.json`), 'utf8'));
      gen = runDossierReplay(g, { speed: Number(speed) || 1 });
    } else {
      if (!process.env.ANTHROPIC_API_KEY) { send({ event: 'error', data: { message: 'ANTHROPIC_API_KEY not set — use replay mode or set the key.' } }); return reply.raw.end(); }
      gen = runDossierLive(target);
    }
    for await (const ev of gen) send(ev);
  } catch (e) {
    send({ event: 'error', data: { message: e.message } });
  }
  reply.raw.end();
});

const PORT = Number(process.env.PORT) || 8787;
app.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  console.log(`\n  Lumen Evidence Agent  →  http://127.0.0.1:${PORT}`);
  console.log(`  live mode: ${process.env.ANTHROPIC_API_KEY ? 'ready' : 'set ANTHROPIC_API_KEY to enable'} · replay mode: always on\n`);
});
