// The evidence ledger + the PROVENANCE GUARDRAIL — the core anti-hallucination
// mechanism. A claim cannot stand unless its cited source URL was actually returned
// by a tool this run. Anything else is downgraded to FLAGGED, never silently shown
// as fact. This is the structural fix for the "confident wrong citation" that sank
// IBM Watson for Oncology (see BUILD-PLAN §6).

import { checkRegulatoryPrecision } from './glossary.js';

const norm = (u) => (u || '').trim().replace(/\/+$/, '').replace(/^http:/, 'https:').toLowerCase();

export function createLedger() {
  const toolUrls = new Set();      // every sourceUrl + item URL a tool returned
  const toolSourceUrls = new Set(); // the query-level source URLs (for host matching)
  const claims = [];
  const audit = [];

  return {
    // Called for every tool result — register its provenance surface.
    registerToolResult(toolName, result) {
      if (result?.sourceUrl) { toolUrls.add(norm(result.sourceUrl)); toolSourceUrls.add(norm(result.sourceUrl)); }
      for (const it of result?.items || []) if (it?.url) toolUrls.add(norm(it.url));
      audit.push({ at: new Date().toISOString(), kind: 'tool', tool: toolName, sourceUrl: result?.sourceUrl, count: (result?.items || []).length });
    },

    // Called when the agent records a claim. Returns the graded claim.
    recordClaim({ silo, text, sourceUrl, quote, tier = 'VERIFIED' }) {
      const nUrl = norm(sourceUrl);
      // Provenance: exact URL match, OR same host as a tool-returned URL (covers
      // deep links into a source a tool surfaced, e.g. a specific NCT/PMID page).
      let provenance = 'unverified';
      if (toolUrls.has(nUrl)) provenance = 'exact';
      else {
        try {
          const host = new URL(sourceUrl).host.toLowerCase();
          for (const u of toolUrls) { try { if (new URL(u.startsWith('http') ? u : 'https://' + u).host.toLowerCase() === host) { provenance = 'host'; break; } } catch {} }
        } catch {}
      }
      const precisionIssues = checkRegulatoryPrecision(text);
      // Grading: no provenance OR a precision issue -> forced FLAGGED.
      let finalTier = tier;
      const flags = [];
      if (provenance === 'unverified') { finalTier = 'FLAGGED'; flags.push('no tool returned this source — provenance unverified'); }
      if (precisionIssues.length) { finalTier = 'FLAGGED'; flags.push(...precisionIssues); }
      const claim = { silo, text, sourceUrl, quote, tier: finalTier, provenance, flags, at: new Date().toISOString() };
      claims.push(claim);
      audit.push({ at: claim.at, kind: 'claim', silo, tier: finalTier, provenance, sourceUrl });
      return claim;
    },

    flagUnverified({ silo, text, reason }) {
      const claim = { silo, text, sourceUrl: null, quote: null, tier: 'UNVERIFIED', provenance: 'none', flags: [reason], at: new Date().toISOString() };
      claims.push(claim);
      audit.push({ at: claim.at, kind: 'flag', silo, reason });
      return claim;
    },

    snapshot() {
      const verified = claims.filter((c) => c.tier === 'VERIFIED').length;
      const flagged = claims.filter((c) => c.tier === 'FLAGGED').length;
      const unverified = claims.filter((c) => c.tier === 'UNVERIFIED').length;
      return {
        claims, audit,
        stats: {
          total: claims.length, verified, flagged, unverified,
          toolCalls: audit.filter((a) => a.kind === 'tool').length,
          // Provenance integrity = share of asserted claims that trace to a real tool source.
          provenanceRate: claims.length ? +(claims.filter((c) => c.provenance !== 'unverified' && c.provenance !== 'none').length / claims.length).toFixed(3) : null,
        },
      };
    },
  };
}
