// The Claude tool-use agent loop. Streams SSE events as it assembles a connected,
// cited dossier across research -> clinical -> regulatory silos. Every asserted claim
// passes through the ledger's provenance guardrail (ledger.js) before it is shown.

import Anthropic from '@anthropic-ai/sdk';
import { TOOLS } from './tools.js';
import { createLedger } from './ledger.js';
import { glossaryForPrompt } from './glossary.js';
import { computeRoi } from './roi.js';

const MODEL = process.env.LUMEN_MODEL || 'claude-sonnet-5';
const MAX_TURNS = 10;

const SEARCH_TOOL_SPECS = [
  { name: 'search_clinical_trials', description: 'Search ClinicalTrials.gov v2 for trials. Returns NCT ids, titles, phase, status, sponsor. Use for the CLINICAL silo.', input_schema: { type: 'object', properties: { query: { type: 'string' }, pageSize: { type: 'integer' } }, required: ['query'] } },
  { name: 'search_pubmed', description: 'Search PubMed for peer-reviewed literature. Returns PMIDs, titles, journals. Use for the RESEARCH silo (mechanism, evidence).', input_schema: { type: 'object', properties: { query: { type: 'string' }, retmax: { type: 'integer' } }, required: ['query'] } },
  { name: 'search_openfda', description: 'Search openFDA drug approvals/labels. Returns brand/generic, sponsor, application number. Use for the REGULATORY silo.', input_schema: { type: 'object', properties: { query: { type: 'string' }, endpoint: { type: 'string', enum: ['drugsfda', 'label'] } }, required: ['query'] } },
  { name: 'query_open_targets', description: 'Query Open Targets for target/disease/drug biology. Use for the RESEARCH silo (target rationale, competitive set).', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'search_europepmc', description: 'Search Europe PMC literature (33M+ pubs). Use for the RESEARCH silo.', input_schema: { type: 'object', properties: { query: { type: 'string' }, pageSize: { type: 'integer' } }, required: ['query'] } },
];

const LEDGER_TOOL_SPECS = [
  { name: 'record_claim', description: 'Record ONE dossier claim. You MUST pass a sourceUrl that came from a tool result and an exact quote. The system validates provenance; a claim whose source no tool returned is auto-downgraded to FLAGGED. Never fabricate a source.', input_schema: { type: 'object', properties: { silo: { type: 'string', enum: ['research', 'clinical', 'regulatory'] }, text: { type: 'string' }, sourceUrl: { type: 'string' }, quote: { type: 'string' }, tier: { type: 'string', enum: ['VERIFIED', 'DIRECTIONAL'] } }, required: ['silo', 'text', 'sourceUrl'] } },
  { name: 'flag_unverified', description: 'Record something you believe is relevant but CANNOT source from a tool. Honest flagging beats bluffing.', input_schema: { type: 'object', properties: { silo: { type: 'string' }, text: { type: 'string' }, reason: { type: 'string' } }, required: ['text', 'reason'] } },
];

const ALL_TOOLS = [...SEARCH_TOOL_SPECS, ...LEDGER_TOOL_SPECS];

function systemPrompt() {
  return `You are the Lumen Evidence Agent. You assemble a CONNECTED, CITED evidence dossier for a drug target or molecule, spanning three silos: research -> clinical -> regulatory. This is a business/economics demo — stay at the commercial layer (targets, assets, endpoints, programs), never laboratory methods.

METHOD
- Use the search tools to gather primary evidence, then record findings with record_claim.
- CONNECT the silos: tie a clinical attrition signal back to research risk, or a regulatory pathway forward to a commercial implication. The value is the connection, not any single silo.
- Aim for ~8-12 load-bearing claims across all three silos, including at least one attrition signal (a failed endpoint or withdrawn indication) when one exists.

HARD RULES (non-negotiable)
1. Every record_claim MUST carry a sourceUrl that appeared in a tool result, plus an exact quote. If you can't source it, use flag_unverified instead. Do not bluff.
2. Regulatory precision — never conflate program names.
${glossaryForPrompt()}

Finish when the dossier is complete. Do not pad with weak claims.`;
}

const sse = (event, data) => ({ event, data });

// Live agent run. Async generator yielding {event, data}.
export async function* runDossierLive(target) {
  const client = new Anthropic();
  const ledger = createLedger();
  const t0 = Date.now();
  const messages = [{ role: 'user', content: `Assemble a connected, cited evidence dossier for: ${target}` }];
  yield sse('start', { target, mode: 'live', model: MODEL });

  let turns = 0;
  try {
    while (turns++ < MAX_TURNS) {
      const stream = client.messages.stream({ model: MODEL, max_tokens: 4096, system: systemPrompt(), tools: ALL_TOOLS, messages });
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          yield sse('reasoning', { text: ev.delta.text });
        }
      }
      const msg = await stream.finalMessage();
      messages.push({ role: 'assistant', content: msg.content });
      const toolUses = msg.content.filter((c) => c.type === 'tool_use');
      if (!toolUses.length) break;

      const toolResults = [];
      for (const tu of toolUses) {
        if (TOOLS[tu.name]) {
          yield sse('tool_call', { name: tu.name, args: tu.input });
          try {
            const out = await TOOLS[tu.name].fn(tu.input);
            ledger.registerToolResult(tu.name, out);
            yield sse('tool_result', { name: tu.name, count: out.items.length, sourceUrl: out.sourceUrl });
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: out.forModel });
          } catch (e) {
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `ERROR: ${e.message}`, is_error: true });
          }
        } else if (tu.name === 'record_claim') {
          const claim = ledger.recordClaim(tu.input);
          yield sse('claim', claim);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `recorded · tier=${claim.tier} · provenance=${claim.provenance}${claim.flags.length ? ' · FLAGS: ' + claim.flags.join('; ') : ''}` });
        } else if (tu.name === 'flag_unverified') {
          const claim = ledger.flagUnverified(tu.input);
          yield sse('flag', claim);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'flagged as unverified' });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    const snap = ledger.snapshot();
    const roi = computeRoi({ runSeconds: (Date.now() - t0) / 1000, toolCalls: snap.stats.toolCalls, claims: snap.stats.total });
    yield sse('roi', roi);
    yield sse('done', { stats: snap.stats, runSeconds: +((Date.now() - t0) / 1000).toFixed(1) });
  } catch (e) {
    yield sse('error', { message: e.message });
  }
}

// Replay a pre-baked golden dossier as a timed event stream (no key, cannot fail).
export async function* runDossierReplay(golden, { speed = 1 } = {}) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms / speed));
  yield sse('start', { target: golden.name, mode: 'replay', verified: true });
  for (const step of golden.timeline) {
    await wait(step.delayMs ?? 400);
    yield sse(step.event, step.data);
  }
}
