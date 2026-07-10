// Smoke-test all five live-API tools (keyless). Proves the data layer works.
import { searchClinicalTrials, searchPubMed, searchOpenFDA, queryOpenTargets, searchEuropePMC } from '../server/tools.js';

const q = process.argv[2] || 'pembrolizumab';
const line = (s) => console.log(s);

async function run(name, p) {
  const t0 = Date.now();
  try {
    const r = await p;
    line(`\n✅ ${name}  (${Date.now() - t0}ms)  — ${r.items.length} items  — ${r.sourceUrl}`);
    line(r.forModel.split('\n').slice(0, 3).map((l) => '   · ' + l.slice(0, 130)).join('\n'));
  } catch (e) {
    line(`\n❌ ${name}  (${Date.now() - t0}ms)  — ${e.message}`);
  }
}

line(`Testing live-API tools with query: "${q}"`);
await run('ClinicalTrials.gov v2', searchClinicalTrials({ query: q, pageSize: 5 }));
await run('PubMed E-utilities', searchPubMed({ query: q, retmax: 4 }));
await run('openFDA drugsfda', searchOpenFDA({ query: q, endpoint: 'drugsfda' }));
await run('Open Targets GraphQL', queryOpenTargets({ query: q }));
await run('Europe PMC', searchEuropePMC({ query: q, pageSize: 4 }));
line('\nDone.');
