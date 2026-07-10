// Directly test the anti-hallucination guardrail: a claim whose source no tool
// returned must be downgraded to FLAGGED, and an FDA-program conflation must be caught.
import { createLedger } from '../server/ledger.js';
import { checkRegulatoryPrecision } from '../server/glossary.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

console.log('\nGuardrail test — provenance + FDA precision\n');

const L = createLedger();
// Simulate a tool having returned real sources.
L.registerToolResult('search_pubmed', { sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/?term=x', items: [{ url: 'https://pubmed.ncbi.nlm.nih.gov/30787022/' }] });
L.registerToolResult('search_clinical_trials', { sourceUrl: 'https://clinicaltrials.gov/search?term=y', items: [{ url: 'https://clinicaltrials.gov/study/NCT02437136' }] });

// 1. Claim citing a source a tool actually returned -> VERIFIED, provenance exact.
const good = L.recordClaim({ silo: 'regulatory', text: 'Approved May 23, 2017 for MSI-H solid tumors.', sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/30787022/', quote: 'approved', tier: 'VERIFIED' });
ok(good.tier === 'VERIFIED' && good.provenance === 'exact', 'real tool-returned source → VERIFIED (provenance exact)');

// 2. Claim citing a same-host deep link a tool surfaced -> host provenance, stays VERIFIED.
const host = L.recordClaim({ silo: 'clinical', text: 'Trial NCT02437136 is Phase 1b/2.', sourceUrl: 'https://clinicaltrials.gov/study/NCT02437136?tab=table', quote: 'phase', tier: 'VERIFIED' });
ok(host.provenance !== 'unverified', 'same-host deep link → provenance recognized (not unverified)');

// 3. HALLUCINATED source (no tool returned this host) -> forced FLAGGED.
const bad = L.recordClaim({ silo: 'research', text: 'Fabricated fact.', sourceUrl: 'https://totally-made-up-journal.example.com/article/999', quote: 'x', tier: 'VERIFIED' });
ok(bad.tier === 'FLAGGED' && bad.provenance === 'unverified', 'source no tool returned → auto-downgraded to FLAGGED (this is the anti-Watson guard)');

// 4. FDA-program conflation in claim text -> flagged even with a good source.
const conflate = L.recordClaim({ silo: 'regulatory', text: 'The KEYNOTE-361 FDA program is an initiative like RTOR.', sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/30787022/', quote: 'x', tier: 'VERIFIED' });
ok(conflate.tier === 'FLAGGED' && conflate.flags.length > 0, 'FDA program-name conflation → FLAGGED with a precision note');

// 5. Precision checker catches RTOR/Orbis conflation.
ok(checkRegulatoryPrecision('RTOR is the same as Project Orbis').length > 0, 'checkRegulatoryPrecision catches RTOR = Project Orbis');
ok(checkRegulatoryPrecision('Accelerated approval granted in 2017.').length === 0, 'clean regulatory text → no false positive');

// 6. flag_unverified path.
const flag = L.flagUnverified({ silo: 'research', text: 'Unsourced hunch.', reason: 'no tool could source it' });
ok(flag.tier === 'UNVERIFIED', 'flag_unverified → UNVERIFIED tier (honest, not bluffed)');

const snap = L.snapshot();
console.log(`\n  ledger: ${snap.stats.total} claims · ${snap.stats.verified} verified · ${snap.stats.flagged} flagged · ${snap.stats.unverified} unverified · provenanceRate=${snap.stats.provenanceRate}`);
console.log(`\n${fail === 0 ? '✅ ALL GUARDRAIL TESTS PASSED' : '❌ ' + fail + ' FAILED'} (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
