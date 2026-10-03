// People: roster (PGY, role, active) and invitations.
import { sb, state, loadMembers, loadInvitations, updateMember } from '../api.js';
import { h, icon, toast, dialog, errorText, fmtDate, fmtNum, personName, pgyLabel, emptyState } from '../util.js';

const ui = { inactive: true };
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;

function pgySelect(value, onchange, label) {
  return h('select', { 'aria-label': label, onchange },
    h('option', { value: '' }, '—'),
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => h('option', { value: String(n), selected: value === n }, `PGY-${n}`)));
}

export function render(main, { rerender }) {
  const me = state.session.user.id;
  main.append(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'People'),
      h('div', { class: 'sub' }, `Everyone in ${state.program.name}: residents and program directors.`))));

  // ---------------- roster
  const members = [...state.members]
    .filter((m) => ui.inactive || m.active)
    .sort((a, b) => (a.role === b.role ? 0 : a.role === 'program_director' ? -1 : 1) ||
      (a.pgy_year || 99) - (b.pgy_year || 99) || personName(a).localeCompare(personName(b)));

  const save = async (m, patch, what) => {
    const { error } = await updateMember(m.user_id, patch);
    if (error) toast(errorText(error), 'error');
    else toast(`${personName(m)}: ${what}`);
    await loadMembers();
    rerender();
  };

  const roster = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' },
      h('div', null, h('h2', null, `Roster (${state.members.filter((m) => m.active).length} active)`),
        h('div', { class: 'hint' }, 'Update PGY each July. Deactivate residents who leave: their cases stay, they drop out of cohort numbers.')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ui.inactive, onchange: (e) => { ui.inactive = e.target.checked; rerender(); } }), 'Show inactive')),
    members.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Role'), h('th', null, 'PGY'), h('th', null, 'Active'),
        h('th', { class: 'num' }, 'Cases'), h('th', null, 'Joined'))),
      h('tbody', null, members.map((m) => {
        const self = m.user_id === me;
        return h('tr', { class: m.active ? '' : 'inactive' },
          h('td', null, h('a', { class: 'cell-name', href: `#/resident/${m.user_id}` }, personName(m)), self ? h('span', { class: 'badge brand', style: { marginLeft: '6px' } }, 'you') : null,
            h('div', { class: 'cell-sub' }, m.email)),
          h('td', null, h('select', {
            'aria-label': `Role of ${personName(m)}`, disabled: self, title: self ? 'You can’t change your own role here' : null,
            onchange: async (e) => {
              const role = e.target.value;
              if (role === 'program_director') {
                const ok = await dialog({
                  title: `Make ${personName(m)} a program director?`,
                  body: h('p', null, 'Program directors can see every resident’s cases in this program and change its configuration.'),
                  buttons: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Make PD', value: true, kind: 'primary' }],
                });
                if (!ok) { e.target.value = m.role; return; }
              }
              save(m, { role }, role === 'program_director' ? 'now a program director' : 'now a resident');
            },
          }, h('option', { value: 'resident', selected: m.role === 'resident' }, 'Resident'),
          h('option', { value: 'program_director', selected: m.role === 'program_director' }, 'Program director'))),
          h('td', null, m.role === 'program_director' && !m.pgy_year ? h('span', { class: 'muted' }, '—') : pgySelect(m.pgy_year, (e) => save(m, { pgy_year: e.target.value ? Number(e.target.value) : null }, `PGY updated to ${e.target.value ? pgyLabel(Number(e.target.value)) : 'not set'}`), `PGY of ${personName(m)}`)),
          h('td', null, h('label', { class: 'check' }, h('input', {
            type: 'checkbox', checked: m.active, disabled: self, 'aria-label': `${personName(m)} active`,
            onchange: (e) => save(m, { active: e.target.checked }, e.target.checked ? 'reactivated' : 'deactivated'),
          }), m.active ? 'Active' : 'Inactive')),
          h('td', { class: 'num' }, fmtNum(m.case_count)),
          h('td', null, fmtDate(m.joined_at)));
      }))))
      : emptyState('Nobody here yet', 'Invite residents below.'));

  // ---------------- invitations
  const emails = h('textarea', { rows: '6', placeholder: 'jane.doe@mail.mcgill.ca\nsam.lee@gmail.com, alex.roy@mcgill.ca', 'aria-label': 'Emails to invite' });
  const role = h('select', { 'aria-label': 'Role for invitees' }, h('option', { value: 'resident' }, 'Resident'), h('option', { value: 'program_director' }, 'Program director'));
  const pgy = pgySelect(null, null, 'PGY for invitees');
  const note = h('input', { type: 'text', placeholder: 'Optional note, e.g. “Rotating from Vascular”', maxlength: '200' });
  const msg = h('p', { class: 'form-msg' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Add invitations');

  const inviteForm = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const raw = emails.value.split(/[\s,;]+/).map((s) => s.trim().replace(/^<|>$/g, '').toLowerCase()).filter(Boolean);
      const unique = [...new Set(raw)];
      const invalid = unique.filter((x) => !EMAIL_RE.test(x));
      const existing = new Set(state.invitations.map((i) => i.email.toLowerCase()));
      const already = unique.filter((x) => EMAIL_RE.test(x) && existing.has(x));
      const fresh = unique.filter((x) => EMAIL_RE.test(x) && !existing.has(x));
      if (!unique.length) { msg.className = 'form-msg error'; msg.textContent = 'Paste at least one email.'; return; }
      if (role.value === 'program_director' && fresh.length) {
        const ok = await dialog({
          title: `Invite ${fresh.length} as program director${fresh.length > 1 ? 's' : ''}?`,
          body: h('p', null, 'They will see every resident’s cases in this program and can change its configuration.'),
          buttons: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Invite', value: true, kind: 'primary' }],
        });
        if (!ok) return;
      }
      let added = 0;
      if (fresh.length) {
        submit.disabled = true;
        const { error } = await sb.from('invitations').insert(fresh.map((email) => ({
          email, program_id: state.program.id, role: role.value,
          pgy_year: pgy.value ? Number(pgy.value) : null, note: note.value.trim() || null,
        })));
        submit.disabled = false;
        if (error) { msg.className = 'form-msg error'; msg.textContent = errorText(error); return; }
        added = fresh.length;
      }
      const parts = [];
      if (added) parts.push(`Added ${added} invitation${added > 1 ? 's' : ''}.`);
      if (already.length) parts.push(`${already.length} already invited: ${already.join(', ')}.`);
      if (invalid.length) parts.push(`Not an email: ${invalid.join(', ')}.`);
      await Promise.all([loadInvitations(), loadMembers()]);
      rerender();
      toast(parts.join(' '), invalid.length && !added ? 'error' : 'ok');
    },
  },
  h('label', null, 'Emails (one per line, or separated by commas)'), emails,
  h('div', { class: 'field-row' },
    h('div', { class: 'field' }, h('label', null, 'Role'), role),
    h('div', { class: 'field' }, h('label', null, 'PGY'), pgy),
    h('div', { class: 'field grow' }, h('label', null, 'Note'), note)),
  msg,
  h('div', null, submit));

  const joined = new Set(state.members.map((m) => (m.email || '').toLowerCase()));
  const invites = state.invitations;
  const list = invites.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
    h('thead', null, h('tr', null, h('th', null, 'Email'), h('th', null, 'Role'), h('th', null, 'PGY'), h('th', null, 'Status'), h('th', null, ''))),
    h('tbody', null, invites.map((inv) => {
      const isJoined = joined.has(inv.email.toLowerCase());
      return h('tr', null,
        h('td', null, inv.email, inv.note ? h('div', { class: 'cell-sub' }, inv.note) : null,
          h('div', { class: 'cell-sub' }, `Invited ${fmtDate(inv.created_at)}`)),
        h('td', null, inv.role === 'program_director' ? 'PD' : 'Resident'),
        h('td', null, inv.pgy_year ? pgyLabel(inv.pgy_year) : '—'),
        h('td', null, isJoined ? h('span', { class: 'badge good' }, 'joined') : h('span', { class: 'badge warn' }, 'pending')),
        h('td', null, isJoined ? null : h('button', {
          class: 'btn btn-sm', onclick: async () => {
            const ok = await dialog({
              title: `Revoke the invitation for ${inv.email}?`,
              body: h('p', null, 'They won’t be enrolled when they first sign in. McGill addresses can still join from the app themselves.'),
              buttons: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Revoke', value: true, kind: 'danger' }],
            });
            if (!ok) return;
            const { data, error } = await sb.from('invitations').delete().eq('id', inv.id).select('id');
            if (error || !data?.length) return toast(error ? errorText(error) : 'Not allowed.', 'error');
            toast('Invitation revoked');
            await loadInvitations();
            rerender();
          },
        }, 'Revoke')));
    }))))
    : h('p', { class: 'muted small' }, 'No invitations yet.');

  main.append(roster, h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Invitations')),
    h('div', { class: 'notice' }, icon('info', 18), h('div', null,
      'McGill addresses (@mcgill.ca, @mail.mcgill.ca) can join your program from the app without an invitation. ',
      'Invite people to allow a non-McGill email, or to pre-assign their PGY or the program director role. ',
      'People who already have an account are added right away; others are added the first time they sign in.')),
    h('div', { class: 'invite-grid' }, h('div', null, inviteForm),
      h('div', null, h('h3', { style: { fontSize: '14px', marginBottom: '6px' } }, `Sent (${invites.length})`), list))));
}
