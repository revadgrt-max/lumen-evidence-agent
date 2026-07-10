// Live data-source tools. Each returns { items, sourceUrl, fetchedAt, forModel }.
// sourceUrl is the exact human-openable URL for the query so every ledger claim links
// to something a skeptic can click. Verified specs: ../POC-EVIDENCE.md §0 [S60-S64].

const UA = { 'User-Agent': 'LumenEvidenceAgent/0.1 (research demo; contact founder)' };

async function getJSON(url, { timeout = 9000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { ...UA, ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function postJSON(url, body, { timeout = 9000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { ...UA, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- Clinical [S60]
export async function searchClinicalTrials({ query, pageSize = 8, phase, status }) {
  const params = new URLSearchParams({
    'query.term': query,
    pageSize: String(pageSize),
    'fields': 'NCTId,BriefTitle,OverallStatus,Phase,LeadSponsorName,Condition,PrimaryOutcomeMeasure',
  });
  if (phase) params.set('filter.advanced', `AREA[Phase]${phase}`);
  if (status) params.set('filter.overallStatus', status);
  const api = `https://clinicaltrials.gov/api/v2/studies?${params}`;
  const data = await getJSON(api);
  const items = (data.studies || []).map((s) => {
    const p = s.protocolSection || {};
    const id = p.identificationModule || {};
    return {
      nctId: id.nctId,
      title: id.briefTitle,
      status: (p.statusModule || {}).overallStatus,
      phase: ((p.designModule || {}).phases || []).join('/'),
      sponsor: ((p.sponsorCollaboratorsModule || {}).leadSponsor || {}).name,
      url: id.nctId ? `https://clinicaltrials.gov/study/${id.nctId}` : null,
    };
  });
  return { items, sourceUrl: `https://clinicaltrials.gov/search?term=${encodeURIComponent(query)}`, fetchedAt: now(),
    forModel: items.map((i) => `${i.nctId} · ${i.title} · ${i.phase || 'n/a'} · ${i.status} · ${i.sponsor} · ${i.url}`).join('\n') || 'no trials found' };
}

// ---------------------------------------------------------------- Research [S61]
export async function searchPubMed({ query, retmax = 6 }) {
  const key = process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : '';
  const esearch = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${retmax}&term=${encodeURIComponent(query)}${key}`;
  const s = await getJSON(esearch);
  const ids = ((s.esearchresult || {}).idlist) || [];
  let items = [];
  if (ids.length) {
    const esum = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}${key}`;
    const sum = await getJSON(esum);
    const r = sum.result || {};
    items = ids.map((id) => ({
      pmid: id,
      title: (r[id] || {}).title,
      source: (r[id] || {}).fulljournalname || (r[id] || {}).source,
      date: (r[id] || {}).pubdate,
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
    }));
  }
  return { items, sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`, fetchedAt: now(),
    forModel: items.map((i) => `PMID ${i.pmid} · ${i.title} · ${i.source} ${i.date} · ${i.url}`).join('\n') || 'no papers found' };
}

// ---------------------------------------------------------------- Regulatory [S62]
export async function searchOpenFDA({ query, endpoint = 'drugsfda', limit = 5 }) {
  const key = process.env.OPENFDA_API_KEY ? `&api_key=${process.env.OPENFDA_API_KEY}` : '';
  const field = endpoint === 'label' ? 'openfda.generic_name' : 'openfda.generic_name';
  const api = `https://api.fda.gov/drug/${endpoint}.json?search=${encodeURIComponent(field + ':"' + query + '"')}&limit=${limit}${key}`;
  let data;
  try { data = await getJSON(api); }
  catch { // openFDA returns 404 for zero results — treat as empty, not error
    return { items: [], sourceUrl: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=BasicSearch.process&searchTerm=${encodeURIComponent(query)}`, fetchedAt: now(), forModel: 'no openFDA records found' };
  }
  const results = data.results || [];
  const items = results.map((r) => {
    const of = r.openfda || {};
    return {
      brand: (of.brand_name || [])[0],
      generic: (of.generic_name || [])[0],
      sponsor: r.sponsor_name,
      appNum: r.application_number,
      products: (r.products || []).map((p) => `${p.brand_name || ''} ${p.dosage_form || ''} (${p.marketing_status || ''})`).slice(0, 3),
    };
  });
  return { items, sourceUrl: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=BasicSearch.process&searchTerm=${encodeURIComponent(query)}`, fetchedAt: now(),
    forModel: items.map((i) => `${i.brand || i.generic} · ${i.sponsor} · ${i.appNum} · ${(i.products || []).join('; ')}`).join('\n') || 'no openFDA records found' };
}

// ---------------------------------------------------------------- Research/biology [S63]
export async function queryOpenTargets({ query }) {
  const gql = {
    query: `query Search($q: String!) { search(queryString: $q, entityNames: ["target","disease","drug"]) {
      hits { id name entity description } } }`,
    variables: { q: query },
  };
  const data = await postJSON('https://api.platform.opentargets.org/api/v4/graphql', gql);
  const hits = (((data.data || {}).search || {}).hits) || [];
  const items = hits.slice(0, 6).map((h) => ({
    id: h.id, name: h.name, entity: h.entity,
    description: (h.description || '').slice(0, 180),
    url: h.entity === 'target' ? `https://platform.opentargets.org/target/${h.id}`
       : h.entity === 'disease' ? `https://platform.opentargets.org/disease/${h.id}`
       : `https://platform.opentargets.org/drug/${h.id}`,
  }));
  return { items, sourceUrl: 'https://platform.opentargets.org/', fetchedAt: now(),
    forModel: items.map((i) => `${i.entity}: ${i.name} (${i.id}) · ${i.description} · ${i.url}`).join('\n') || 'no Open Targets hits' };
}

// ---------------------------------------------------------------- Research/literature [S64]
export async function searchEuropePMC({ query, pageSize = 6 }) {
  const api = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=${pageSize}&resultType=lite`;
  const data = await getJSON(api);
  const res = ((data.resultList || {}).result) || [];
  const items = res.map((r) => ({
    id: r.id, source: r.source, title: r.title, authorString: r.authorString,
    journal: (r.journalInfo || {}).journal ? r.journalInfo.journal.title : r.journalTitle,
    year: r.pubYear, doi: r.doi,
    url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
  }));
  return { items, sourceUrl: `https://europepmc.org/search?query=${encodeURIComponent(query)}`, fetchedAt: now(),
    forModel: items.map((i) => `${i.title} · ${i.authorString || ''} · ${i.journal || ''} ${i.year} · ${i.url}`).join('\n') || 'no Europe PMC results' };
}

export const TOOLS = {
  search_clinical_trials: { fn: searchClinicalTrials, silo: 'clinical' },
  search_pubmed: { fn: searchPubMed, silo: 'research' },
  search_openfda: { fn: searchOpenFDA, silo: 'regulatory' },
  query_open_targets: { fn: queryOpenTargets, silo: 'research' },
  search_europepmc: { fn: searchEuropePMC, silo: 'research' },
};
