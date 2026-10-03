// Resident detail: targets, breakdowns, monthly chart, case list, CSV and
// a print layout for Competence Committee / 6-month reviews.
import { state } from '../api.js';
import {
  h, clear, icon, fmtDate, fmtNum, pct, personName, pgyLabel, today, addMonths, academicYearStart,
  academicYearLabel, monthRange, monthKey, fmtMonth, emptyState, toast, relDays, byOrder,
} from '../util.js';
import {
  casesByResident, inRange, activeTargets, targetCount, targetTitle, targetDetail, roleOrder, roleName,
  categoryName, taskName, taskTotals, siteName, attendingName, approachName, procedureName, displayFields,
  fieldValueText, urgencyLabel, tasksText,
} from '../stats.js';
import { barChart } from '../charts.js';
import { exportCasesCSV } from '../export.js';

const range = { preset: 'all', from: '', to: '', printCases: true };

const PRESETS = {
  all: 'All time',
  ay: 'This academic year',
  lastay: 'Last academic year',
  m6: 'Last 6 months',
  m12: 'Last 12 months',
  custom: 'Custom dates',
};

function applyPreset(preset, firstCase) {
  const t = today();
  const ay = academicYearStart();
  range.preset = preset;
  if (preset === 'all') { range.from = firstCase || ''; range.to = t; }
  if (preset === 'ay') { range.from = ay; range.to = t; }
  if (preset === 'lastay') { range.from = `${Number(ay.slice(0, 4)) - 1}-07-01`; range.to = `${ay.slice(0, 4)}-06-30`; }
  if (preset === 'm6') { range.from = addMonths(t, -6); range.to = t; }
  if (preset === 'm12') { range.from = addMonths(t, -12); range.to = t; }
}

function initials(name) {
  return name.split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

export function render(main, { args, rerender }) {
  const uid = args[0];
  const m = state.members.find((x) => x.user_id === uid);
  main.append(h('a', { class: 'back-link no-print', href: '#/residents' }, icon('back'), 'All residents'));
  if (!m) {
    main.append(emptyState('Resident not found', 'This person is not a member of the selected program.'));
    return;
  }
  const allCases = (casesByResident().get(uid) || []).slice().sort((a, b) => b.case_date.localeCompare(a.case_date));
  const firstCase = allCases.length ? allCases[allCases.length - 1].case_date : today();
  if (range.preset !== 'custom' || !range.from) applyPreset(range.preset === 'custom' ? 'all' : range.preset, firstCase);
  const cases = inRange(allCases, range.from, range.to);
  const cumulative = inRange(allCases, null, range.to);
  const name = personName(m);
  const roles = [...state.config.roles].sort(byOrder);
  const topRole = roles.find((r) => r.active) || roles[0];

  // ---- print header
  main.append(h('div', { class: 'print-only report-head' },
    h('div', { style: { fontSize: '10pt', color: '#0f766e', fontWeight: 700, letterSpacing: '.04em' } }, 'BISTOURI · SURGICAL CASE LOG REPORT'),
    h('h1', null, name),
    h('div', { class: 'report-meta' },
      h('span', null, h('strong', null, 'Program: '), state.program.name),
      h('span', null, h('strong', null, 'Level: '), m.pgy_year ? pgyLabel(m.pgy_year) : 'not set'),
      h('span', null, h('strong', null, 'Period: '), `${fmtDate(range.from)} – ${fmtDate(range.to)}`),
      h('span', null, h('strong', null, 'Generated: '), fmtDate(today())),
      h('span', null, h('strong', null, 'Email: '), m.email)),
    h('div', { style: { fontSize: '9pt', color: '#555', marginTop: '4px' } },
      'Self-reported by the resident in the Bistouri app. Prepared for the Competence Committee.')));

  // ---- screen header
  main.append(h('div', { class: 'page-head no-print' },
    h('div', { class: 'person-head' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(name)),
      h('div', null,
        h('h1', null, name, !m.active ? h('span', { class: 'badge', style: { marginLeft: '8px', verticalAlign: 'middle' } }, 'inactive') : null),
        h('div', { class: 'kv' },
          h('span', null, m.role === 'program_director' ? 'Program director' : (m.pgy_year ? pgyLabel(m.pgy_year) : 'PGY not set')),
          h('span', null, m.email),
          h('span', null, 'Last case ', h('strong', null, m.last_case_date ? relDays(m.last_case_date) : 'never'))))),
    h('div', { class: 'toolbar' },
      h('button', {
        class: 'btn', disabled: !cases.length,
        onclick: () => { const n = exportCasesCSV(cases, `${name}-cases-${range.from}-to-${range.to}`, { dated: false }); toast(`Exported ${n} cases`); },
      }, icon('download'), 'Export CSV'),
      h('button', { class: 'btn btn-primary', onclick: () => window.print() }, icon('print'), 'Print report'))));

  // ---- range picker
  const fromIn = h('input', { type: 'date', value: range.from, max: range.to, 'aria-label': 'From date' });
  const toIn = h('input', { type: 'date', value: range.to, 'aria-label': 'To date' });
  const onDates = () => {
    if (!fromIn.value || !toIn.value) return;
    range.preset = 'custom'; range.from = fromIn.value; range.to = toIn.value; rerender();
  };
  fromIn.addEventListener('change', onDates);
  toIn.addEventListener('change', onDates);
  main.append(h('div', { class: 'panel no-print', style: { padding: '14px 20px' } },
    h('div', { class: 'row-between' },
      h('div', { class: 'range-bar' },
        h('div', { class: 'field' }, h('label', null, 'Period'),
          h('select', { onchange: (e) => { applyPreset(e.target.value, firstCase); rerender(); } },
            Object.entries(PRESETS).map(([k, v]) => h('option', { value: k, selected: k === range.preset }, v)))),
        h('div', { class: 'field' }, h('label', null, 'From'), fromIn),
        h('div', { class: 'field' }, h('label', null, 'To'), toIn)),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: range.printCases, onchange: (e) => { range.printCases = e.target.checked; rerender(); } }),
        'Include case list in printed report'))));

  // ---- tiles
  const topRoleCount = topRole ? cases.filter((c) => c.role_id === topRole.id).length : 0;
  const cats = new Set(cases.flatMap((c) => c.categoryIds));
  main.append(h('div', { class: 'tiles' },
    tileEl('Cases in period', fmtNum(cases.length), `${fmtNum(allCases.length)} all time`),
    tileEl(topRole ? `As ${topRole.name.toLowerCase()}` : 'Top role', cases.length ? `${pct(topRoleCount, cases.length)}%` : '—', `${fmtNum(topRoleCount)} cases`, true),
    tileEl('Categories covered', fmtNum(cats.size), `of ${state.config.categories.filter((c) => c.active).length} in the program`),
    tileEl('This academic year', fmtNum(inRange(allCases, academicYearStart()).length), academicYearLabel(academicYearStart()))));

  // ---- targets
  const targets = activeTargets();
  const tPanel = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Progress toward program targets'),
      h('span', { class: 'hint' }, `Cumulative to ${fmtDate(range.to)}`)));
  if (!targets.length) {
    tPanel.append(emptyState('No targets yet',
      'Add your program’s minimums in Configure → Targets, and residents’ progress will appear here and in their app.',
      h('a', { class: 'btn no-print', href: '#/configure/targets' }, 'Set targets')));
  } else {
    let met = 0;
    const list = h('div', { class: 'targets' }, targets.map((t) => {
      const n = targetCount(t, cumulative);
      const p = Math.min(100, Math.round((n / t.target_count) * 100));
      if (n >= t.target_count) met++;
      return h('div', { class: 'target' },
        h('div', { class: 'target-top' },
          h('span', { class: 'target-name' }, targetTitle(t)),
          h('span', { class: 'target-count' }, h('strong', null, fmtNum(n)), ` / ${fmtNum(t.target_count)}`)),
        h('div', {
          class: `bar${n >= t.target_count ? ' done' : p < 25 ? ' low' : ''}`, role: 'progressbar',
          'aria-valuenow': String(n), 'aria-valuemin': '0', 'aria-valuemax': String(t.target_count), 'aria-label': targetTitle(t),
        }, h('span', { style: { width: `${Math.max(p, n ? 2 : 0)}%` } })),
        h('div', { class: 'target-detail' }, `${p}% · ${targetDetail(t)}`));
    }));
    tPanel.querySelector('.panel-head').append(h('span', { class: `badge plain ${met === targets.length ? 'good' : 'outline'}` }, `${met} of ${targets.length} met`));
    tPanel.append(list);
  }
  main.append(tPanel);

  if (!allCases.length) {
    main.append(emptyState(`${name} has not logged any cases yet`,
      'Cases appear here as soon as they are synced from the Bistouri app. Compliance lets you send a friendly reminder.',
      h('a', { class: 'btn no-print', href: '#/compliance' }, 'Go to Compliance')));
    main.append(signatures());
    return;
  }

  // ---- category x role
  const roleIds = roleOrder(cases).filter((rid) => cases.some((c) => (c.role_id || null) === rid));
  const catRows = [...state.config.categories].sort(byOrder).filter((c) => cats.has(c.id));
  const catTable = h('table', { class: 'table compact' },
    h('thead', null, h('tr', null, h('th', null, 'Category'),
      roleIds.map((r) => h('th', { class: 'num' }, r ? roleName(r) : 'Not recorded')), h('th', { class: 'num' }, 'Total'))),
    h('tbody', null, catRows.map((cat) => {
      const inCat = cases.filter((c) => c.categoryIds.includes(cat.id));
      return h('tr', null, h('td', null, cat.name),
        roleIds.map((r) => {
          const n = inCat.filter((c) => (c.role_id || null) === r).length;
          return h('td', { class: 'num' }, n || h('span', { class: 'muted' }, '·'));
        }),
        h('td', { class: 'num' }, h('strong', null, inCat.length)));
    }),
    h('tr', null, h('td', null, h('strong', null, 'All cases')),
      roleIds.map((r) => h('td', { class: 'num' }, h('strong', null, cases.filter((c) => (c.role_id || null) === r).length))),
      h('td', { class: 'num' }, h('strong', null, cases.length)))));

  // ---- top tasks
  const totals = [...taskTotals(cases).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxTask = totals.length ? totals[0][1] : 1;
  const taskPanel = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Top procedural tasks'), h('span', { class: 'hint' }, 'Times performed in period')),
    totals.length ? h('div', { class: 'task-bars' }, totals.map(([id, n]) => h('div', { class: 'task-bar' },
      h('div', null, h('div', null, taskName(id)), h('div', { class: 'bar' }, h('span', { style: { width: `${(n / maxTask) * 100}%` } }))),
      h('div', { class: 'num' }, h('strong', null, n)))))
      : emptyState('No procedural tasks logged in this period', null));

  main.append(h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Cases by category and role'),
      h('span', { class: 'hint' }, 'A case with procedures in two categories counts in both')),
    catRows.length ? h('div', { class: 'table-wrap' }, catTable) : emptyState('No cases in this period', null)));

  // ---- monthly chart beside the tasks
  const months = monthRange(range.from.slice(0, 8) + '01', range.to);
  const perMonth = new Map(months.map((k) => [k, 0]));
  for (const c of cases) { const k = monthKey(c.case_date); if (perMonth.has(k)) perMonth.set(k, perMonth.get(k) + 1); }
  const monthPanel = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Cases per month')));
  main.append(h('div', { class: 'grid-2' }, taskPanel, monthPanel));
  if (cases.length) {
    barChart(monthPanel, {
      labels: months.map((k) => fmtMonth(k)), values: months.map((k) => perMonth.get(k)), label: 'Cases',
      height: 300, ariaLabel: `Cases per month for ${name}`,
    });
  } else {
    monthPanel.append(emptyState('No cases in this period', null));
  }

  // ---- case list
  const fields = displayFields(cases);
  const listPanel = h('div', { class: `panel allow-break${range.printCases ? '' : ' hide-in-print'}` },
    h('div', { class: 'panel-head' }, h('h2', null, `Cases (${cases.length})`),
      h('span', { class: 'hint' }, `${fmtDate(range.from)} – ${fmtDate(range.to)}`)));
  listPanel.append(cases.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
    h('thead', null, h('tr', null,
      ['Date', 'Site', 'Attending', 'Role', 'Approach', 'Procedures', 'Tasks'].map((x) => h('th', null, x)),
      fields.map((f) => h('th', null, f.label)))),
    h('tbody', null, cases.map((c) => h('tr', null,
      h('td', { style: { whiteSpace: 'nowrap' } }, fmtDate(c.case_date),
        c.urgency && c.urgency !== 'elective' ? h('div', null, h('span', { class: `badge ${c.urgency === 'emergent' ? 'bad' : 'warn'}` }, urgencyLabel(c.urgency))) : null),
      h('td', null, siteName(c.site_id) || '—'),
      h('td', null, attendingName(c) || '—'),
      h('td', null, c.role_id ? roleName(c.role_id) : '—'),
      h('td', null, approachName(c.approach_id) || '—'),
      h('td', { class: 'wrap' }, c.procedureIds.map(procedureName).join(', ') || '—'),
      h('td', { class: 'wrap' }, c.tasks.length
        ? tasksText(c, ', ') : '—'),
      fields.map((f) => h('td', { style: { whiteSpace: 'nowrap' } }, fieldValueText(f, c.field_values[f.key]) || '—')))))))
    : emptyState('No cases in this period', 'Choose a wider period above.'));
  main.append(listPanel);
  main.append(signatures());
}

function tileEl(label, value, note, accent) {
  return h('div', { class: `tile${accent ? ' accent' : ''}` },
    h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value' }, value),
    note ? h('div', { class: 'tile-note' }, note) : null);
}

function signatures() {
  return h('div', { class: 'print-only report-sign' },
    h('div', null, 'Program director — signature and date'),
    h('div', null, 'Resident — signature and date'));
}
