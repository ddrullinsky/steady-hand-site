// logic.js
// The rules behind "where you are", ported one-for-one from the iOS app
// (AppState.swift, Models.swift, PathView.swift, OperationDetailView.swift).
// Pure functions only — no DOM, no storage — so Web/tests/logic.test.mjs can
// check them against the same cases the app's unit tests use. If a rule
// changes in the app, change it here too.

export const MAX_PINNED_OPS = 3;
export const OVERRIDE_RECHECK_DAYS = 7;
export const PATHWAY_ORDER = ["catheter", "short", "open", "extended", "prolonged"];
const PREFERRED_SECTIONS = ["open", "mini", "catheter"];

// MARK: Dates
// Surgery dates are stored as "YYYY-MM-DD" — a calendar day, not an instant —
// so a date set in Montréal is the same day when read anywhere.

/** Local midnight for an ISO calendar day, or null if malformed. */
export function parseDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}

export function toISODay(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from `a` to `b`. Rounded, so a DST change can't shave a day. */
export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

/** Days since surgery (0 on the day itself); null before surgery or with no date. */
export function daysSinceSurgery(isoDate, now = new Date()) {
  const d = parseDay(isoDate);
  if (!d) return null;
  const n = daysBetween(d, now);
  return n >= 0 ? n : null;
}

/** 1-based recovery week ("week 1" = the first 7 days). */
export function weeksSinceSurgery(isoDate, now = new Date()) {
  const d = daysSinceSurgery(isoDate, now);
  return d == null ? null : Math.floor(d / 7) + 1;
}

/** Days until a future surgery; null when unset, today, or past. */
export function daysUntilSurgery(isoDate, now = new Date()) {
  const d = parseDay(isoDate);
  if (!d) return null;
  const n = daysBetween(now, d);
  return n > 0 ? n : null;
}

// MARK: Recovery horizon and the week timeline

/** Last week an operation's own recovery timeline speaks to, plus a tail. */
export function recoveryHorizonWeeks(op) {
  const steps = op.detail.home.timeline;
  if (!steps.length) return 0;
  const declared = steps.map((s) => s.fromWeek).filter((w) => w != null);
  const last = declared.length ? Math.max(...declared) : steps.length;
  return Math.max(last + 4, steps.length + 4);
}

/** True once the recovery has run past everything the guide describes. */
export function isPastGuide(op, isoDate, now = new Date()) {
  const week = weeksSinceSurgery(isoDate, now);
  if (!op || week == null) return false;
  return week > recoveryHorizonWeeks(op);
}

/** Which timeline step a recovery week falls on; null when there's no week. */
export function anchorIndex(week, steps) {
  if (week == null || !steps.length) return null;
  if (steps.some((s) => s.fromWeek != null)) {
    let idx = 0;
    steps.forEach((s, i) => { if ((s.fromWeek ?? 1) <= week) idx = i; });
    return idx;
  }
  return Math.min(Math.max(week - 1, 0), steps.length - 1);
}

/** "Week 1" → "W1", "Semaines 1 à 2" → "S1–2", "Month 6+" → "M6+". */
export function shortLabel(week) {
  const parts = week.split(" ").filter(Boolean);
  if (parts.length < 2) return week;
  const rest = parts.slice(1).join(" ")
    .replaceAll(" à ", "–").replaceAll(" to ", "–").replaceAll(" ", "");
  return parts[0].charAt(0) + rest;
}

// MARK: Bookmarks

/** Adds or removes a bookmark; at the cap the oldest makes room. */
export function togglePin(keys, key) {
  if (keys.includes(key)) return { keys: keys.filter((k) => k !== key), dropped: [] };
  const next = [...keys, key];
  const drop = Math.max(next.length - MAX_PINNED_OPS, 0);
  return { keys: next.slice(drop), dropped: next.slice(0, drop) };
}

/** The bookmarked operation whose guide runs longest. */
export function anchorOperation(operations, pinnedKeys) {
  let best = null;
  for (const op of operations) {
    if (!pinnedKeys.includes(op.key)) continue;
    if (!best || recoveryHorizonWeeks(op) > recoveryHorizonWeeks(best)) best = op;
  }
  return best;
}

/** Home-screen category order; unknown categories are appended, never dropped. */
export function sectionOrder(operations) {
  const present = operations.map((o) => o.category);
  const out = PREFERRED_SECTIONS.filter((c) => present.includes(c));
  for (const c of present) if (!out.includes(c)) out.push(c);
  return out;
}

// MARK: My path

export function pathwayKey(path, op) {
  if (op.pathway && path.pathways[op.pathway]) return op.pathway;
  return op.category === "catheter" ? "catheter" : "open";
}

function rank(key) {
  const i = PATHWAY_ORDER.indexOf(key);
  return i === -1 ? PATHWAY_ORDER.length : i;
}

/** Longest of the given pathway keys; unknown keys sort longest. */
export function longestPathwayKey(keys) {
  if (!keys.length) return null;
  return keys.reduce((a, b) => (rank(b) > rank(a) ? b : a));
}

/** The one pathway a combined procedure follows: the longest of its parts'. */
export function pathwayForCombined(path, ops) {
  const key = longestPathwayKey(ops.map((o) => pathwayKey(path, o)));
  if (key == null) return null;
  return path.pathways[key] || path.pathways.open || null;
}

/** Where the calendar alone would put the patient. */
export function estimatedPhase(pathway, pod) {
  let found = pathway.phases[0];
  for (const p of pathway.phases) if (p.fromDay <= pod) found = p;
  return found;
}

// MARK: Care-team number

/** A saved number reduced to what `tel:` accepts, or null. "ext. 2" becomes a pause. */
export function dialable(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  const marked = s.replace(/\s*(ext\.?|extension|poste|x)\s*(?=\d)/gi, ",");
  const digits = marked.replace(/[^0-9+*#,;]/g, "");
  return /\d/.test(digits) ? "tel:" + digits : null;
}
