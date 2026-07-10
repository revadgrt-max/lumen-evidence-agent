// Per-dossier ROI: human baseline (peer-reviewed) vs this agent run (measured).
// Rules (Claude.md): always a range, assumptions stated, never a hero number.
// Anchors: Borah 2017 [S68] 67.3 wks / 5 authors; analyst loaded cost from [S69].

const HUMAN = {
  // Conservative: a scoped competitive-intelligence / evidence brief.
  conservative: { weeks: 4, people: 1.5, note: 'a scoped evidence brief — 1–2 analysts, ~1 month' },
  // Maximal: a rigorous connected synthesis at systematic-review depth.
  maximal: { weeks: 67.3, people: 5, note: 'rigorous connected synthesis at systematic-review depth (Borah 2017, n=195) [S68]' },
  loadedHourly: 78, // ~$116k base [S69] × ~1.4 loading ÷ ~2080 h/yr, rounded — DIRECTIONAL
  hoursPerWeek: 40,
};

// Rough agent-side compute cost (Sonnet-class), for honesty not precision.
const AGENT_COST_PER_MIN = 0.05; // ~$ per minute of a live run — DIRECTIONAL

export function computeRoi({ runSeconds, toolCalls, claims }) {
  const hours = (w, p) => Math.round(w * HUMAN.hoursPerWeek * p);
  const cost = (h) => Math.round(h * HUMAN.loadedHourly);
  const hLow = hours(HUMAN.conservative.weeks, HUMAN.conservative.people);
  const hHigh = hours(HUMAN.maximal.weeks, HUMAN.maximal.people);
  const agentMin = Math.max(0.2, +(runSeconds / 60).toFixed(1));
  const agentCost = +(agentMin * AGENT_COST_PER_MIN).toFixed(2);
  const speedupLow = Math.round((hLow * 60) / Math.max(1, runSeconds));
  const speedupHigh = Math.round((hHigh * 60) / Math.max(1, runSeconds));
  return {
    human: {
      conservative: { weeks: HUMAN.conservative.weeks, people: HUMAN.conservative.people, hours: hLow, cost: cost(hLow), note: HUMAN.conservative.note },
      maximal: { weeks: HUMAN.maximal.weeks, people: HUMAN.maximal.people, hours: hHigh, cost: cost(hHigh), note: HUMAN.maximal.note },
    },
    agent: { minutes: agentMin, toolCalls, claims, cost: agentCost },
    savings: {
      timeSpeedup: { low: speedupLow, high: speedupHigh },
      cost: { low: cost(hLow) - agentCost, high: cost(hHigh) - agentCost },
    },
    assumptions: [
      'Human range spans a scoped brief (~4 wk, 1–2 analysts) to a rigorous synthesis (67.3 wk, 5 people; Borah 2017 [S68]).',
      `Loaded analyst cost ~$${HUMAN.loadedHourly}/h (from ~$116k base [S69] × ~1.4 loading) — DIRECTIONAL.`,
      'Agent side measured live (run seconds, tool calls); compute cost estimated — DIRECTIONAL.',
      'Dossier-build speed is the lever; the connected map’s larger prize is pushing attrition to earlier, cheaper phases.',
    ],
  };
}
