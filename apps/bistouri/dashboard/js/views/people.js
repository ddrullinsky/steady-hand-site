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
  // Paste anything: a column of emails, or a coordinator's list with level headers
  // ("R3", "PGY-2", "Fellow") above or beside each email. Each email picks up the
  // level on its line, or the last level heading above it; the preview lets you fix it.
  const emails = h('textarea', { rows: '7', placeholder: 'jane.doe@mail.mcgill.ca\nsam.lee@gmail.com, alex.roy@mcgill.ca\n\nOr paste the list from your program office:\nR3\nDr Jane Doe\njane.doe@mail.mcgill.ca', 'aria-label': 'Emails to invite' });
  const role = h('select', { 'aria-label': 'Role for invitees' }, h('option', { value: 'resident' }, 'Resident'), h('option', { value: 'program_director' }, 'Program director'));
  const pgy = pgySelect(null, null, 'PGY for invitees without a level');
  const note = h('input', { type: 'text', placeholder: 'Optional note, e.g. “Rotating from Vascular”', maxlength: '200' });
  const msg = h('p', { class: 'form-msg' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Add invitations');
  const preview = h('div');
  let rows = [];

  const drawPreview = () => {
    const existing = new Set(state.invitations.map((i) => i.email.toLowerCase()));
    const members = new Set(state.members.map((m) => (m.email || '').toLowerCase()));
    rows = parseInviteList(emails.value);
    for (const r of rows) {
      r.status = members.has(r.email) ? 'member' : existing.has(r.email) ? 'invited' : 'new';
      r.include = r.status === 'new';
    }
    submit.lastChild.textContent = rows.some((r) => r.include) ? `Add ${rows.filter((r) => r.include).length} invitation${rows.filter((r) => r.include).length > 1 ? 's' : ''}` : 'Add invitations';
    if (!rows.length) { preview.replaceChildren(); return; }
    const count = () => {
      const n = rows.filter((r) => r.include).length;
      submit.lastChild.textContent = n ? `Add ${n} invitation${n > 1 ? 's' : ''}` : 'Add invitations';
    };
    preview.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'table compact', id: 'invite-preview' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Email'), h('th', null, 'PGY'), h('th', null, ''))),
      h('tbody', null, rows.map((r) => h('tr', { class: r.include ? '' : 'inactive' },
        h('td', null, h('input', { type: 'checkbox', checked: r.include, disabled: r.status !== 'new', 'aria-label': `Invite ${r.email}`,
          onchange: (e) => { r.include = e.target.checked; e.target.closest('tr').className = r.include ? '' : 'inactive'; count(); } })),
        h('td', null, r.email, r.name ? h('div', { class: 'cell-sub' }, r.name) : null),
        h('td', null, r.fellow && !r.pgy ? h('span', { class: 'cell-sub' }, 'Fellow') : null,
          pgySelect(r.pgy, (e) => { r.pgy = e.target.value ? Number(e.target.value) : null; }, `PGY for ${r.email}`)),
        h('td', null, r.status === 'member' ? h('span', { class: 'badge good' }, 'already in program')
          : r.status === 'invited' ? h('span', { class: 'badge' }, 'already invited') : null)))))),
    h('p', { class: 'hint' }, 'PGY was read from the list where it could be. Rows without one use the PGY below.'));
  };
  emails.addEventListener('input', drawPreview);

  const inviteForm = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      drawPreviewIfStale();
      const fresh = rows.filter((r) => r.include);
      const invalid = emails.value.replace(/<?mailto:[^>\s]*>?/gi, ' ').split(/[\s,;()<>]+/).filter((t) => t.includes('@') && !EMAIL_RE.test(t.replace(/[.]+$/, '')));
      if (!rows.length) { msg.className = 'form-msg error'; msg.textContent = 'Paste at least one email.'; return; }
      if (role.value === 'program_director' && fresh.length) {
        const ok = await dialog({
          title: `Invite ${fresh.length} as program director${fresh.length > 1 ? 's' : ''}?`,
          body: h('p', null, 'They will see every resident’s cases in this program and can change its configuration.'),
          buttons: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Invite', value: true, kind: 'primary' }],
        });
        if (!ok) return;
      }
      if (fresh.length) {
        submit.disabled = true;
        const fallback = pgy.value ? Number(pgy.value) : null;
        const { error } = await sb.from('invitations').insert(fresh.map((r) => ({
          email: r.email, program_id: state.program.id, role: role.value,
          pgy_year: r.pgy ?? fallback, note: note.value.trim() || (r.fellow ? 'Fellow' : null),
        })));
        submit.disabled = false;
        if (error) { msg.className = 'form-msg error'; msg.textContent = errorText(error); return; }
      }
      const skipped = rows.length - fresh.length;
      const parts = [];
      if (fresh.length) parts.push(`Added ${fresh.length} invitation${fresh.length > 1 ? 's' : ''}.`);
      if (skipped) parts.push(`${skipped} skipped (already in the program, invited, or unticked).`);
      if (invalid.length) parts.push(`Not an email: ${invalid.join(', ')}.`);
      await Promise.all([loadInvitations(), loadMembers()]);
      rerender();
      toast(parts.join(' '), invalid.length && !fresh.length ? 'error' : 'ok');
      if (fresh.length && role.value === 'resident') showWelcomeEmail(fresh.map((r) => r.email));
    },
  },
  h('label', null, 'Emails: one per line, separated by commas, or the list from your program office'), emails,
  preview,
  h('div', { class: 'field-row' },
    h('div', { class: 'field' }, h('label', null, 'Role'), role),
    h('div', { class: 'field' }, h('label', null, 'PGY if not in the list'), pgy),
    h('div', { class: 'field grow' }, h('label', null, 'Note'), note)),
  msg,
  h('div', { class: 'toolbar' }, submit,
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => showWelcomeEmail(state.invitations
      .filter((i) => i.role === 'resident' && !state.members.some((m) => (m.email || '').toLowerCase() === i.email.toLowerCase()))
      .map((i) => i.email)) }, icon('mail'), 'Welcome email for pending invitations')));
  function drawPreviewIfStale() { if (!rows.length && emails.value.trim()) drawPreview(); }

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

// ---------------------------------------------------------------------------
// Pasted invitation lists
// ---------------------------------------------------------------------------

const LEVEL_RE = /\b(?:PGY|R)\s*-?\s*([1-8])\b/i;
const FELLOW_RE = /\bfellow\b/i;
const EMAIL_IN_TEXT = /[^\s@,;<>()"'\[\]]+@[^\s@,;<>()"'\[\]]+\.[a-z]{2,}/gi;

/** Emails in pasted text, each with the PGY (and name) found on its line or above it. */
export function parseInviteList(text) {
  const out = [];
  const seen = new Set();
  let level = null; let fellow = false; let name = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/<?mailto:[^>\s]*>?/gi, ' ').trim();
    if (!line) continue;
    const found = line.match(EMAIL_IN_TEXT) || [];
    const rest = line.replace(EMAIL_IN_TEXT, ' ');
    const lv = LEVEL_RE.exec(rest);
    const isFellow = FELLOW_RE.test(rest);
    if (!found.length) {
      if (lv || isFellow) { level = lv ? Number(lv[1]) : null; fellow = isFellow && !lv; name = ''; }
      const leftover = rest.replace(LEVEL_RE, '').replace(FELLOW_RE, '').replace(/[|:\-–]+/g, ' ').trim();
      if (leftover && /[a-z]/i.test(leftover) && leftover.length <= 80) name = leftover.replace(/^(dr\.?|dre\.?)\s+/i, '');
      continue;
    }
    const inlineName = rest.replace(LEVEL_RE, '').replace(FELLOW_RE, '').replace(/[|:,;\-–]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^(dr\.?|dre\.?)\s+/i, '');
    for (const e of found) {
      const email = e.toLowerCase().replace(/[.]+$/, '');
      if (seen.has(email)) continue;
      seen.add(email);
      out.push({
        email, pgy: lv ? Number(lv[1]) : level, fellow: lv ? false : (isFellow || fellow),
        name: found.length === 1 && inlineName ? inlineName : name,
      });
    }
    name = '';
  }
  return out;
}

/** A welcome email for invited residents, opened as a draft in the PD's own mail app. */
function showWelcomeEmail(addresses) {
  if (!addresses.length) return toast('No pending resident invitations.', 'error');
  const base = 'https://steadyhandsoftware.com/apps/bistouri';
  const program = state.program.name;
  const subject = `Bistouri: your ${program} case log`;
  const body = `Hello,

You have been invited to Bistouri, the case log for ${program}. You log each OR case on your phone in under 30 seconds, see where you stand against the program's targets, and get the EPAs each case could count toward.

iPhone: install Bistouri from the App Store
https://apps.apple.com/ca/app/bistouri/id6817524582

Android: open Bistouri for the web in Chrome, then tap the ⋮ menu and "Add to home screen"
${base}/log/

Sign in with this email address and the 6-digit code you receive (no password). Your program and PGY year are already set.

Getting started guide: ${base}/start.html

No patient identifiers are ever entered in Bistouri. Questions: support@steadyhandsoftware.com`;
  const href = `mailto:?bcc=${encodeURIComponent(addresses.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const text = h('textarea', { rows: '14', readonly: true }, body);
  const dlg = h('dialog', { class: 'modal', 'aria-labelledby': 'welcome-res-title', style: { width: 'min(640px, 94vw)' } });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(
    h('h2', { id: 'welcome-res-title' }, 'Let your residents know'),
    h('div', { class: 'modal-body' },
      h('p', null, `Invitations don't send any email. Open this as a draft (addressed in Bcc to ${addresses.length} resident${addresses.length > 1 ? 's' : ''}), or copy it. Attaching the printable guide from the getting started page helps.`),
      text,
      h('p', { class: 'hint' }, addresses.join(', '))),
    h('div', { class: 'modal-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'Close'),
      h('button', { type: 'button', class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(addresses.join(', ')); toast('Addresses copied'); } catch { /* ignore */ } } }, 'Copy addresses'),
      h('button', { type: 'button', class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(body); toast('Email copied'); } catch { text.select(); } } }, 'Copy email'),
      h('a', { class: 'btn btn-primary', href, style: { textDecoration: 'none' } }, 'Open draft in mail')));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
}
