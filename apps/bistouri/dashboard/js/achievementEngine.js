// Achievements, computed from a resident's cases the way the app does it
// (AchievementEngine in ios/Bistouri/Achievements.swift). Keep the rules in step
// with the app; texts come from the generated catalogue.
import { state } from './api.js';
import { byOrder } from './util.js';
import { ACHIEVEMENTS } from './achievementCatalogue.js';

const CATALOGUE = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
const DAY = 86400000;

/** Day number of a 'YYYY-MM-DD' date (timezone-free). */
function dayNo(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
}
/** Day number of a timestamp's local calendar date. */
function localDayNo(ts) {
  const t = new Date(ts);
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY;
}

/** What the app sees: active rows only, in order. */
function refData() {
  const cfg = state.config;
  const active = (rows) => rows.filter((r) => r.active !== false).sort(byOrder);
  const ref = {
    categories: active(cfg.categories), procedures: active(cfg.procedures), tasks: active(cfg.tasks),
    roles: active(cfg.roles), approaches: active(cfg.approaches), fields: active(cfg.fields),
    targets: active(cfg.targets),
  };
  ref.categoryOf = new Map(ref.procedures.map((p) => [p.id, p.category_id]));
  ref.primaryRoleID = (ref.roles.find((r) => /primary/i.test(r.name)) || ref.roles[0])?.id ?? null;
  return ref;
}

/** The specialty whose achievements this program gets, matched like the rules below. */
export function programSpecialty() {
  const procs = state.config?.procedures ?? [];
  if (procs.some((p) => p.name.startsWith('CABGx'))) return 'cardiac';
  if (procs.some((p) => p.name === 'EVAR')) return 'vascular';
  return null;
}

/** The catalogue entries that apply to this program: general ones plus its specialty's. */
export function programCatalogue() {
  const specialty = programSpecialty();
  return ACHIEVEMENTS.filter((a) => !a.specialty || a.specialty === specialty);
}

function targetTitle(t, ref) {
  if (t.label?.trim()) return t.label;
  const name = (list, id) => list.find((x) => x.id === id)?.name;
  let base = 'Target';
  if (t.category_id) base = name(ref.categories, t.category_id) ?? base;
  if (t.procedure_id) base = name(ref.procedures, t.procedure_id) ?? base;
  if (t.task_id) base = name(ref.tasks, t.task_id) ?? base;
  const role = t.role_id && name(ref.roles, t.role_id);
  return role ? `${base} · ${role}` : base;
}

function targetCount(t, cases, ref) {
  let n = 0;
  for (const c of cases) {
    if (t.role_id && c.role_id !== t.role_id) continue;
    if (t.category_id) { if (c.procedureIds.some((p) => ref.categoryOf.get(p) === t.category_id)) n++; }
    else if (t.procedure_id) { if (c.procedureIds.includes(t.procedure_id)) n++; }
    else if (t.task_id) { for (const k of c.tasks) if (k.task_id === t.task_id) n += k.count; }
  }
  return n;
}

function facts(cases, ref) {
  const f = {
    total: cases.length, primary: 0, roleCounts: new Map(), weekend: false, nocturnal: false, archaeologist: false,
    backlog: false, backFromTheDead: false, holiday: false, friday13: false, leapDay: false, urgentCount: 0,
    sites: new Set(), approachesUsed: new Set(), numbers: {}, categoriesLogged: new Set(),
  };
  const perDay = new Map(), perAttending = new Map(), perSite = new Map(), procedures = new Set(), weeks = new Set();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const c of cases) {
    const day = dayNo(c.case_date);
    bump(perDay, day);
    if (c.role_id) bump(f.roleCounts, c.role_id);
    const attending = c.attending_id || (c.attending_name ? c.attending_name : null);
    if (attending) bump(perAttending, attending);
    if (c.site_id) { bump(perSite, c.site_id); f.sites.add(c.site_id); }
    if (c.approach_id) f.approachesUsed.add(c.approach_id);
    if (c.urgency === 'urgent' || c.urgency === 'emergent') f.urgentCount++;
    for (const p of c.procedureIds) {
      procedures.add(p);
      const cat = ref.categoryOf.get(p);
      if (cat) f.categoriesLogged.add(cat);
    }
    for (const [k, v] of Object.entries(c.field_values || {})) {
      if (typeof v === 'number') f.numbers[k] = Math.max(f.numbers[k] ?? 0, v);
    }

    const [y, m, d] = c.case_date.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday
    if (weekday === 0 || weekday === 6) f.weekend = true;
    if (weekday === 5 && d === 13) f.friday13 = true;
    if (m === 2 && d === 29) f.leapDay = true;
    if ([[12, 24], [12, 25], [12, 26], [12, 31], [1, 1]].some(([hm, hd]) => hm === m && hd === d)) f.holiday = true;
    weeks.add(day - ((weekday + 6) % 7)); // ISO week, starting Monday
    if (c.created_at) {
      if (new Date(c.created_at).getHours() < 5) f.nocturnal = true;
      if (localDayNo(c.created_at) - day >= 30) f.archaeologist = true;
    }
  }
  if (ref.primaryRoleID) f.primary = f.roleCounts.get(ref.primaryRoleID) || 0;
  const max = (m) => Math.max(0, ...m.values());
  f.maxCasesOnOneDay = max(perDay);
  f.maxWithOneAttending = max(perAttending);
  f.distinctAttendings = perAttending.size;
  f.maxAtOneSite = max(perSite);
  f.distinctProcedures = procedures.size;

  // Consecutive days, and a gap of 21+ empty days before a case.
  f.longestDayRun = 0;
  let run = 0, prev = null;
  for (const day of [...perDay.keys()].sort((a, b) => a - b)) {
    run = prev !== null && day - prev === 1 ? run + 1 : 1;
    if (prev !== null && day - prev >= 22) f.backFromTheDead = true;
    f.longestDayRun = Math.max(f.longestDayRun, run);
    prev = day;
  }
  f.longestWeekRun = 0;
  run = 0; prev = null;
  for (const w of [...weeks].sort((a, b) => a - b)) {
    run = prev !== null && w - prev === 7 ? run + 1 : 1;
    f.longestWeekRun = Math.max(f.longestWeekRun, run);
    prev = w;
  }

  // Five cases entered within 15 minutes.
  const logged = cases.map((c) => Date.parse(c.created_at)).filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 0; i + 4 < logged.length; i++) if (logged[i + 4] - logged[i] <= 15 * 60000) { f.backlog = true; break; }

  // The same procedure in consecutive cases.
  f.longestSameProcedureRun = 0;
  let runs = new Map();
  const ordered = [...cases].sort((a, b) => a.case_date.localeCompare(b.case_date) || String(a.created_at).localeCompare(String(b.created_at)));
  for (const c of ordered) {
    const next = new Map();
    for (const p of new Set(c.procedureIds)) next.set(p, (runs.get(p) || 0) + 1);
    runs = next;
    f.longestSameProcedureRun = Math.max(f.longestSameProcedureRun, max(runs));
  }

  f.targets = ref.targets.map((t) => {
    const count = targetCount(t, cases, ref);
    return { id: t.id, title: targetTitle(t, ref), count, goal: t.target_count, done: count >= t.target_count };
  });
  return f;
}

/** Every achievement the resident can see in the app, with earned and progress. */
export function residentAchievements(cases) {
  const ref = refData();
  const f = facts(cases, ref);
  const out = [];
  const add = (id, earned) => out.push({ ...CATALOGUE.get(id), id, earned: !!earned });
  const count = (id, have, need) => out.push({ ...CATALOGUE.get(id), id, earned: have >= need, have, need });

  const role = (re) => ref.roles.find((r) => re.test(r.name))?.id;
  const approach = (re) => ref.approaches.find((a) => re.test(a.name))?.id;
  const procs = (match) => new Set(ref.procedures.filter((p) => (Array.isArray(match) ? match.includes(p.name) : match(p.name))).map((p) => p.id));
  const procsInCategory = (name) => {
    const cat = ref.categories.find((c) => c.name === name);
    return new Set(cat ? ref.procedures.filter((p) => p.category_id === cat.id).map((p) => p.id) : []);
  };
  const tasks = (names) => new Set(ref.tasks.filter((t) => names.includes(t.name)).map((t) => t.id));
  const casesWith = (ids, primaryOnly = false) => (!ids.size ? 0 : cases.filter((c) =>
    (!primaryOnly || (ref.primaryRoleID && c.role_id === ref.primaryRoleID)) && c.procedureIds.some((p) => ids.has(p))).length);
  const taskTotal = (ids) => cases.reduce((s, c) => s + c.tasks.filter((t) => ids.has(t.task_id)).reduce((a, t) => a + t.count, 0), 0);

  // Case totals
  count('tutorial-complete', f.total, 1);
  count('double-digits', f.total, 10);
  count('quarter-century', f.total, 25);
  count('halfway', f.total, 50);
  count('centurion', f.total, 100);
  count('club-250', f.total, 250);
  count('furniture-no-longer', f.total, 500);
  count('thousand-cuts', f.total, 1000);

  // Roles
  if (ref.primaryRoleID) {
    count('skin-to-skin', f.primary, 1);
    count('small-ship', f.primary, 50);
    count('attending-shaped', f.primary, 100);
  }
  const teaching = role(/teach/i);
  if (teaching) count('sensei', f.roleCounts.get(teaching) || 0, 1);
  const second = role(/2nd/i) ?? role(/second/i);
  if (second) count('human-retractor', f.roleCounts.get(second) || 0, 25);
  const observer = role(/observ/i);
  if (observer) count('professional-furniture', f.roleCounts.get(observer) || 0, 10);

  // Pace and calendar
  count('hat-trick', f.maxCasesOnOneDay, 3);
  count('assembly-line', f.maxCasesOnOneDay, 5);
  count('no-sunlight', f.longestDayRun, 5);
  count('iron-resident', f.longestDayRun, 7);
  count('four-weeks', f.longestWeekRun, 4);
  count('ten-weeks', f.longestWeekRun, 10);
  add('weekend-warrior', f.weekend);
  add('nocturnal', f.nocturnal);
  add('archaeologist', f.archaeologist);
  add('backlog', f.backlog);
  add('back-from-the-dead', f.backFromTheDead);
  add('holiday-spirit', f.holiday);
  add('unlucky', f.friday13);
  add('leap-of-faith', f.leapDay);

  // Variety
  count('everything-is-urgent', f.urgentCount, 10);
  count('familiar-face', f.maxWithOneAttending, 15);
  count('scrub-em-all', f.distinctAttendings, 10);
  count('home-field', f.maxAtOneSite, 25);
  count('tourist', f.sites.size, 3);
  add('groundhog-day', f.longestSameProcedureRun >= 5);
  count('variety-pack', f.distinctProcedures, 15);
  const robotic = approach(/robot/i);
  if (robotic) add('uprising-imminent', f.approachesUsed.has(robotic));
  const converted = approach(/convert/i);
  if (converted) add('plan-b', f.approachesUsed.has(converted));
  if (ref.fields.some((x) => x.key === 'fluoro_time')) add('radioactive', (f.numbers.fluoro_time ?? 0) >= 60);

  // Cardiac surgery
  if (ref.procedures.some((p) => p.name.startsWith('CABGx'))) {
    const cabg = procs((n) => n.startsWith('CABGx'));
    const valves = procs(['Aortic valve repair', 'Aortic valve replacement', 'Aortic valve replacement after failed repair',
      'Aortic valve re-replacement', 'Mitral valve repair', 'Mitral valve replacement',
      'Mitral valve replacement after repair', 'Tricuspid valve repair', 'Tricuspid valve replacement',
      'Pulmonic valve repair', 'Pulmonic valve replacement', 'Bentall', 'Ross procedure']);
    const distals = tasks(['Distal anastomosis']);
    count('licensed-plumber', casesWith(cabg, true), 1);
    count('valve-job', casesWith(valves, true), 1);
    count('root-access', casesWith(procsInCategory('Aortic Surgery'), true), 1);
    count('century-of-distals', taskTotal(distals), 100);
    count('change-of-heart', casesWith(procs(['Heart transplant (orthotopic)'])), 1);

    count('saw-whisperer', taskTotal(tasks(['Full sternotomy'])), 10);
    count('mammary-lane', taskTotal(tasks(['LIMA harvest (pedicled)', 'LIMA harvest (skeletonized)',
      'RIMA harvest (pedicled)', 'RIMA harvest (skeletonized)'])), 1);
    count('leg-day', taskTotal(tasks(['SVG harvest (open)', 'SVG harvest (endoscopic)'])), 10);
    count('pump-primed', taskTotal(tasks(['Initiation of cardiopulmonary bypass'])), 25);
    count('gentle-landing', taskTotal(tasks(['Weaning from cardiopulmonary bypass'])), 1);
    count('coronary-cartographer', taskTotal(distals), 50);
    add('spaghetti-junction', casesWith(procs(['CABGx5', 'CABGx6'])) > 0);
    count('ring-bearer', taskTotal(tasks(['Mitral valve annular sutures and ring implantation'])), 1);
    count('balloon-animal', casesWith(procs(['IABP insertion'])), 1);
    count('plan-e', casesWith(procs((n) => n.endsWith('ECMO insertion'))), 1);
    count('rhythm-section', casesWith(procs((n) => n.startsWith('MAZE'))), 1);
    count('tiny-hearts', casesWith(procsInCategory('Congenital')), 1);
    if (ref.fields.some((x) => x.key === 'off_pump')) add('no-pump-no-problem', cases.some((c) => c.field_values?.off_pump === true));
    add('crash-course', taskTotal(tasks(['Crash sternotomy'])) > 0);
    add('deja-vu', taskTotal(tasks(['Redo sternotomy'])) > 0);
  }

  // Vascular surgery
  if (ref.procedures.some((p) => p.name === 'EVAR')) {
    const branched = ['FEVAR', 'BEVAR', 'Physician-modified endograft (PMEG)', 'Chimney/snorkel EVAR',
      'TEVAR with arch branches (zone 0–2)', 'Iliac branch endoprosthesis (IBE)'];
    const endoAortic = procs(['EVAR', 'TEVAR (aneurysm)', 'TEVAR (dissection)', 'TEVAR (blunt aortic injury)', ...branched]);
    const ruptured = procs(['Ruptured AAA repair']);
    const stents = tasks(['Stent deployment', 'Target vessel cannulation and bridging stent']);
    count('neck-and-neck', casesWith(procs(['Carotid endarterectomy', 'Eversion carotid endarterectomy',
      'Redo carotid endarterectomy']), true), 1);
    count('cross-clamp-club', casesWith(new Set([...procsInCategory('Aortic – open'), ...ruptured]), true), 1);
    count('wire-transfer', casesWith(endoAortic, true), 1);
    count('long-distance', casesWith(procs(['Femoral-tibial/pedal bypass']), true), 1);
    count('against-the-clock', casesWith(ruptured), 1);
    count('heavy-metal', taskTotal(stents), 100);

    count('thrill-seeker', taskTotal(tasks(['Arteriovenous anastomosis'])), 1);
    count('access-granted', taskTotal(tasks(['Ultrasound-guided retrograde femoral access', 'Antegrade femoral access'])), 25);
    count('branch-manager', casesWith(procs(branched)), 1);
    count('thread-the-needle', taskTotal(tasks(['Target vessel cannulation and bridging stent'])), 1);
    count('detour-ahead', taskTotal(tasks(['Carotid shunt insertion'])), 1);
    count('measure-twice', casesWith(procsInCategory('Amputations'), true), 1);
    count('under-pressure', casesWith(procs((n) => n.endsWith('fasciotomy'))), 1);
    count('opening-act', casesWith(procs(['Anterior spine exposure', 'Vascular exposure for another service'])), 1);
    count('outlet-shopping', casesWith(procs(['First rib resection (TOS)', 'Cervical rib resection'])), 1);
    count('vein-glory', casesWith(procs(['Endovenous thermal ablation', 'Non-thermal venous ablation (cyanoacrylate/MOCA)'])), 1);
    count('groin-pull', taskTotal(tasks(['Groin (femoral) exposure'])), 10);
    count('vein-there', taskTotal(tasks(['Great saphenous vein harvest'])), 10);
    count('stent-collector', taskTotal(stents), 50);
    const hybrid = approach(/hybrid/i);
    if (hybrid) add('best-of-both-worlds', f.approachesUsed.has(hybrid));
    add('zone-defence', casesWith(procs(['REBOA'])) > 0);
  }

  // Program categories and targets
  const categories = ref.categories.filter((c) => ref.procedures.some((p) => p.category_id === c.id));
  if (categories.length) count('full-house', categories.filter((c) => f.categoriesLogged.has(c.id)).length, categories.length);
  if (f.targets.length) count('requirements-detected', f.targets.filter((t) => t.done).length, f.targets.length);
  for (const cat of categories) {
    out.push({
      id: `category-${cat.id}`, tier: 'minor', title: `New Territory: ${cat.name}`, rule: `First case in ${cat.name}`,
      message: `Your first case in ${cat.name}. Exploration bonus applied. Map not included.`,
      reward: 'A Bronze Box. Contents: a map. It is wrong.', hidden: false, earned: f.categoriesLogged.has(cat.id),
    });
  }
  for (const t of f.targets) {
    out.push({
      id: `target-${t.id}`, tier: 'minor', title: `Quota Fulfilled: ${t.title}`, rule: `Program target: ${t.title}`,
      message: `Target met: ${t.title}. The program wanted this number. You produced this number. Somewhere, a spreadsheet cell has turned green.`,
      reward: 'A Bronze Box. It is green.', hidden: false, earned: t.done, have: t.count, need: t.goal,
    });
  }
  return out.filter((a) => a.title);
}
