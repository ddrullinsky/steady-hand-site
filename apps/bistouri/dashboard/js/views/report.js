// Program report: case volumes for the whole program over a period, laid out to
// print (or save as PDF) for accreditation, the Residency Program Committee or
// an annual review. Everything is worked out from the cases already loaded.
import { state } from '../api.js';
import {
  h, icon, fmtDate, fmtNum, pct, median, personName, pgyLabel, today, addMonths, academicYearStart,
  academicYearLabel, monthRange, monthKey, fmtMonth, emptyState, byOrder,
} from '../util.js';
import {
  casesByResident, inRange, activeTargets, targetCount, roleOrder, roleName, siteName, attendingName,
  urgencyLabel, pgyGroups,
} from '../stats.js';
import { barChart } from '../charts.js';

const range = { preset: 'ay', from: '', to: '', perResident: true };

const PRESETS = {
  ay: 'This academic year',
  lastay: 'Last academic year',
  m12: 'Last 12 months',
  all: 'All time',
  custom: 'Custom dates',
};

function applyPreset(preset, firstCase) {
  const t = today();
  const ay = academicYearStart();
  range.preset = preset;
  if (preset === 'all') { range.from = firstCase || t; range.to = t; }
  if (preset === 'ay') { range.from = ay; range.to = t; }
  if (preset === 'lastay') { range.from = `${Number(ay.slice(0, 4)) - 1}-07-01`; range.to = `${ay.slice(0, 4)}-06-30`; }
  if (preset === 'm12') { range.from = addMonths(t, -12); range.to = t; }
}

function tile(label, value, note, accent) {
  return h('div', { class: `tile${accent ? ' accent' : ''}` },
    h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value' }, value),
    note ? h('div', { class: 'tile-note' }, note) : null);
}

/** A two-column "name · cases · share" table, biggest first. */
function shareTable(title, hint, counts, total) {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, title), hint ? h('span', { class: 'hint' }, hint) : null),
    rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
      h('thead', null, h('tr', null, h('th', null, title.replace(/^Cases by /, '').replace(/^./, (c) => c.toUpperCase())),
        h('th', { class: 'num' }, 'Cases'), h('th', { class: 'num' }, 'Share'))),
      h('tbody', null, rows.map(([name, n]) => h('tr', null,
        h('td', null, name), h('td', { class: 'num' }, fmtNum(n)), h('td', { class: 'num' }, `${pct(n, total)}%`))))))
      : emptyState('No cases in this period', null));
}

export function render(main, { rerender }) {
  const p = state.program;
  const res = state.members.filter((m) => m.role === 'resident');
  const resIds = new Set(res.map((m) => m.user_id));
  const allCases = state.cases.filter((c) => resIds.has(c.resident_id));
  const firstCase = allCases.reduce((min, c) => (!min || c.case_date < min ? c.case_date : min), '');
  if (range.preset !== 'custom' || !range.from) applyPreset(range.preset === 'custom' ? 'ay' : range.preset, firstCase);
  const cases = inRange(allCases, range.from, range.to);
  const byRes = casesByResident(cases);
  const periodLabel = `${fmtDate(range.from)} – ${fmtDate(range.to)}`;

  // ---- print header
  main.append(h('div', { class: 'print-only report-head' },
    h('div', { style: { fontSize: '10pt', color: '#0f766e', fontWeight: 700, letterSpacing: '.04em' } }, 'BISTOURI · PROGRAM CASE LOG REPORT'),
    h('h1', null, p.name),
    h('div', { class: 'report-meta' },
      h('span', null, h('strong', null, 'Period: '), periodLabel),
      h('span', null, h('strong', null, 'Residents: '), fmtNum(res.length)),
      h('span', null, h('strong', null, 'Generated: '), fmtDate(today()))),
    h('div', { style: { fontSize: '9pt', color: '#555', marginTop: '4px' } },
      'Self-reported by residents in the Bistouri app. PGY is each resident’s current level. No patient identifiers are collected.')));

  // ---- screen header
  main.append(h('div', { class: 'page-head no-print' },
    h('div', null, h('h1', null, 'Program report'),
      h('div', { class: 'sub' }, 'Case volumes for the whole program, ready to print or save as PDF for accreditation and annual reviews.')),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn btn-primary', disabled: !cases.length, onclick: () => window.print() }, icon('print'), 'Print or save as PDF'))));

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
        h('input', { type: 'checkbox', checked: range.perResident, onchange: (e) => { range.perResident = e.target.checked; rerender(); } }),
        'Include per-resident table'))));

  if (!res.length) {
    main.append(emptyState('No residents in this program yet', 'Invite residents under People; their cases appear here once they log.',
      h('a', { class: 'btn no-print', href: '#/people' }, 'Go to People')));
    return;
  }

  // ---- tiles
  const roles = [...state.config.roles].sort(byOrder);
  const topRole = roles.find((r) => r.active) || roles[0];
  const topRoleCount = topRole ? cases.filter((c) => c.role_id === topRole.id).length : 0;
  const logged = res.filter((m) => byRes.has(m.user_id)).length;
  main.append(h('div', { class: 'tiles' },
    tile('Cases in period', fmtNum(cases.length), periodLabel),
    tile('Residents who logged', `${logged} of ${res.length}`, 'at least one case in the period'),
    tile(topRole ? `As ${topRole.name.toLowerCase()}` : 'Top role', cases.length ? `${pct(topRoleCount, cases.length)}%` : '—', `${fmtNum(topRoleCount)} cases`, true),
    tile('Sites', fmtNum(new Set(cases.map((c) => c.site_id).filter(Boolean)).size), `${fmtNum(new Set(cases.map(attendingName).filter(Boolean)).size)} attendings`)));

  if (!cases.length) {
    main.append(emptyState('No cases in this period', 'Choose a wider period above.'));
    return;
  }

  // ---- by PGY
  const groups = pgyGroups(res);
  const resByPgy = new Map(groups.map((g) => [g, res.filter((r) => (r.pgy_year || 0) === g)]));
  const casesOfGroup = (g) => resByPgy.get(g).flatMap((r) => byRes.get(r.user_id) || []);
  const roleIds = roleOrder(cases).filter((rid) => cases.some((c) => (c.role_id || null) === rid));
  main.append(h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Cases by PGY and role'), h('span', { class: 'hint' }, periodLabel)),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
      h('thead', null, h('tr', null, h('th', null, 'PGY'), h('th', { class: 'num' }, 'Residents'),
        roleIds.map((r) => h('th', { class: 'num' }, r ? roleName(r) : 'Not recorded')),
        h('th', { class: 'num' }, 'Total'), h('th', { class: 'num', title: 'Median cases per resident' }, 'Median per resident'))),
      h('tbody', null,
        groups.map((g) => {
          const list = casesOfGroup(g);
          const counts = resByPgy.get(g).map((r) => (byRes.get(r.user_id) || []).length);
          return h('tr', null, h('td', null, g ? pgyLabel(g) : 'PGY not set'), h('td', { class: 'num' }, resByPgy.get(g).length),
            roleIds.map((rid) => h('td', { class: 'num' }, fmtNum(list.filter((c) => (c.role_id || null) === rid).length))),
            h('td', { class: 'num' }, h('strong', null, fmtNum(list.length))), h('td', { class: 'num' }, fmtNum(median(counts), 1)));
        }),
        h('tr', null, h('td', null, h('strong', null, 'All residents')), h('td', { class: 'num' }, h('strong', null, res.length)),
          roleIds.map((rid) => h('td', { class: 'num' }, h('strong', null, fmtNum(cases.filter((c) => (c.role_id || null) === rid).length)))),
          h('td', { class: 'num' }, h('strong', null, fmtNum(cases.length))),
          h('td', { class: 'num' }, fmtNum(median(res.map((r) => (byRes.get(r.user_id) || []).length)), 1))))))));

  // ---- category x PGY
  const cats = [...state.config.categories].sort(byOrder).filter((c) => cases.some((k) => k.categoryIds.includes(c.id)));
  main.append(h('div', { class: 'panel allow-break' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Cases by category and PGY'),
      h('span', { class: 'hint' }, 'A case with procedures in two categories counts in both')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
      h('thead', null, h('tr', null, h('th', null, 'Category'),
        groups.map((g) => h('th', { class: 'num' }, g ? pgyLabel(g) : 'PGY not set')), h('th', { class: 'num' }, 'Total'))),
      h('tbody', null, cats.map((cat) => h('tr', null, h('td', null, cat.name),
        groups.map((g) => {
          const n = casesOfGroup(g).filter((c) => c.categoryIds.includes(cat.id)).length;
          return h('td', { class: 'num' }, n ? fmtNum(n) : h('span', { class: 'muted' }, '·'));
        }),
        h('td', { class: 'num' }, h('strong', null, fmtNum(cases.filter((c) => c.categoryIds.includes(cat.id)).length))))))))));

  // ---- site, urgency, attending
  const count = (fn) => {
    const m = new Map();
    for (const c of cases) { const k = fn(c); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  main.append(h('div', { class: 'grid-2' },
    shareTable('Cases by site', null, count((c) => siteName(c.site_id) || 'Not recorded'), cases.length),
    shareTable('Cases by urgency', null, count((c) => urgencyLabel(c.urgency) || 'Not recorded'), cases.length)));

  const attendings = new Map();
  for (const c of cases) {
    const name = attendingName(c) || 'Not recorded';
    if (!attendings.has(name)) attendings.set(name, { n: 0, residents: new Set() });
    const a = attendings.get(name);
    a.n++; a.residents.add(c.resident_id);
  }
  main.append(h('div', { class: 'panel allow-break' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Cases by attending'), h('span', { class: 'hint' }, 'Teaching exposure across the faculty')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
      h('thead', null, h('tr', null, h('th', null, 'Attending'), h('th', { class: 'num' }, 'Cases'),
        h('th', { class: 'num' }, 'Share'), h('th', { class: 'num' }, 'Residents'))),
      h('tbody', null, [...attendings.entries()].sort((a, b) => b[1].n - a[1].n).map(([name, a]) => h('tr', null,
        h('td', null, name), h('td', { class: 'num' }, fmtNum(a.n)), h('td', { class: 'num' }, `${pct(a.n, cases.length)}%`),
        h('td', { class: 'num' }, fmtNum(a.residents.size)))))))));

  // ---- per resident, with targets (cumulative to the end of the period)
  const targets = activeTargets();
  const allByRes = casesByResident(inRange(allCases, null, range.to));
  const sortedRes = [...res].sort((a, b) => (a.pgy_year || 99) - (b.pgy_year || 99) || personName(a).localeCompare(personName(b)));
  main.append(h('div', { class: `panel allow-break${range.perResident ? '' : ' hide-in-print'}` },
    h('div', { class: 'panel-head' }, h('h2', null, 'Residents'),
      h('span', { class: 'hint' }, targets.length ? `Targets are cumulative to ${fmtDate(range.to)}` : 'No program targets set')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
      h('thead', null, h('tr', null, h('th', null, 'Resident'), h('th', null, 'PGY'),
        h('th', { class: 'num' }, 'Cases in period'),
        topRole ? h('th', { class: 'num' }, `As ${topRole.name.toLowerCase()}`) : null,
        h('th', { class: 'num' }, 'All time to period end'),
        targets.length ? h('th', { class: 'num' }, 'Targets met') : null)),
      h('tbody', null, sortedRes.map((m) => {
        const inPeriod = byRes.get(m.user_id) || [];
        const cumulative = allByRes.get(m.user_id) || [];
        const met = targets.filter((t) => targetCount(t, cumulative) >= t.target_count).length;
        return h('tr', null,
          h('td', null, personName(m), m.active ? null : h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'inactive')),
          h('td', null, m.pgy_year ? pgyLabel(m.pgy_year) : '—'),
          h('td', { class: 'num' }, fmtNum(inPeriod.length)),
          topRole ? h('td', { class: 'num' }, fmtNum(inPeriod.filter((c) => c.role_id === topRole.id).length)) : null,
          h('td', { class: 'num' }, fmtNum(cumulative.length)),
          targets.length ? h('td', { class: 'num' }, `${met} / ${targets.length}`) : null);
      }))))));

  // ---- monthly
  const months = monthRange(range.from.slice(0, 8) + '01', range.to);
  const perMonth = new Map(months.map((k) => [k, 0]));
  for (const c of cases) { const k = monthKey(c.case_date); if (perMonth.has(k)) perMonth.set(k, perMonth.get(k) + 1); }
  const monthPanel = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Cases per month'),
    h('span', { class: 'hint' }, range.preset === 'ay' || range.preset === 'lastay' ? `Academic year ${academicYearLabel(range.from)}` : periodLabel)));
  main.append(monthPanel);
  barChart(monthPanel, {
    labels: months.map((k) => fmtMonth(k)), values: months.map((k) => perMonth.get(k)), label: 'Cases',
    height: 260, ariaLabel: `Cases per month for ${p.name}`,
  });

  main.append(h('div', { class: 'print-only report-sign' },
    h('div', null, 'Program director: signature and date'),
    h('div', null, 'Reviewed by the Residency Program Committee: date')));
}
