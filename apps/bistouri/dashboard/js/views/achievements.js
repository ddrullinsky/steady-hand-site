// Achievements: the program's major achievement unlocks, the same feed residents
// see in the app. Minor achievements never leave residents' phones.
import { state } from '../api.js';
import { h, today, addDays, academicYearStart, isoDate, fmtDate, relDays, fmtNum, plural, emptyState } from '../util.js';
import { residents } from '../stats.js';

// Keep in sync with the major achievements in ios/Bistouri/Achievements.swift
// (and the titles in supabase/functions/notify-achievement).
const MAJORS = [
  { id: 'skin-to-skin', title: 'Skin to Skin', rule: 'First case as primary operator',
    text: 'was primary operator for the first time. The System has opened a file on them.' },
  { id: 'centurion', title: 'Centurion', rule: '100 cases',
    text: 'has logged 100 cases. Their social life has been reclassified as a historical artifact.' },
  { id: 'small-ship', title: 'Captain of a Very Small Ship', rule: '50 cases as primary operator',
    text: 'has 50 cases as primary operator. They have started saying "we" about the hospital.' },
  { id: 'attending-shaped', title: 'Attending-Shaped Object', rule: '100 cases as primary operator',
    text: 'has 100 cases as primary operator. Attendings are advised to check their parking spots.' },
  { id: 'club-250', title: 'The 250 Club', rule: '250 cases',
    text: 'has joined the 250 Club. There is no clubhouse. There is a call room.' },
  { id: 'furniture-no-longer', title: 'Furniture No Longer', rule: '500 cases',
    text: 'has logged 500 cases. The OR has quietly accepted them as one of its own.' },
  { id: 'thousand-cuts', title: 'Death by a Thousand Cuts', rule: '1,000 cases',
    text: 'has logged 1,000 cases. The System requests a moment of stunned silence.' },
  { id: 'full-house', title: 'Full House', rule: 'A case in every category',
    text: 'has a case in every category. Their program director has been notified and is suspicious.' },
  { id: 'requirements-detected', title: 'Requirements Detected', rule: 'Every program target met',
    text: 'has met every program target. The System is cautiously optimistic, which it hates.' },
  { id: 'iron-resident', title: 'Iron Resident', rule: 'Cases on 7 consecutive days',
    text: 'has operated seven days in a row. Their partner has filed a missing-person report.' },
  { id: 'assembly-line', title: 'Assembly Line', rule: '5 cases on the same date',
    text: 'did five cases in one day. The OR schedule weeps.' },
  { id: 'ten-weeks', title: 'Ten Weeks Underground', rule: 'Cases every week for 10 weeks',
    text: 'has logged cases ten weeks running. They are no longer available for comment.' },
];
const BY_ID = new Map(MAJORS.map((m) => [m.id, m]));

let filter = '';
let shown = 50;

function tile(label, value, note, accent) {
  return h('div', { class: `tile${accent ? ' accent' : ''}` },
    h('div', { class: 'tile-label' }, label),
    h('div', { class: 'tile-value' }, value),
    note ? h('div', { class: 'tile-note' }, note) : null);
}

/** Local calendar date of an unlock timestamp, as 'YYYY-MM-DD'. */
const dayOf = (u) => isoDate(new Date(u.unlocked_at));

function who(u) {
  if (!u.display_name) return [h('strong', null, 'A resident'), ' ', h('span', { class: 'badge', title: 'This resident announces anonymously' }, 'anonymous')];
  const member = state.members.some((m) => m.user_id === u.user_id);
  return [member ? h('a', { class: 'cell-name', href: `#/resident/${u.user_id}` }, u.display_name) : h('strong', null, u.display_name)];
}

export function render(main, { rerender }) {
  const p = state.program;
  const unlocks = state.achievements.filter((u) => BY_ID.has(u.achievement_id));
  const t = today();
  const res = residents();
  const resIds = new Set(res.map((r) => r.user_id));
  const withMajor = new Set(unlocks.map((u) => u.user_id).filter((id) => resIds.has(id)));

  main.append(
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', null, 'Achievements'),
        h('div', { class: 'sub' }, `Major achievements unlocked in ${p.name}. Residents see the same announcements in the app.`))),
    h('div', { class: 'tiles' },
      tile('Unlocks this academic year', fmtNum(unlocks.filter((u) => dayOf(u) >= academicYearStart()).length)),
      tile('Unlocks in the last 30 days', fmtNum(unlocks.filter((u) => dayOf(u) >= addDays(t, -30)).length)),
      tile('Residents with a major achievement', fmtNum(withMajor.size),
        res.length ? `of ${plural(res.length, 'active resident')}` : null, true)),
  );

  // --- feed
  const list = filter ? unlocks.filter((u) => u.achievement_id === filter) : unlocks;
  const feed = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' },
      h('h2', null, 'Announcements'),
      h('label', { class: 'check' }, 'Show ',
        h('select', { onchange: (e) => { filter = e.target.value; shown = 50; rerender(); } },
          h('option', { value: '' }, 'All achievements'),
          MAJORS.map((m) => h('option', { value: m.id, selected: m.id === filter }, m.title))))));
  if (!list.length) {
    feed.append(emptyState(filter ? 'Nobody has unlocked this one yet' : 'No major achievements yet',
      'They appear here as residents log cases. Someone has to go first. The System is watching.'));
  } else {
    feed.append(h('ul', { class: 'feed' }, list.slice(0, shown).map((u) => {
      const m = BY_ID.get(u.achievement_id);
      return h('li', null,
        h('span', { class: 'feed-mark', 'aria-hidden': 'true' }, '★'),
        h('div', null,
          h('div', { class: 'feed-title' }, h('span', { class: 'system' }, 'Major achievement'), m.title),
          h('div', { class: 'feed-text' }, ...who(u), ' ', m.text),
          h('div', { class: 'feed-meta', title: new Date(u.unlocked_at).toLocaleString('en-CA') },
            `${fmtDate(dayOf(u))} · ${relDays(dayOf(u))}`)));
    })));
    if (list.length > shown) {
      feed.append(h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { shown += 50; rerender(); } },
        `Show more (${fmtNum(list.length - shown)} left)`));
    }
  }
  feed.append(h('p', { class: 'hint', style: { marginTop: '12px' } },
    'Minor achievements stay on residents’ phones and are not shown here. Residents who announce anonymously appear as “A resident”.'));

  // --- by achievement
  const table = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'By achievement'), h('span', { class: 'hint' }, 'All time')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
      h('thead', null, h('tr', null,
        h('th', null, 'Achievement'), h('th', { class: 'num' }, 'Residents'), h('th', { class: 'num' }, 'Latest'))),
      h('tbody', null, MAJORS.map((m) => {
        const hits = unlocks.filter((u) => u.achievement_id === m.id);
        return h('tr', { class: 'click', onclick: () => { filter = m.id; shown = 50; rerender(); window.scrollTo(0, 0); } },
          h('td', null, h('div', { class: 'cell-name' }, m.title), h('div', { class: 'cell-sub' }, m.rule)),
          h('td', { class: 'num' }, hits.length ? fmtNum(hits.length) : '·'),
          h('td', { class: 'num nowrap' }, hits.length ? fmtDate(dayOf(hits[0])) : '—'));
      })))));

  main.append(h('div', { class: 'grid-2' }, feed, table));
}
