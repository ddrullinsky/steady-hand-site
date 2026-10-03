// Data access. Every query runs as the signed-in user; Row Level Security on
// the server decides what comes back, so the UI only mirrors those rules.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';
import { byOrder } from './util.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Program configuration tables, all scoped by program_id.
export const CONFIG_TABLES = {
  categories: 'procedure_categories',
  procedures: 'procedures',
  tasks: 'procedural_tasks',
  taskSections: 'task_sections',
  approaches: 'approaches',
  roles: 'case_roles',
  attendings: 'attendings',
  fields: 'program_fields',
  targets: 'targets',
};

/** Shared app state. Views read from here; loaders fill it. */
export const state = {
  session: null,
  profile: null,          // own profiles row (is_admin)
  memberships: [],        // own program_members rows
  programs: [],           // programs this user can manage
  allPrograms: [],
  program: null,          // current program row
  sites: [],
  config: null,           // { categories, procedures, ... } + maps
  members: [],            // member_activity rows for the program
  cases: [],              // enriched cases for the program
  invitations: [],
  achievements: [],       // major achievement unlocks in the program, newest first
};

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/** Fetch every row of a query, 1000 at a time (PostgREST caps page size). */
async function fetchAll(makeQuery) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const rows = check(await makeQuery().range(from, from + size - 1));
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

export async function loadIdentity() {
  const uid = state.session.user.id;
  const [profiles, memberships, programs, sites] = await Promise.all([
    sb.from('profiles').select('id,email,full_name,is_admin').eq('id', uid),
    sb.from('program_members').select('program_id,role,pgy_year,active').eq('user_id', uid),
    sb.from('programs').select('id,slug,name,name_fr,status,sort_order').order('sort_order').order('name'),
    sb.from('sites').select('*').order('sort_order'),
  ]);
  state.profile = check(profiles)[0] || { id: uid, email: state.session.user.email, is_admin: false };
  state.memberships = check(memberships);
  state.allPrograms = check(programs);
  state.sites = check(sites);
  const directed = new Set(state.memberships
    .filter((m) => m.role === 'program_director' && m.active).map((m) => m.program_id));
  state.programs = state.profile.is_admin
    ? state.allPrograms
    : state.allPrograms.filter((p) => directed.has(p.id));
}

export async function loadSites() {
  state.sites = check(await sb.from('sites').select('*').order('sort_order'));
}

export async function loadConfig(pid = state.program.id) {
  const entries = await Promise.all(Object.entries(CONFIG_TABLES).map(async ([key, table]) => {
    const rows = await fetchAll(() => sb.from(table).select('*').eq('program_id', pid).order('sort_order'));
    return [key, rows.sort(byOrder)];
  }));
  const cfg = Object.fromEntries(entries);
  // id -> row lookups (inactive rows included so historical cases still display)
  cfg.byId = {};
  for (const key of Object.keys(CONFIG_TABLES)) cfg.byId[key] = new Map(cfg[key].map((r) => [r.id, r]));
  cfg.byId.sites = new Map(state.sites.map((s) => [s.id, s]));
  state.config = cfg;
  if (state.cases.length) enrichCases(state.cases);
  return cfg;
}

export async function loadMembers(pid = state.program.id) {
  state.members = await fetchAll(() => sb.from('member_activity').select('*').eq('program_id', pid));
}

export async function loadInvitations(pid = state.program.id) {
  state.invitations = check(await sb.from('invitations').select('*').eq('program_id', pid)
    .order('created_at', { ascending: false }));
}

export async function loadAchievements(pid = state.program.id) {
  state.achievements = check(await sb.from('achievement_unlocks')
    .select('id,user_id,achievement_id,display_name,unlocked_at')
    .eq('program_id', pid).order('unlocked_at', { ascending: false }).limit(500));
}

export async function loadCases(pid = state.program.id) {
  const rows = await fetchAll(() => sb.from('cases')
    .select('id,resident_id,case_date,site_id,attending_id,attending_name,urgency,approach_id,role_id,field_values,' +
            'case_procedures(procedure_id),case_tasks(task_id,count)')
    .eq('program_id', pid).eq('deleted', false)
    .order('case_date', { ascending: false }).order('id'));
  state.cases = enrichCases(rows);
}

/** Adds derived fields used by every view: procedure ids, category ids, task counts. */
function enrichCases(rows) {
  const procs = state.config?.byId.procedures || new Map();
  for (const c of rows) {
    c.procedureIds = (c.case_procedures || []).map((p) => p.procedure_id);
    c.categoryIds = [...new Set(c.procedureIds.map((id) => procs.get(id)?.category_id).filter(Boolean))];
    c.tasks = (c.case_tasks || []).map((t) => ({ task_id: t.task_id, count: t.count || 1 }));
    c.field_values = c.field_values || {};
  }
  return rows;
}

export async function loadProgram(program) {
  state.program = program;
  state.cases = [];
  await loadConfig(program.id);
  await Promise.all([loadMembers(program.id), loadCases(program.id), loadInvitations(program.id),
    loadAchievements(program.id)]);
}

// ---------------------------------------------------------------------------
// Writes. Each returns { data, error } like supabase-js so callers can explain
// failures (unique names, rows still used by cases, permissions).
// ---------------------------------------------------------------------------

export async function insertRow(table, row) {
  return sb.from(table).insert(row).select().single();
}

export async function updateRow(table, id, patch) {
  const res = await sb.from(table).update(patch).eq('id', id).select();
  if (!res.error && (!res.data || res.data.length === 0)) {
    return { data: null, error: { code: '42501', message: 'Not allowed.' } };
  }
  return { data: res.data?.[0], error: res.error };
}

export async function deleteRow(table, id) {
  const res = await sb.from(table).delete().eq('id', id).select('id');
  if (!res.error && (!res.data || res.data.length === 0)) {
    return { data: null, error: { code: '42501', message: 'Not allowed.' } };
  }
  return res;
}

/** Renumber sort_order 1..n for rows in the given order; only changed rows are written. */
export async function saveOrder(table, orderedRows) {
  const writes = [];
  orderedRows.forEach((r, i) => {
    if (r.sort_order !== i + 1) writes.push(updateRow(table, r.id, { sort_order: i + 1 }));
  });
  const results = await Promise.all(writes);
  return results.find((r) => r.error) || { error: null };
}

export async function updateMember(userId, patch) {
  const res = await sb.from('program_members').update(patch)
    .eq('program_id', state.program.id).eq('user_id', userId).select();
  if (!res.error && !res.data?.length) return { error: { code: '42501', message: 'Not allowed.' } };
  return res;
}
