// Pure calculations over state.cases / state.config. No DOM here.
import { state } from './api.js';
import { byOrder, personName } from './util.js';

export function residents({ includeInactive = false } = {}) {
  return state.members.filter((m) => m.role === 'resident' && (includeInactive || m.active));
}

export function casesByResident(cases = state.cases) {
  const map = new Map();
  for (const c of cases) {
    if (!map.has(c.resident_id)) map.set(c.resident_id, []);
    map.get(c.resident_id).push(c);
  }
  return map;
}

export function inRange(cases, from, to) {
  return cases.filter((c) => (!from || c.case_date >= from) && (!to || c.case_date <= to));
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const nameOf = (map, id, fallback = '') => (id && map.get(id)?.name) || fallback;

export function siteName(id) {
  const s = state.config.byId.sites.get(id);
  return s ? (s.short_name || s.name) : '';
}
export const roleName = (id) => nameOf(state.config.byId.roles, id, 'Role not recorded');
export const approachName = (id) => nameOf(state.config.byId.approaches, id);
export const categoryName = (id) => nameOf(state.config.byId.categories, id);
export const procedureName = (id) => nameOf(state.config.byId.procedures, id, 'Unknown procedure');
export const taskName = (id) => nameOf(state.config.byId.tasks, id, 'Unknown task');

export function attendingName(c) {
  return nameOf(state.config.byId.attendings, c.attending_id) || c.attending_name || '';
}

export function memberName(userId) {
  const m = state.members.find((x) => x.user_id === userId);
  return m ? personName(m) : 'Unknown';
}

export function urgencyLabel(u) {
  return u ? u[0].toUpperCase() + u.slice(1) : '';
}

/** Program fields that appear in cases (active first, then inactive ones that have values). */
export function displayFields(cases = state.cases) {
  const used = new Set();
  for (const c of cases) for (const k of Object.keys(c.field_values)) used.add(k);
  return state.config.fields.filter((f) => f.active || used.has(f.key)).sort(byOrder);
}

export function fieldValueText(field, value) {
  if (value === null || value === undefined || value === '') return '';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  return field.unit && field.type === 'number' ? `${value} ${field.unit}` : String(value);
}

export function tasksText(c, sep = '; ') {
  const order = state.config.byId.tasks;
  return [...c.tasks].sort((a, b) => (order.get(a.task_id)?.sort_order ?? 0) - (order.get(b.task_id)?.sort_order ?? 0)).map((t) => `${taskName(t.task_id)}${t.count > 1 ? ` ×${t.count}` : ''}`).join(sep);
}

export function proceduresText(c) {
  return c.procedureIds.map(procedureName).join('; ');
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export function targetKind(t) {
  return t.category_id ? 'category' : t.procedure_id ? 'procedure' : 'task';
}

export function targetSubject(t) {
  if (t.category_id) return categoryName(t.category_id) || 'Deleted category';
  if (t.procedure_id) return procedureName(t.procedure_id);
  return taskName(t.task_id);
}

export function targetTitle(t) {
  if (t.label) return t.label;
  const role = t.role_id ? ` — ${roleName(t.role_id)}` : '';
  return `${targetSubject(t)}${role}`;
}

export function targetDetail(t) {
  const what = { category: 'Category', procedure: 'Procedure', task: 'Procedural task' }[targetKind(t)];
  const unit = t.task_id ? 'times performed' : 'cases';
  return `${what}: ${targetSubject(t)} · ${t.role_id ? roleName(t.role_id) : 'any role'} · ${t.target_count} ${unit}`;
}

/** How many cases (or task repetitions) count toward a target. */
export function targetCount(t, cases) {
  let n = 0;
  for (const c of cases) {
    if (t.role_id && c.role_id !== t.role_id) continue;
    if (t.category_id) { if (c.categoryIds.includes(t.category_id)) n++; }
    else if (t.procedure_id) { if (c.procedureIds.includes(t.procedure_id)) n++; }
    else if (t.task_id) {
      for (const k of c.tasks) if (k.task_id === t.task_id) n += k.count;
    }
  }
  return n;
}

export function activeTargets() {
  return state.config.targets.filter((t) => t.active).sort(byOrder);
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export function countBy(cases, keyFn) {
  const m = new Map();
  for (const c of cases) {
    for (const k of [].concat(keyFn(c))) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export function taskTotals(cases) {
  const m = new Map();
  for (const c of cases) for (const t of c.tasks) m.set(t.task_id, (m.get(t.task_id) || 0) + t.count);
  return m;
}

/** Roles in display order (config order), plus a trailing null for "not recorded" when needed. */
export function roleOrder(cases) {
  const roles = [...state.config.roles].sort(byOrder);
  const used = new Set(cases.map((c) => c.role_id));
  const list = roles.filter((r) => r.active || used.has(r.id)).map((r) => r.id);
  if (used.has(null) || used.has(undefined)) list.push(null);
  return list;
}

// Ordinal teal ramps (validated with the dataviz palette checker): the most
// responsible role (first in the program's order) gets the strongest step.
const RAMP_LIGHT = ['#0a4a45', '#0f6b64', '#2a8a80', '#4fa69b', '#7cbfb6'];
const RAMP_DARK = ['#d6f0ec', '#8fd3c9', '#4fb3a6', '#23897f', '#155e58'];

export function roleColors(roleIds) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const ramp = dark ? RAMP_DARK : RAMP_LIGHT;
  const named = roleIds.filter((id) => id !== null);
  return roleIds.map((id) => {
    if (id === null) return dark ? '#5b6664' : '#b8c0bf';
    const i = named.indexOf(id);
    if (named.length <= ramp.length) {
      // spread across the ramp so 3 roles still use strong contrast
      const pos = named.length === 1 ? 0 : Math.round((i * (ramp.length - 1)) / (named.length - 1));
      return ramp[pos];
    }
    return ramp[Math.min(ramp.length - 1, Math.floor((i * ramp.length) / named.length))];
  });
}

/** PGY groups present among residents, ascending, unassigned last. */
export function pgyGroups(list) {
  const set = new Set(list.map((r) => r.pgy_year || 0));
  return [...set].sort((a, b) => (a || 99) - (b || 99));
}
