// Settings (ios/Bistouri/SettingsView.swift and DeleteAccountView.swift).
// Left out on the web: the Face ID app lock.
import { h, clear, logo, toast, confirmDialog } from '../../shared/util.js';
import {
  state, activeProgram, activeMembership, activeMemberships, setActiveProgram, updateName, updatePGY,
  setAnnounceAnonymously, refreshAll, signOut, sendDeletionCode, verifyDeletionCode, verifyDeletionPassword,
  deleteVerifiedAccount, isConnectivityError,
} from '../data.js';
import { icon, toggleSwitch, navigate, leave, syncValue } from '../ui.js';
import { exportCases, exportAllCases } from '../export.js';
import { usesPassword } from './signin.js';

const SITE = 'https://steadyhandsoftware.com/apps/bistouri';

function relativeTime(ts) {
  if (!ts) return 'Not yet';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.round(hr / 24)} days ago`;
}

function syncText() {
  if (state.refreshing) return 'Syncing…';
  const v = syncValue();
  if (v === 'syncing') return 'Syncing…';
  if (v === 'offline') return 'Offline';
  if (v === 'error') return 'Retrying';
  if (state.sync.pending > 0) return `${state.sync.pending} waiting`;
  return 'Up to date';
}

const group = (label, children, foot) => [
  label ? h('div', { class: 'group-label' }, label) : null,
  h('div', { class: 'group' }, children),
  foot ? h('div', { class: 'group-foot' }, foot) : null,
];

export function renderSettings(root) {
  const program = activeProgram();
  const membership = activeMembership();
  const memberships = activeMemberships();

  // Name: saved when the field loses focus or on Enter, like the app.
  const nameStatus = h('div', { class: 'group-foot' }, 'Visible to your program director.');
  const nameInput = h('input', {
    class: 'field', type: 'text', value: state.profileName, placeholder: 'First Last', autocomplete: 'name', autocapitalize: 'words',
    'aria-label': 'Your name', id: 'settings-name',
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    onblur: async (e) => {
      const trimmed = e.target.value.trim();
      if (trimmed === state.profileName) return;
      try { await updateName(trimmed); nameStatus.textContent = 'Saved.'; } catch { nameStatus.textContent = "Couldn't save your name. Check your connection."; }
    },
  });

  const pgyError = h('p', { class: 'err', style: { padding: '0 16px 10px' } });
  const pgySelect = h('select', {
    class: 'field inline', 'aria-label': 'PGY year', id: 'settings-pgy',
    onchange: async (e) => {
      try { await updatePGY(Number(e.target.value)); pgyError.textContent = ''; } catch { pgyError.textContent = "Couldn't update your PGY year. Check your connection."; }
    },
  }, [1, 2, 3, 4, 5, 6, 7, 8].map((y) => h('option', { value: y, selected: (membership?.pgy_year || 1) === y }, `PGY-${y}`)));

  const programName = (id) => state.programs.find((p) => p.id === id)?.name || 'Program';
  const programCell = memberships.length > 1
    ? h('label', { class: 'cell' }, 'Active program',
      h('select', { class: 'field inline', 'aria-label': 'Active program', onchange: (e) => setActiveProgram(e.target.value) },
        memberships.map((m) => h('option', { value: m.program_id, selected: m.program_id === state.activeProgramId }, programName(m.program_id)))))
    : h('div', { class: 'cell' }, 'Program', h('span', { class: 'val' }, program?.name || '—'));

  const anonError = h('p', { class: 'err', style: { padding: '0 16px 10px' } });
  const exportError = h('p', { class: 'err', style: { padding: '0 16px 10px' } });

  const link = (href, iconName, label) => h('a', { class: 'cell', href, target: '_blank', rel: 'noopener' }, icon(iconName), label);

  clear(root).append(h('div', { class: 'content', style: { paddingBottom: 'calc(var(--bar-h) + 40px)' } },
    h('div', { class: 'group' }, h('div', { class: 'profile' }, logo(48),
      h('div', { style: { minWidth: 0 } },
        h('div', { style: { fontWeight: 700 } }, state.profileName || state.user.email),
        state.profileName ? h('div', { class: 'small muted' }, state.user.email) : null))),

    ...group('Your name', h('div', { style: { padding: '8px 12px' } }, nameInput)), nameStatus,

    ...group('Program', [
      programCell,
      h('label', { class: 'cell' }, 'PGY year', pgySelect), pgyError,
      h('button', { type: 'button', class: 'cell', onclick: () => navigate('#/join') }, icon('plusCircle'), 'Join another program'),
    ]),

    ...group('Achievements', [
      h('div', { class: 'cell' }, icon('masks'), h('span', { class: 'grow' }, 'Announce anonymously'),
        toggleSwitch(state.announceAnonymously, async (on) => {
          try { await setAnnounceAnonymously(on); anonError.textContent = ''; } catch { anonError.textContent = "Couldn't save this setting. Check your connection."; }
        }, 'Announce anonymously')),
      anonError,
    ], 'Major achievements are announced to the residents and program directors of your program. When this is on, they say "A resident" instead of your name. Minor achievements never leave this device.'),

    ...group('Sync', [
      h('div', { class: 'cell' }, 'Status', h('span', { class: 'val', id: 'sync-status' }, syncText())),
      h('div', { class: 'cell' }, 'Last synced', h('span', { class: 'val' }, relativeTime(state.sync.lastSynced))),
      h('button', { type: 'button', class: 'cell', id: 'sync-now', disabled: state.refreshing, onclick: () => refreshAll() },
        icon('sync'), state.refreshing ? 'Syncing…' : 'Sync now'),
    ]),

    ...group('Your data', [
      h('button', {
        type: 'button', class: 'cell', id: 'export-cases',
        onclick: () => {
          try { const n = exportCases(); exportError.textContent = ''; toast(`Exported ${n} ${n === 1 ? 'case' : 'cases'}.`); } catch (err) { console.error(err); exportError.textContent = "Couldn't create the file. Try again."; }
        },
      }, icon('share'), 'Export cases to Excel'),
      exportError,
    ], `Every case you've logged in ${program?.name || 'this program'}, as a spreadsheet file with the same columns as your program director's export.`),

    ...group(null, [
      h('button', { type: 'button', class: 'cell', onclick: () => navigate('#/privacy') }, icon('hand'), 'About privacy'),
      link(`${SITE}/privacy.html`, 'doc', 'Privacy policy'),
      link(`${SITE}/terms.html`, 'doc', 'Terms of use'),
      link(`${SITE}/support.html`, 'help', 'Support'),
    ]),

    ...group(null, [
      h('button', {
        type: 'button', class: 'cell danger', id: 'sign-out',
        onclick: async () => {
          const n = state.sync.pending;
          const ok = await confirmDialog('Sign out of Bistouri?',
            n > 0 ? `${n} ${n === 1 ? "case hasn't" : "cases haven't"} synced yet. They stay on this device and sync the next time you sign in.` : 'Your cases stay safely synced.',
            n > 0 ? 'Sign out anyway' : 'Sign out', 'danger');
          if (ok) signOut();
        },
      }, icon('logout'), 'Sign out'),
      h('button', { type: 'button', class: 'cell danger', onclick: () => navigate('#/delete-account') }, icon('userX'), 'Delete account'),
    ]),
    h('p', { class: 'tiny muted', style: { textAlign: 'center', padding: '20px 0' } }, 'Bistouri for the web', h('br'), 'Log every cut.')));
}

// ---------------------------------------------------------------------------
// Delete account: a 6-digit code emailed to the account (the App Review account
// confirms with its password). The server also insists on a fresh verification.
// ---------------------------------------------------------------------------

export function renderDeleteAccount(root) {
  const email = state.user.email;
  const password = usesPassword(email);
  const caseCount = state.cases.filter((c) => !c.deleted).length;
  let verifiedAt = 0;
  let busy = false;
  const fresh = () => Date.now() - verifiedAt < 8 * 60000; // the server allows 10 minutes

  const errorEl = h('p', { class: 'err', role: 'alert', id: 'delete-error' });
  const stepBox = h('div', { class: 'stack' });

  function friendly(err) {
    const lower = `${err?.message || ''}`.toLowerCase();
    if (lower.includes('recent email verification')) { verifiedAt = 0; return 'Your code has expired. Request a new one.'; }
    if (lower.includes('expired') || (lower.includes('invalid') && (lower.includes('otp') || lower.includes('token')))) return "That code didn't work or has expired. Request a new one.";
    if (lower.includes('invalid login credentials')) return 'Wrong password.';
    if (lower.includes('rate limit') || lower.includes('security purposes') || lower.includes('too many')) return 'Too many attempts. Wait a minute and try again.';
    if (isConnectivityError(err)) return "You're offline. Connect to the internet to delete your account.";
    return "Couldn't delete your account. Try again, or email support@steadyhandsoftware.com.";
  }

  async function doDelete(secret, button) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    errorEl.textContent = '';
    try {
      if (!fresh()) {
        if (password) await verifyDeletionPassword(secret); else await verifyDeletionCode(secret);
        verifiedAt = Date.now();
      }
      await deleteVerifiedAccount();
      // Signed out: app.js shows the sign-in screen with a confirmation.
    } catch (err) {
      errorEl.textContent = friendly(err);
      busy = false;
      button.disabled = false;
    }
  }

  function stepSend() {
    if (password) {
      const pw = h('input', { class: 'field', type: 'password', placeholder: 'Password', 'aria-label': 'Password', autocomplete: 'current-password' });
      const btn = h('button', { type: 'button', class: 'btn btn-danger btn-block', onclick: () => doDelete(pw.value, btn) }, icon('trash'), 'Delete my account');
      clear(stepBox).append(pw, btn, h('p', { class: 'hint' }, "To confirm it's you, enter your password."));
      return;
    }
    const btn = h('button', {
      type: 'button', class: 'btn btn-danger btn-block', id: 'send-deletion-code',
      onclick: async () => {
        btn.disabled = true; errorEl.textContent = '';
        try { await sendDeletionCode(); verifiedAt = 0; stepCode(); } catch (err) { errorEl.textContent = friendly(err); btn.disabled = false; }
      },
    }, 'Email me a code');
    clear(stepBox).append(btn, h('p', { class: 'hint' }, `To confirm it's you, we'll email a 6-digit code to ${email}.`));
  }

  function stepCode() {
    const code = h('input', { class: 'field code-input', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '123456', 'aria-label': 'Code' });
    const btn = h('button', { type: 'button', class: 'btn btn-danger btn-block', disabled: true, onclick: () => doDelete(code.value, btn) }, icon('trash'), 'Delete my account');
    code.addEventListener('input', () => {
      const digits = code.value.replace(/\D/g, '').slice(0, 6);
      if (digits !== code.value) code.value = digits;
      btn.disabled = digits.length !== 6 && !fresh();
    });
    clear(stepBox).append(
      h('div', { class: 'lbl' }, 'Enter the code'), code, btn,
      h('button', { type: 'button', class: 'link', onclick: async () => { try { await sendDeletionCode(); } catch (err) { errorEl.textContent = friendly(err); } } }, 'Resend code'),
      h('p', { class: 'hint' }, `We sent a 6-digit code to ${email}. It may say it's a sign-in code; enter it here.`));
    code.focus();
  }

  const bullet = (text) => h('li', null, text);

  // Offered first so a resident leaving the program keeps a copy of their training record.
  const downloadNote = h('p', { class: 'hint', id: 'download-note' });
  const downloadBtn = h('button', {
    type: 'button', class: 'btn btn-block', id: 'download-before-delete',
    onclick: async () => {
      downloadBtn.disabled = true; downloadNote.textContent = '';
      try {
        const { files, count } = await exportAllCases();
        downloadNote.textContent = `Downloaded ${count} ${count === 1 ? 'case' : 'cases'}${files > 1 ? ` in ${files} files, one per program` : ''}.`;
      } catch (err) {
        console.error(err);
        downloadNote.textContent = "Couldn't create the file. Try again.";
      }
      downloadBtn.disabled = false;
    },
  }, icon('share'), 'Download your cases first');
  const downloadCard = caseCount > 0 ? h('div', { class: 'card stack' },
    h('div', { style: { fontWeight: 700 } }, 'Keep a copy'),
    h('p', { class: 'small', style: { margin: 0 } }, "Your case log is part of your training record and can't be recovered once your account is deleted. Save a spreadsheet of every case you've logged before you continue."),
    downloadBtn, downloadNote) : null;

  clear(root).append(h('div', { class: 'screen' },
    h('header', { class: 'topbar' },
      h('div', { class: 'left' }, h('button', { type: 'button', class: 'toplink', onclick: () => { if (!busy) leave('#/settings'); } }, icon('back'), 'Settings')),
      h('h1', null, 'Delete account'), h('div', { class: 'right' })),
    h('div', { class: 'content stack', style: { paddingBottom: '40px' } },
      h('div', { class: 'card' },
        h('div', { class: 'row', style: { color: 'var(--bad)', fontWeight: 700 } }, icon('info'), 'This permanently deletes:'),
        h('ul', { style: { margin: 0, paddingLeft: '20px' }, class: 'small' },
          bullet(`Your Bistouri account (${email})`),
          bullet(caseCount === 1 ? "The 1 case you've logged, in every program" : `All ${caseCount} cases you've logged, in every program`),
          bullet('Your program memberships. Your program directors will no longer see your cases.'),
          bullet('The copy of your cases on this device'))),
      h('p', { class: 'hint' }, "This can't be undone. To stop using Bistouri on this device only, sign out instead."),
      downloadCard,
      h('div', { class: 'card' }, stepBox),
      errorEl)));
  stepSend();
}

/** About privacy (PrivacyView), adapted to the web. */
export function renderPrivacy(root) {
  const block = (title, iconName, color, items) => h('div', { class: 'card' },
    h('div', { class: 'card-head', style: { color } }, icon(iconName), title),
    h('ul', { style: { margin: 0, paddingLeft: '20px' } }, items.map((t) => h('li', { class: 'small' }, t))));
  clear(root).append(h('div', { class: 'screen' },
    h('header', { class: 'topbar' },
      h('div', { class: 'left' }, h('button', { type: 'button', class: 'toplink', onclick: () => leave('#/settings') }, icon('back'), 'Settings')),
      h('h1', null, 'About privacy'), h('div', { class: 'right' })),
    h('div', { class: 'content stack', style: { paddingBottom: '40px' } },
      h('p', { style: { fontWeight: 650, fontSize: '19px' } }, 'Bistouri is built so that no patient can be identified from your case log.'),
      block('What is synced', 'cloudOk', 'var(--brand-ink)', [
        'Case date, hospital site and attending', 'Procedures, approach, urgency and your role', 'Procedural tasks and counts',
        'Program-defined details (for example side or fluoroscopy time)', 'Your name, email, program and PGY year', 'Major achievements you unlock']),
      block('Stays on this device', 'lock', 'var(--accent-ink)', [
        'A copy of your cases, so the log works without signal (removed if you delete your account)', 'Your favourite procedures', 'Minor achievements']),
      block('Never collected', 'x', 'var(--bad)', [
        'Patient names, MRN or health card numbers', 'Dates of birth, ages or room numbers', 'Location, contacts, photos or analytics']),
      block('Who can see your cases', 'people', 'var(--ring-3)', [
        'You', 'The program directors of the programs you join, to follow your progress',
        "Your program's residents see your major achievements, never your cases. You can announce them anonymously in Settings."]),
      h('p', { class: 'small muted' }, "Your case log is stored in Canada (Montréal data centre). Data is protected by row-level security: each request is checked against your account on the server. You can delete a case at any time; it is removed from your log and your program's reports."),
      h('p', { class: 'small muted' }, 'The iPhone app also offers an encrypted private note per case. It never leaves the iPhone, so it is not available on the web.'))));
}
