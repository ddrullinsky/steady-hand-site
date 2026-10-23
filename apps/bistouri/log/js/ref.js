// The active program's lists and the counting rules built on them. Ports of
// ReferenceData (ios/Bistouri/Models.swift) and CaseStats (Stats.swift).
import { residentAchievements } from '../shared/achievementEngine.js';
import { today, addDays } from '../shared/util.js';

export function emptyRef(programId = null) {
  return {
    programId, sites: [], categories: [], procedures: [], tasks: [], taskSections: [], approaches: [],
    roles: [], attendings: [], fields: [], targets: [], epas: [], epaUrl: null, pgyStages: null, fetchedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const find = (list, id) => (id ? list.find((x) => x.id === id) : null);
export const procedure = (ref, id) => find(ref.procedures, id);
export const procedureName = (ref, id) => procedure(ref, id)?.name ?? null;
export const nameIn = (list, id) => find(list, id)?.name ?? null;
export const categoryOf = (ref, procId) => procedure(ref, procId)?.category_id ?? null;
export const siteShort = (site) => (site ? (site.short_name?.trim() ? site.short_name : site.name) : '');

export function procedureIdsInCategory(ref, catId) {
  return new Set(ref.procedures.filter((p) => p.category_id === catId).map((p) => p.id));
}

/** Categories with their procedures, in program order (empty categories left out). */
export function proceduresByCategory(ref) {
  return ref.categories
    .map((category) => ({ category, procedures: ref.procedures.filter((p) => p.category_id === category.id) }))
    .filter((g) => g.procedures.length);
}

/** Category name for a filter chip: "Valve procedures" -> "Valve". */
export const categoryChipName = (name) => (/. procedures$/i.test(name) ? name.slice(0, -' procedures'.length) : name);

/** A role whose name says primary, otherwise the program's first role. */
export function primaryRoleId(ref) {
  return (ref.roles.find((r) => /primary/i.test(r.name)) || ref.roles[0])?.id ?? null;
}

export function attendingName(ref, c) {
  return nameIn(ref.attendings, c.attending_id) ?? c.attending_name ?? '';
}

export const URGENCIES = [
  { id: 'elective', label: 'Elective' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'emergent', label: 'Emergent' },
];
export const urgencyLabel = (u) => URGENCIES.find((x) => x.id === u)?.label ?? '';

// ---------------------------------------------------------------------------
// EPAs
// ---------------------------------------------------------------------------

export const STAGE_NAMES = { 1: 'Transition to Discipline', 2: 'Foundations', 3: 'Core', 4: 'Transition to Practice' };

/**
 * EPAs worth requesting for a case: a ticked task links it (any role), or one of its
 * procedures or approaches in one of its roles (any role when it lists none), or, for
 * an EPA with roles but no procedures or approaches, the role alone.
 */
export function suggestedEPAs(ref, { roleId, procedureIds, approachId, taskIds }) {
  const procs = new Set(procedureIds);
  const tasks = new Set(taskIds);
  return (ref.epas || []).filter((epa) => {
    if ((epa.task_ids || []).some((t) => tasks.has(t))) return true;
    const roles = epa.role_ids || [];
    const roleOK = roles.length === 0 || (roleId && roles.includes(roleId));
    const epaProcs = epa.procedure_ids || [];
    const epaApproaches = epa.approach_ids || [];
    if (!epaProcs.length && !epaApproaches.length) return roles.length > 0 && roleOK;
    const caseOK = epaProcs.some((p) => procs.has(p)) || (approachId && epaApproaches.includes(approachId));
    return roleOK && caseOK;
  }).sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * CBD stages a resident is likely working on in a PGY year (null: unknown, show all).
 * The program's own map (`programs.pgy_stages`) wins; without one, the default fits
 * cardiac surgery's 6 years.
 */
export function stagesFor(pgy, programMap) {
  if (programMap) {
    const stages = pgy ? programMap[String(pgy)] : null;
    return stages ? new Set(stages) : null;
  }
  if (pgy === 1) return new Set([1, 2]);
  if (pgy === 2) return new Set([2, 3]);
  if (pgy >= 3 && pgy <= 5) return new Set([3]);
  if (pgy >= 6) return new Set([3, 4]);
  return null;
}

/** The case's EPAs split into the resident's likely stages and the rest. */
export function epasForCase(ref, pgy, caseLike) {
  const all = suggestedEPAs(ref, caseLike);
  const stages = stagesFor(pgy, ref.pgyStages);
  const mine = stages ? all.filter((e) => stages.has(e.stage)) : all;
  return { mine, others: all.filter((e) => !mine.includes(e)) };
}

// ---------------------------------------------------------------------------
// Progress (CaseStats)
// ---------------------------------------------------------------------------

export function targetTitle(ref, t) {
  if (t.label?.trim()) return t.label;
  let base = 'Target';
  if (t.category_id) base = nameIn(ref.categories, t.category_id) ?? base;
  if (t.procedure_id) base = procedureName(ref, t.procedure_id) ?? base;
  if (t.task_id) base = nameIn(ref.tasks, t.task_id) ?? base;
  const role = nameIn(ref.roles, t.role_id);
  return role ? `${base} · ${role}` : base;
}

export function targetCount(ref, t, cases) {
  const matching = cases.filter((c) => !t.role_id || c.role_id === t.role_id);
  if (t.category_id) {
    const procs = procedureIdsInCategory(ref, t.category_id);
    return matching.filter((c) => c.procedure_ids.some((p) => procs.has(p))).length;
  }
  if (t.procedure_id) return matching.filter((c) => c.procedure_ids.includes(t.procedure_id)).length;
  if (t.task_id) return matching.reduce((s, c) => s + c.tasks.filter((k) => k.task_id === t.task_id).reduce((a, k) => a + k.count, 0), 0);
  return 0;
}

/** Monday of the ISO week containing a 'YYYY-MM-DD' date. */
function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).getDay(); // 0 Sunday
  return addDays(iso, -((weekday + 6) % 7));
}

export function caseStats(ref, cases) {
  const t = today();
  const primary = primaryRoleId(ref);
  const targets = ref.targets.map((tg) => {
    const count = targetCount(ref, tg, cases);
    const goal = tg.target_count;
    return { id: tg.id, title: targetTitle(ref, tg), count, goal, fraction: goal > 0 ? count / goal : 0, done: count >= goal };
  });
  const byCategory = ref.categories.map((cat) => {
    const procs = procedureIdsInCategory(ref, cat.id);
    return { name: cat.name, count: cases.filter((c) => c.procedure_ids.some((p) => procs.has(p))).length };
  }).filter((r) => r.count > 0);
  const byRole = ref.roles.map((r) => ({ name: r.name, count: cases.filter((c) => c.role_id === r.id).length })).filter((r) => r.count > 0);
  const noRole = cases.filter((c) => !c.role_id).length;
  if (noRole) byRole.push({ name: 'No role', count: noRole });
  const taskTotals = new Map();
  for (const c of cases) for (const k of c.tasks) taskTotals.set(k.task_id, (taskTotals.get(k.task_id) || 0) + k.count);
  const topTasks = [...taskTotals].map(([id, count]) => ({ name: nameIn(ref.tasks, id), count }))
    .filter((r) => r.name).sort((a, b) => b.count - a.count).slice(0, 8);

  // Consecutive weeks (ending this week or last week) with at least one case.
  const weeks = new Set(cases.map((c) => weekStart(c.case_date)));
  const thisWeek = weekStart(t);
  let cursor = weeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let streak = 0;
  while (weeks.has(cursor)) { streak++; cursor = addDays(cursor, -7); }

  return {
    total: cases.length,
    thisMonth: cases.filter((c) => c.case_date.slice(0, 7) === t.slice(0, 7)).length,
    asPrimary: primary ? cases.filter((c) => c.role_id === primary).length : 0,
    weekStreak: streak,
    targets, byCategory, byRole, topTasks,
  };
}

// ---------------------------------------------------------------------------
// Achievements (the dashboard's engine, fed the app's view of the program)
// ---------------------------------------------------------------------------

/** A local case in the shape the shared engine reads. */
function engineCase(c) {
  return {
    case_date: c.case_date, created_at: c.created_at, role_id: c.role_id, site_id: c.site_id,
    attending_id: c.attending_id, attending_name: c.attending_name ? c.attending_name.trim().toLowerCase() : null,
    approach_id: c.approach_id, urgency: c.urgency, procedureIds: c.procedure_ids, tasks: c.tasks,
    field_values: c.field_values || {},
  };
}

export function achievements(ref, cases) {
  const config = {
    categories: ref.categories, procedures: ref.procedures, tasks: ref.tasks, roles: ref.roles,
    approaches: ref.approaches, fields: ref.fields, targets: ref.targets,
  };
  return residentAchievements(cases.map(engineCase), config).map((a) => ({
    ...a,
    isMajor: a.tier === 'major',
    isSecret: !!a.hidden && !a.earned,
    displayTitle: a.hidden && !a.earned ? '???' : a.title,
    progress: a.need !== undefined && !a.earned ? `${a.have} / ${a.need}` : null,
  }));
}

/** Achievements earned by `after` that `before` had not, majors first (AchievementEngine.newlyEarned). */
export function newlyEarned(ref, before, after) {
  const had = new Set(achievements(ref, before).filter((a) => a.earned).map((a) => a.id));
  return achievements(ref, after).filter((a) => a.earned && !had.has(a.id))
    .sort((a, b) => (b.isMajor ? 1 : 0) - (a.isMajor ? 1 : 0));
}

