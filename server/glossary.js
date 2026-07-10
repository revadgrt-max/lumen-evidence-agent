// FDA regulatory-program precision glossary — the anti-conflation guardrail.
// Verified facts: ../POC-EVIDENCE.md §1 [S19-S22]. The agent must validate every
// program name against this; a red-team check scans claim text for misuse.

export const FDA_PROGRAMS = {
  'Accelerated Approval': {
    year: 1992,
    kind: 'approval pathway',
    def: 'Approves drugs for serious, unmet-need conditions on a surrogate/intermediate endpoint "reasonably likely to predict" clinical benefit; confirmatory trials required (21 CFR 314-H / 601-E; strengthened by FDORA 2022).',
  },
  'Breakthrough Therapy': {
    year: 2012,
    kind: 'designation',
    def: 'Expedites development/review where preliminary clinical evidence shows substantial improvement over available therapy on a clinically significant endpoint.',
  },
  'Priority Review': {
    kind: 'review designation',
    def: 'FDA aims to act within 6 months (vs 10 under standard review).',
  },
  'Fast Track': {
    kind: 'designation',
    def: 'Facilitates development/expedites review for serious conditions with unmet need. NOTE: exact distinguishing criteria flagged "confirm before asserting" — a candidate definition was refuted in adversarial verification.',
    caution: true,
  },
  'Real-Time Oncology Review (RTOR)': {
    year: 2018,
    kind: 'OCE pilot program',
    def: 'FDA Oncology Center of Excellence pilot allowing earlier submission of trial data for streamlined review. Distinct from Project Orbis.',
  },
  'Project Orbis': {
    year: 2019,
    kind: 'OCE framework',
    def: 'FDA OCE framework (May 2019) for concurrent submission/review of oncology products among international partners. An applicant may use RTOR, Orbis, or both; Orbis does not affect RTOR timelines.',
  },
};

// Things that are NOT FDA programs — the classic conflation traps.
export const NOT_FDA_PROGRAMS = [
  { term: 'TRAILBLAZER-ALZ', truth: "Eli Lilly's donanemab Alzheimer's trial — a clinical trial, not an FDA program." },
  { term: 'KEYNOTE', truth: "Merck's pembrolizumab trial program — clinical trials, not FDA programs." },
  { term: 'VERITAC', truth: "Arvinas/Pfizer's vepdegestrant trial — a clinical trial, not an FDA program." },
];

const PROGRAM_NAMES = Object.keys(FDA_PROGRAMS);

// Scan text for FDA-program misuse: a trial name described as an FDA program,
// or RTOR/Orbis used interchangeably. Returns an array of issue strings.
export function checkRegulatoryPrecision(text) {
  const issues = [];
  const t = ` ${text} `;
  // A trial/program name (KEYNOTE, VERITAC, TRAILBLAZER) framed as an FDA program/initiative.
  const fdaProgramPhrase = /FDA\s+(program|initiative|pathway)|(program|initiative|pathway)[^.]{0,30}\bFDA\b/i.test(t);
  const negated = /not\s+(an?\s+)?(fda\s+)?(program|initiative|pathway)/i.test(t); // "is NOT an FDA program" is fine
  for (const { term, truth } of NOT_FDA_PROGRAMS) {
    if (new RegExp(`\\b${term}`, 'i').test(t) && fdaProgramPhrase && !negated) {
      issues.push(`"${term}" framed as an FDA program — ${truth}`);
    }
  }
  if (/RTOR/i.test(t) && /Project\s+Orbis/i.test(t) && /(same|equivalent|aka|also called|interchangeab)/i.test(t)) {
    issues.push('RTOR and Project Orbis conflated — they are distinct OCE programs (2018 vs 2019).');
  }
  return issues;
}

export function glossaryForPrompt() {
  const lines = PROGRAM_NAMES.map((n) => `- ${n}${FDA_PROGRAMS[n].year ? ` (${FDA_PROGRAMS[n].year})` : ''}: ${FDA_PROGRAMS[n].def}`);
  const nots = NOT_FDA_PROGRAMS.map((n) => `- ${n.term}: ${n.truth}`);
  return `FDA program glossary (use these EXACT names; never conflate):\n${lines.join('\n')}\n\nNOT FDA programs (do not list among FDA initiatives):\n${nots.join('\n')}`;
}
