'use strict';

// Run-scoped collector of section-generation problems so the morning run and the
// approval surface them instead of failing silently. Populated by:
//   - copy.js   — a section call that threw, returned malformed JSON, or needed
//                 a retry (kind: 'retry' | 'failed').
//   - editor.js — a section hard-blocked by the Editorial Bible (kind: 'blocked').
// generate-brief.js resets it at the start of a run and prints it at the end.

const GENERATION_WARNINGS = [];

const SEVERITY = { retry: 1, failed: 2, blocked: 2 };

// Record (or escalate) a warning for a section. Deduped by section name, keeping
// the most serious kind — so a section that retried and then failed shows once.
function addWarning(section, kind = 'failed', detail = '') {
  if (!section) return;
  const existing = GENERATION_WARNINGS.find((w) => w.section === section);
  if (existing) {
    if ((SEVERITY[kind] || 0) >= (SEVERITY[existing.kind] || 0)) {
      existing.kind = kind;
      if (detail) existing.detail = detail;
    }
    return;
  }
  GENERATION_WARNINGS.push({ section, kind, detail });
}

function resetWarnings() { GENERATION_WARNINGS.length = 0; }

// Human-readable block for the run output / approval email. '' when all clear.
function formatWarnings() {
  if (!GENERATION_WARNINGS.length) return '';
  return GENERATION_WARNINGS
    .map((w) => `   • ${w.section} — ${w.kind}${w.detail ? `: ${w.detail}` : ''}`)
    .join('\n');
}

module.exports = { GENERATION_WARNINGS, addWarning, resetWarnings, formatWarnings };
