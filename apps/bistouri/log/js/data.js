// Data and sync for the web logger. It follows the iPhone app
// (ios/Bistouri/AppState.swift and SyncEngine.swift):
// - Cases are saved on this device first (IndexedDB), then pushed one at a time
//   with the `save_case` RPC. The server keeps the newest edit (last write wins
//   on client_updated_at), so a `false` reply counts as synced.
// - Pull: the resident's own cases, merged without overwriting local edits that
//   have not been pushed yet.
// - The account and the program's lists are cached so the logger opens offline.
// Row Level Security on the server decides what every request may read or write.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../shared/config.js';
import { caseStore, kv, prefs } from './store.js';
import { emptyRef } from './ref.js';
import { ACHIEVEMENTS } from '../shared/achievementCatalogue.js';

/** Every major achievement, whatever the program, for the announcement feed. */
const MAJORS = new Map(ACHIEVEMENTS.filter((a) => a.tier === 'major').map((a) => [a.id, a]));

// supabase-js is loaded as a pinned UMD script in index.html (one file the
// service worker can keep for offline use).
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  // fetch is looked up on every call (not captured once), so it always uses the page's current fetch.
  global: { fetch: (...args) => fetch(...args) },
});

const AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

/** App state. Views read it; the functions below fill it and call `changed()`. */
export const state = {
  user: null,               // { id, email } of the signed-in user (from a live or stored session)
  programs: [],
  memberships: [],
  profileName: '',
  announceAnonymously: false,
  accountLoaded: false,
  accountError: null,
  activeProgramId: null,
  ref: emptyRef(),          // the active program's lists (active rows only)
  cases: [],                // every case of this user on this device, deleted ones included
  sync: { phase: 'idle', pending: 0, lastSynced: null }, // phase: idle | syncing | offline | error
  online: navigator.onLine,
  refreshing: false,
  announcements: [],        // the program's major unlocks, newest first
  announcementQueue: [],    // unlocks by others since last seen, oldest first
  celebration: [],          // achievements just earned, shown over the app
  accountDeleted: false,
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function changed(what = 'data') { for (const fn of listeners) fn(what); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Network failures (no signal, DNS, dropped connection) rather than refusals. */
export function isConnectivityError(err) {
  if (!navigator.onLine) return true;
  if (!err) return false;
  const text = `${err.name || ''} ${err.message || ''} ${err.details || ''}`.toLowerCase();
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|timed out|aborted/.test(text)
    || (err.status === 0);
}

/** Postgres timestamptz text to milliseconds (fraction trimmed to 3 digits, like the app). */
export function parseTs(text) {
  if (!text) return null;
  let s = String(text).replace(' ', 'T').replace(/\.(\d+)/, (_, d) => '.' + (d + '000').slice(0, 3));
  if (/[+-]\d\d$/.test(s)) s += ':00';
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** The session saved by supabase-js, read directly. Used to open offline when the
 *  access token has expired and cannot be refreshed without a connection. */
export function storedUser() {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
    const u = raw?.user || raw?.currentSession?.user;
    return u?.id ? { id: u.id, email: u.email || '' } : null;
  } catch { return null; }
}

export const activeProgram = () => state.programs.find((p) => p.id === state.activeProgramId) || null;
export const activeMembership = () => state.memberships.find((m) => m.program_id === state.activeProgramId) || null;
export const activeMemberships = () => state.memberships.filter((m) => m.active);

/** The resident's live cases in the active program, newest logged first. */
export function programCases() {
  return state.cases
    .filter((c) => c.program_id === state.activeProgramId && !c.deleted)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/** 'launching' | 'signedOut' | 'loadingAccount' | 'needsProgram' | 'ready' (as AppState.phase). */
export function phase() {
  if (!state.user) return 'signedOut';
  const active = activeMemberships();
  if (active.length) return 'ready';
  return state.accountLoaded ? 'needsProgram' : 'loadingAccount';
}

// ---------------------------------------------------------------------------
// Sign-in lifecycle
// ---------------------------------------------------------------------------

export async function didSignIn(user) {
  state.user = { id: user.id, email: user.email || '' };
  state.accountDeleted = false;
  await loadAccountCache();
  chooseActiveProgram();
  state.cases = await caseStore.all(state.user.id);
  countPending();
  changed('account');
  refreshAll();
}

export function didSignOut() {
  Object.assign(state, {
    user: null, programs: [], memberships: [], profileName: '', announceAnonymously: false,
    accountLoaded: false, accountError: null, activeProgramId: null, ref: emptyRef(), cases: [],
    sync: { phase: 'idle', pending: 0, lastSynced: null }, announcements: [], announcementQueue: [], celebration: [],
  });
  changed('account');
}

export async function signOut() {
  // Like the app: ends the session everywhere. Offline that fails, so at least forget it here.
  let error = null;
  try { ({ error } = await sb.auth.signOut()); } catch (err) { error = err; }
  if (error) { try { await sb.auth.signOut({ scope: 'local' }); } catch { /* nothing left to clear */ } }
  didSignOut();
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/** Programs, memberships, profile, then the active program's lists, unlocks, announcements and cases. */
export async function refreshAll() {
  if (state.refreshing || !state.user) return;
  state.refreshing = true;
  changed('sync');
  try {
    await refreshAccount();
    if (state.activeProgramId) await refreshReference(state.activeProgramId);
    await flushPendingUnlocks();
    if (state.activeProgramId) await refreshAnnouncements(state.activeProgramId);
    const pulled = await pullAndMerge();
    await pushPending();
    if (pulled && state.sync.phase === 'idle' && state.sync.pending === 0) state.sync.lastSynced = Date.now();
  } finally {
    state.refreshing = false;
    changed('sync');
  }
}

export async function refreshAccount() {
  const uid = state.user?.id;
  if (!uid) return;
  const [programs, memberships, profile] = await Promise.all([
    sb.from('programs').select('id,slug,name,name_fr,status,sort_order').order('sort_order'),
    sb.from('program_members').select('program_id,role,pgy_year,active').eq('user_id', uid),
    sb.from('profiles').select('full_name,announce_anonymously').eq('id', uid),
  ]);
  const error = programs.error || memberships.error || profile.error;
  if (error) {
    if (!state.accountLoaded) {
      state.accountError = "Couldn't reach Bistouri. Check your connection and try again.";
      changed('account');
    }
    return;
  }
  if (state.user?.id !== uid) return;
  state.programs = programs.data;
  state.memberships = memberships.data;
  state.profileName = profile.data[0]?.full_name ?? '';
  state.announceAnonymously = profile.data[0]?.announce_anonymously ?? false;
  state.accountLoaded = true;
  state.accountError = null;
  await saveAccountCache();
  chooseActiveProgram();
  changed('account');
}

async function saveAccountCache() {
  const { programs, memberships, profileName, announceAnonymously } = state;
  await kv.set(`account:${state.user.id}`, { programs, memberships, profileName, announceAnonymously });
}

async function loadAccountCache() {
  const cache = await kv.get(`account:${state.user.id}`);
  if (!cache) return;
  Object.assign(state, {
    programs: cache.programs || [], memberships: cache.memberships || [],
    profileName: cache.profileName || '', announceAnonymously: !!cache.announceAnonymously,
  });
}

/** Saved choice if still a member; otherwise a resident membership first, then program order. */
function chooseActiveProgram() {
  const uid = state.user?.id;
  if (!uid) return;
  const active = activeMemberships();
  const saved = prefs.get(`activeProgram.${uid}`);
  let pick = null;
  if (saved && active.some((m) => m.program_id === saved)) pick = saved;
  else {
    const order = new Map(state.programs.map((p) => [p.id, p.sort_order]));
    pick = [...active].sort((a, b) =>
      (a.role === 'program_director') - (b.role === 'program_director') || (order.get(a.program_id) ?? 999) - (order.get(b.program_id) ?? 999),
    )[0]?.program_id ?? null;
  }
  if (pick !== state.activeProgramId || state.ref.programId !== pick) {
    state.activeProgramId = pick;
    if (pick) prefs.set(`activeProgram.${uid}`, pick);
    loadReferenceCache(pick);
  }
}

export function setActiveProgram(id) {
  state.activeProgramId = id;
  prefs.set(`activeProgram.${state.user.id}`, id);
  state.announcements = [];
  state.announcementQueue = [];
  loadReferenceCache(id).then(() => changed('program'));
  refreshReference(id).then(() => refreshAnnouncements(id)).then(pushPending);
}

async function loadReferenceCache(pid) {
  if (!pid) { state.ref = emptyRef(); return; }
  state.ref = emptyRef(pid);
  const cached = await kv.get(`reference:${pid}`);
  if (cached && state.activeProgramId === pid) {
    state.ref = { ...emptyRef(pid), ...cached };
    changed('reference');
  }
}

/** The program's lists, active rows only, as the app fetches them. */
export async function refreshReference(pid) {
  const q = (table, cols, opts = {}) => {
    let query = sb.from(table).select(cols).eq('active', true);
    if (opts.program !== false) query = query.eq('program_id', pid);
    query = query.order('sort_order');
    if (opts.byName !== false) query = query.order('name');
    return query.limit(5000);
  };
  const [sites, categories, procedures, tasks, taskSections, approaches, roles, attendings, fields, targets] = await Promise.all([
    q('sites', 'id,name,short_name,sort_order', { program: false }),
    q('procedure_categories', 'id,name,sort_order'),
    q('procedures', 'id,category_id,name,sort_order,typical_task_ids'),
    q('procedural_tasks', 'id,name,sort_order,section_id,countable'),
    q('task_sections', 'id,name,sort_order,category_ids'),
    q('approaches', 'id,name,sort_order'),
    q('case_roles', 'id,name,sort_order'),
    q('attendings', 'id,name,sort_order'),
    q('program_fields', 'id,key,label,type,options,unit,min_value,max_value,required,sort_order', { byName: false }),
    q('targets', 'id,category_id,procedure_id,task_id,role_id,target_count,label,sort_order', { byName: false }),
  ]);
  const failed = [sites, categories, procedures, tasks, taskSections, approaches, roles, attendings, fields, targets].find((r) => r.error);
  if (failed) return; // offline or transient: keep the cached copy
  // EPAs and the program's one45 link are extras: a failure never blocks the lists.
  const [epas, program] = await Promise.all([
    sb.from('epas').select('id,code,title,stage,requirement,task_ids,procedure_ids,approach_ids,role_ids,sort_order')
      .eq('program_id', pid).eq('active', true).order('sort_order'),
    sb.from('programs').select('epa_url,pgy_stages').eq('id', pid),
  ]);
  const ref = {
    ...emptyRef(pid),
    sites: sites.data, categories: categories.data, procedures: procedures.data, tasks: tasks.data,
    taskSections: taskSections.data, approaches: approaches.data, roles: roles.data, attendings: attendings.data,
    fields: fields.data.map(normalizeField), targets: targets.data,
    epas: epas.error ? [] : epas.data,
    epaUrl: program.data?.[0]?.epa_url ?? null,
    pgyStages: program.data?.[0]?.pgy_stages ?? null,
    fetchedAt: Date.now(),
  };
  await kv.set(`reference:${pid}`, ref);
  if (state.activeProgramId === pid) {
    state.ref = ref;
    changed('reference');
  }
}

/** Options may be plain strings or {label|value} objects (as ProgramField decodes them). */
function normalizeField(f) {
  const options = (Array.isArray(f.options) ? f.options : []).map((o) => {
    if (typeof o === 'string') return o;
    if (o && typeof o === 'object') return o.label ?? o.value ?? null;
    if (typeof o === 'number' || typeof o === 'boolean') return String(o);
    return null;
  }).filter((o) => o !== null);
  return { ...f, options, required: !!f.required, sort_order: f.sort_order ?? 0 };
}

// ---------------------------------------------------------------------------
// Membership and profile
// ---------------------------------------------------------------------------

/** Joins a program as a resident (RLS only allows the resident role for yourself). */
export async function joinProgram(pid, pgy, fullName) {
  const uid = state.user.id;
  const { error } = await sb.from('program_members').upsert(
    { program_id: pid, user_id: uid, role: 'resident', pgy_year: pgy, active: true },
    { onConflict: 'program_id,user_id', returning: 'minimal' },
  );
  if (error) throw error;
  if (fullName?.trim()) { try { await updateName(fullName); } catch { /* the name can be set later */ } }
  await refreshAccount();
  if (!state.memberships.some((m) => m.program_id === pid)) {
    state.memberships.push({ program_id: pid, role: 'resident', pgy_year: pgy, active: true });
    await saveAccountCache();
  }
  setActiveProgram(pid);
  changed('account');
}

export async function updateName(name) {
  const trimmed = name.trim();
  const { error } = await sb.from('profiles').update({ full_name: trimmed }).eq('id', state.user.id);
  if (error) throw error;
  state.profileName = trimmed;
  await saveAccountCache();
  changed('account');
}

export async function updatePGY(year) {
  const pid = state.activeProgramId;
  const { error } = await sb.from('program_members').update({ pgy_year: year })
    .eq('program_id', pid).eq('user_id', state.user.id);
  if (error) throw error;
  const m = state.memberships.find((x) => x.program_id === pid);
  if (m) m.pgy_year = year;
  await saveAccountCache();
  changed('account');
}

export async function setAnnounceAnonymously(on) {
  const previous = state.announceAnonymously;
  state.announceAnonymously = on;
  const { error } = await sb.from('profiles').update({ announce_anonymously: on }).eq('id', state.user.id);
  if (error) {
    state.announceAnonymously = previous;
    changed('account');
    throw error;
  }
  await saveAccountCache();
  changed('account');
}

// ---------------------------------------------------------------------------
// Cases: local writes
// ---------------------------------------------------------------------------

/** Saves a case on this device and starts the upload. `c` is a full case record. */
export async function saveLocalCase(c) {
  c.client_updated_at = new Date().toISOString();
  c.needs_sync = true;
  c.last_sync_error = null;
  await caseStore.put(c);
  const i = state.cases.findIndex((x) => x.id === c.id);
  if (i >= 0) state.cases[i] = c; else state.cases.push(c);
  countPending();
  changed('cases');
  pushPending();
}

export async function softDeleteCase(c) {
  await saveLocalCase({ ...c, deleted: true });
}

function countPending() {
  state.sync.pending = state.cases.filter((c) => c.needs_sync).length;
}

/** The `save_case` payload (must match public.save_case and SyncEngine.payload). */
export function payload(c) {
  const name = (c.attending_name || '').trim();
  return {
    id: c.id,
    program_id: c.program_id,
    case_date: c.case_date,
    site_id: c.site_id || null,
    attending_id: c.attending_id || null,
    attending_name: name || null,
    urgency: c.urgency || null,
    approach_id: c.approach_id || null,
    role_id: c.role_id || null,
    field_values: c.field_values || {},
    deleted: !!c.deleted,
    client_updated_at: c.client_updated_at,
    procedure_ids: c.procedure_ids,
    tasks: c.tasks.filter((t) => t.count > 0),
  };
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

let pushing = false;
let pushAgain = false;
let retryTimer = null;
let retryDelay = 5000;

export async function pushPending() {
  if (!state.user) return;
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  try {
    do {
      pushAgain = false;
      const uid = state.user?.id;
      const pending = state.cases.filter((c) => c.needs_sync && c.owner_id === uid)
        .sort((a, b) => a.client_updated_at.localeCompare(b.client_updated_at));
      state.sync.pending = pending.length;
      if (!pending.length) {
        if (state.sync.phase !== 'idle') { state.sync.phase = 'idle'; changed('sync'); }
        return;
      }
      state.sync.phase = 'syncing';
      changed('sync');
      let failure = null;
      for (const c of pending) {
        const stamp = c.client_updated_at;
        const { error } = await saveCase(payload(c));
        if (!error) {
          // Only clear the flag if nothing changed while the request was in flight.
          const current = state.cases.find((x) => x.id === c.id);
          if (current && current.client_updated_at === stamp) {
            current.needs_sync = false;
            current.last_sync_error = null;
            await caseStore.put(current);
          }
          continue;
        }
        if (isConnectivityError(error)) { failure = 'offline'; break; }
        c.last_sync_error = error.message || 'Sync failed';
        await caseStore.put(c);
        failure = 'error';
      }
      countPending();
      if (failure) {
        state.sync.phase = failure;
        scheduleRetry();
      } else {
        state.sync.phase = 'idle';
        state.sync.lastSynced = Date.now();
        retryDelay = 5000;
      }
      changed('sync');
    } while (pushAgain);
  } finally {
    pushing = false;
  }
}

/** One RPC per case, retried twice on a dropped connection. */
async function saveCase(body) {
  for (let attempt = 1; ; attempt++) {
    const res = await sb.rpc('save_case', { payload: body });
    if (!res.error || attempt >= 3 || !navigator.onLine || !isConnectivityError(res.error)) return res;
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
}

/** Backs off 5 s, 10 s, 20 s … up to 5 min while cases are waiting. */
function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, 300000);
  retryTimer = setTimeout(() => { if (state.sync.pending > 0) pushPending(); }, delay);
}

// ---------------------------------------------------------------------------
// Pull and merge
// ---------------------------------------------------------------------------

/** Returns false if the server couldn't be read. */
export async function pullAndMerge() {
  const uid = state.user?.id;
  if (!uid) return false;
  const remote = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const { data, error } = await sb.from('cases')
      .select('id,program_id,case_date,site_id,attending_id,attending_name,urgency,approach_id,role_id,field_values,' +
              'deleted,client_updated_at,created_at,updated_at,case_procedures(procedure_id),case_tasks(task_id,count)')
      .eq('resident_id', uid).order('id').range(from, from + size - 1);
    if (error) {
      if (isConnectivityError(error)) { state.sync.phase = 'offline'; changed('sync'); }
      return false;
    }
    remote.push(...data);
    if (data.length < size) break;
  }
  if (state.user?.id !== uid) return false;

  const byId = new Map(state.cases.map((c) => [c.id, c]));
  const writes = [];
  for (const r of remote) {
    const remoteStamp = parseTs(r.client_updated_at) ?? parseTs(r.updated_at) ?? 0;
    const local = byId.get(r.id);
    if (local) {
      const localStamp = parseTs(local.client_updated_at) ?? 0;
      // An unsynced local edit that is at least as new wins; it will be pushed.
      if (local.needs_sync && localStamp >= remoteStamp) continue;
      if (!local.needs_sync && localStamp === remoteStamp) continue;
    } else if (r.deleted) {
      continue;
    }
    const merged = {
      ...(local || {}),
      id: r.id,
      owner_id: uid,
      program_id: r.program_id,
      case_date: r.case_date,
      site_id: r.site_id,
      attending_id: r.attending_id,
      attending_name: r.attending_name,
      urgency: r.urgency,
      approach_id: r.approach_id,
      role_id: r.role_id,
      field_values: r.field_values || {},
      deleted: r.deleted,
      procedure_ids: (r.case_procedures || []).map((p) => p.procedure_id),
      tasks: (r.case_tasks || []).map((t) => ({ task_id: t.task_id, count: t.count || 1 })),
      client_updated_at: new Date(remoteStamp).toISOString(),
      created_at: local?.created_at || r.created_at || new Date(remoteStamp).toISOString(),
      needs_sync: false,
      last_sync_error: null,
    };
    byId.set(r.id, merged);
    writes.push(merged);
  }
  if (writes.length) {
    await caseStore.putMany(writes);
    state.cases = [...byId.values()];
    countPending();
    changed('cases');
  }
  return true;
}

// ---------------------------------------------------------------------------
// Achievement unlocks and program announcements (AppState.announce …)
// ---------------------------------------------------------------------------

const unlocksKey = () => `unlocks:${state.user.id}`;

/** Queues newly earned major achievements for announcement and sends them now if possible. */
export async function announce(achievementIds, programId) {
  if (!state.user || !achievementIds.length) return;
  const pending = (await kv.get(unlocksKey())) || [];
  for (const id of achievementIds) {
    if (!pending.some((p) => p.program_id === programId && p.achievement_id === id)) {
      pending.push({ program_id: programId, achievement_id: id });
    }
  }
  await kv.set(unlocksKey(), pending);
  await flushPendingUnlocks();
  if (state.activeProgramId === programId) await refreshAnnouncements(programId);
}

/** Records queued unlocks (once per achievement and program) and asks the server to email the admins.
 *  The server fills in who, when and the display name (null when announcing anonymously). */
export async function flushPendingUnlocks() {
  if (!state.user) return;
  const key = unlocksKey();
  const remaining = [];
  for (const p of (await kv.get(key)) || []) {
    const { data, error } = await sb.from('achievement_unlocks')
      .upsert({ program_id: p.program_id, achievement_id: p.achievement_id },
        { onConflict: 'user_id,program_id,achievement_id', ignoreDuplicates: true })
      .select('id');
    if (error) {
      // Retry later when offline; drop anything the server refuses (e.g. left the program).
      if (isConnectivityError(error)) remaining.push(p);
      continue;
    }
    // Empty when it was already recorded: announced and emailed before.
    const id = data?.[0]?.id;
    if (id) {
      try { await sb.functions.invoke('notify-achievement', { body: { unlock_id: id } }); } catch { /* best effort */ }
    }
  }
  await kv.set(key, remaining);
}

/** The program's announcement feed. Unlocks by others since last seen are queued to pop up. */
export async function refreshAnnouncements(pid) {
  const uid = state.user?.id;
  if (!uid) return;
  const { data, error } = await sb.from('achievement_unlocks')
    .select('id,user_id,achievement_id,display_name,unlocked_at')
    .eq('program_id', pid).order('unlocked_at', { ascending: false }).limit(50);
  if (error || state.activeProgramId !== pid) return;
  const items = data.filter((r) => MAJORS.has(r.achievement_id)).map((r) => ({
    id: r.id, isMine: r.user_id === uid, achievement: MAJORS.get(r.achievement_id),
    name: r.display_name, date: parseTs(r.unlocked_at) ?? Date.now(),
  }));
  state.announcements = items;
  const seenKey = `announcementsSeen.${uid}.${pid}`;
  const seen = prefs.get(seenKey);
  // On the first load nothing pops up: the feed starts from here, not the whole history.
  if (seen !== null) {
    const queued = new Set(state.announcementQueue.map((a) => a.id));
    state.announcementQueue.push(...items.filter((a) => !a.isMine && a.date > seen && !queued.has(a.id)).reverse());
  }
  prefs.set(seenKey, Math.max(items[0]?.date ?? Date.now(), seen ?? 0));
  changed('announcements');
}

// ---------------------------------------------------------------------------
// Account deletion (AppState.sendDeletionCode … deleteVerifiedAccount)
// ---------------------------------------------------------------------------

export async function sendDeletionCode() {
  const { error } = await sb.auth.signInWithOtp({ email: state.user.email, options: { shouldCreateUser: false } });
  if (error) throw error;
}

/** Verifying the code issues a fresh session; `delete_my_account` refuses unless the
 *  session's email-code (or password) sign-in is under 10 minutes old. */
export async function verifyDeletionCode(code) {
  const { error } = await sb.auth.verifyOtp({ email: state.user.email, token: code, type: 'email' });
  if (error) throw error;
}

export async function verifyDeletionPassword(password) {
  const { error } = await sb.auth.signInWithPassword({ email: state.user.email, password });
  if (error) throw error;
}

/** Deletes the account and everything synced to it (cascades on the server), then
 *  erases this user's cases and caches from this device and signs out. */
export async function deleteVerifiedAccount() {
  const uid = state.user.id;
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw error;
  await caseStore.removeOwner(uid);
  await kv.del(`account:${uid}`);
  await kv.del(`unlocks:${uid}`);
  prefs.removeWhere((k) => k.includes(uid));
  state.accountDeleted = true; // the sign-in screen confirms it
  await signOut();
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

window.addEventListener('online', () => {
  state.online = true;
  changed('sync');
  // Refreshes an expired token first, then uploads anything waiting.
  sb.auth.getSession().finally(() => refreshAll());
});
window.addEventListener('offline', () => {
  state.online = false;
  if (state.sync.pending > 0) state.sync.phase = 'offline';
  changed('sync');
});
