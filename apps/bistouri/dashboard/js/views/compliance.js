// Compliance: who has gone quiet, who never logged, and a mailto: nudge.
import { state } from '../api.js';
import { h, clear, icon, fmtDate, fmtNum, personName, pgyLabel, today, addDays, daysBetween, emptyState, toast } from '../util.js';
import { residents } from '../stats.js';

let days = 14;
const selected = new Set();

export function render(main) {
  const res = residents();
  main.append(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Logging compliance'),
      h('div', { class: 'sub' }, 'Residents who have not logged recently. A short, friendly reminder usually does it.'))));

  if (!res.length) {
    main.append(emptyState('No residents yet', 'Invite residents under People; they will show up here once they join.',
      h('a', { class: 'btn btn-primary', href: '#/people' }, 'Go to People')));
    return;
  }

  const body = h('div');
  const daysIn = h('input', {
    type: 'number', min: '1', max: '365', value: String(days), style: { width: '80px' }, 'aria-label': 'Days without a case',
    onchange: (e) => { days = Math.max(1, Math.min(365, Number(e.target.value) || 14)); e.target.value = days; draw(); },
  });
  main.append(h('div', { class: 'panel', style: { padding: '14px 20px' } },
    h('div', { class: 'row-between' },
      h('label', { class: 'check' }, 'Flag residents with no case in the last ', daysIn, ' days'),
      h('span', { class: 'hint' }, 'Only active residents are included. Case dates are the operation date the resident entered.'))),
  body);

  function draw() {
    const cutoff = addDays(today(), -days);
    const quiet = res.filter((r) => r.last_case_date && r.last_case_date < cutoff)
      .sort((a, b) => a.last_case_date.localeCompare(b.last_case_date));
    const never = res.filter((r) => !r.last_case_date).sort((a, b) => personName(a).localeCompare(personName(b)));
    const ok = res.length - quiet.length - never.length;
    // keep only selections that are still on screen
    const visible = new Set([...quiet, ...never].map((r) => r.user_id));
    for (const id of [...selected]) if (!visible.has(id)) selected.delete(id);

    const nudgeBtn = h('button', { class: 'btn btn-accent', onclick: nudge }, icon('mail'), 'Nudge by email');
    const updateBtn = () => {
      nudgeBtn.disabled = selected.size === 0;
      nudgeBtn.lastChild.textContent = selected.size ? `Nudge ${selected.size} by email` : 'Nudge by email';
    };

    const table = (list, kind) => h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null,
        h('th', { style: { width: '36px' } }, h('input', {
          type: 'checkbox', 'aria-label': 'Select all',
          checked: list.every((r) => selected.has(r.user_id)),
          onchange: (e) => { list.forEach((r) => (e.target.checked ? selected.add(r.user_id) : selected.delete(r.user_id))); draw(); },
        })),
        h('th', null, 'Resident'), h('th', null, 'PGY'),
        kind === 'quiet' ? [h('th', null, 'Last case'), h('th', { class: 'num' }, 'Days since'), h('th', { class: 'num' }, 'Total cases')]
          : [h('th', null, 'Member since')])),
      h('tbody', null, list.map((r) => h('tr', null,
        h('td', null, h('input', {
          type: 'checkbox', checked: selected.has(r.user_id), 'aria-label': `Select ${personName(r)}`,
          onchange: (e) => { e.target.checked ? selected.add(r.user_id) : selected.delete(r.user_id); updateBtn(); },
        })),
        h('td', null, h('a', { href: `#/resident/${r.user_id}`, class: 'cell-name' }, personName(r)), h('div', { class: 'cell-sub' }, r.email)),
        h('td', null, r.pgy_year ? pgyLabel(r.pgy_year) : '—'),
        kind === 'quiet' ? [
          h('td', null, fmtDate(r.last_case_date)),
          h('td', { class: 'num' }, h('span', { class: `badge ${daysBetween(r.last_case_date, today()) > days * 2 ? 'bad' : 'warn'}` }, daysBetween(r.last_case_date, today()))),
          h('td', { class: 'num' }, fmtNum(r.case_count)),
        ] : [h('td', null, fmtDate(r.joined_at))])))));

    clear(body).append(
      h('div', { class: 'tiles' },
        tileEl('Logging regularly', fmtNum(ok), `a case in the last ${days} days`),
        tileEl('Gone quiet', fmtNum(quiet.length), `no case in ${days}+ days`, true),
        tileEl('Never logged', fmtNum(never.length), 'joined but no cases yet', true)),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-head' },
          h('div', null, h('h2', null, 'Needs a nudge'),
            h('div', { class: 'hint' }, 'Select residents, then open a pre-written email in your mail app. Recipients are in BCC.')),
          nudgeBtn),
        quiet.length || never.length ? [
          quiet.length ? [h('h3', { style: { fontSize: '14px', margin: '4px 0 6px' } }, `No case in the last ${days} days (${quiet.length})`), table(quiet, 'quiet')] : null,
          never.length ? [h('h3', { style: { fontSize: '14px', margin: '18px 0 6px' } }, `Never logged (${never.length})`), table(never, 'never')] : null,
        ] : emptyState(`Everyone has logged a case in the last ${days} days`, 'Nothing to chase. Nice work, team.')));
    updateBtn();
  }

  function nudge() {
    const emails = res.filter((r) => selected.has(r.user_id)).map((r) => r.email).filter(Boolean);
    if (!emails.length) return;
    const subject = `Quick reminder: log your cases in Bistouri (${state.program.name})`;
    const body = [
      'Hi everyone,',
      '',
      `A quick, friendly reminder to log your recent OR cases in the Bistouri app. It takes under 30 seconds per case, and it keeps your progress toward the ${state.program.name} targets up to date for your reviews.`,
      '',
      'Tip: "Repeat last case" and favourites make it even faster. If anything in the app gets in your way, just reply and let me know.',
      '',
      'Thanks,',
      state.profile.full_name || '',
    ].join('\n');
    const url = `mailto:${encodeURIComponent(state.profile.email)}?bcc=${emails.map(encodeURIComponent).join(',')}` +
      `&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (url.length > 1900) toast('Long recipient list: some mail apps may truncate it. Consider nudging in smaller groups.', 'error');
    const a = h('a', { href: url });
    a.click();
  }

  draw();
}

function tileEl(label, value, note, accent) {
  return h('div', { class: `tile${accent ? ' accent' : ''}` },
    h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value' }, value),
    note ? h('div', { class: 'tile-note' }, note) : null);
}
