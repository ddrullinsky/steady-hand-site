// Sign-in (email + 6-digit code, magic link, localhost-only password) and the
// friendly screen for people who are not program directors.
import { sb, state } from '../api.js';
import { h, clear, logo } from '../util.js';
import { SUPPORT_EMAIL } from '../../config.js';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
const isLocal = LOCAL_HOSTS.includes(location.hostname) || location.hostname.endsWith('.localhost');

function friendlyAuthError(err) {
  const m = (err?.message || '').toLowerCase();
  if (m.includes('database error') || m.includes('mcgill') || m.includes('not allowed') || m.includes('signups not allowed')) {
    return 'This email is not registered for Bistouri. Use your McGill address, or ask the Bistouri team for an invitation.';
  }
  if (m.includes('rate limit') || err?.status === 429) return 'Too many attempts. Please wait a minute and try again.';
  if (m.includes('invalid login')) return 'Wrong email or password.';
  if (m.includes('expired') || m.includes('invalid') || m.includes('token')) return 'That code is invalid or has expired. Request a new one.';
  return err?.message || 'Something went wrong. Please try again.';
}

function card(...children) {
  return h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'auth-brand' }, logo(44),
        h('div', null, h('div', { class: 'auth-title' }, 'Bistouri'), h('div', { class: 'muted' }, 'Program director dashboard'))),
      ...children),
    h('p', { class: 'auth-foot' }, 'McGill surgical case log. No patient identifiers are stored.'));
}

export function renderSignIn(root, initialError) {
  let email = '';
  const msg = h('p', { class: 'form-msg', role: 'alert' }, initialError || '');
  const body = h('div');

  function setMsg(text, kind = 'error') {
    msg.textContent = text || '';
    msg.className = `form-msg ${kind}`;
  }

  function stepEmail() {
    const input = h('input', { type: 'email', id: 'signin-email', required: true, autocomplete: 'email', placeholder: 'firstname.lastname@mcgill.ca', value: email });
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Email me a sign-in code');
    const form = h('form', {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        email = input.value.trim().toLowerCase();
        btn.disabled = true; btn.textContent = 'Sending…'; setMsg('');
        const { error } = await sb.auth.signInWithOtp({
          email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
        });
        btn.disabled = false; btn.textContent = 'Email me a sign-in code';
        if (error) return setMsg(friendlyAuthError(error));
        stepCode();
      },
    },
    h('label', { for: 'signin-email' }, 'Work email'), input, btn);
    clear(body).append(h('h1', { class: 'auth-h1' }, 'Sign in'), form);
    input.focus();
  }

  function stepCode() {
    const input = h('input', {
      type: 'text', id: 'signin-code', inputmode: 'numeric', autocomplete: 'one-time-code',
      pattern: '[0-9]{6,10}', maxlength: '10', required: true, placeholder: '123456', class: 'code-input',
    });
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in');
    const form = h('form', {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; btn.textContent = 'Checking…'; setMsg('');
        const { error } = await sb.auth.verifyOtp({ email, token: input.value.trim(), type: 'email' });
        btn.disabled = false; btn.textContent = 'Sign in';
        if (error) setMsg(friendlyAuthError(error));
        // success: onAuthStateChange takes over
      },
    },
    h('p', null, 'We sent a 6-digit code to ', h('strong', null, email), '. Enter it below, or click the link in the email.'),
    h('label', { for: 'signin-code' }, 'Sign-in code'), input, btn,
    h('div', { class: 'row-between' },
      h('button', { type: 'button', class: 'link', onclick: () => { setMsg(''); stepEmail(); } }, 'Use a different email'),
      h('button', {
        type: 'button', class: 'link',
        onclick: async () => {
          const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
          setMsg(error ? friendlyAuthError(error) : 'A new code is on its way.', error ? 'error' : 'ok');
        },
      }, 'Send a new code')));
    clear(body).append(h('h1', { class: 'auth-h1' }, 'Check your email'), form);
    input.focus();
  }

  const dev = isLocal ? devForm(setMsg) : null;
  const request = h('p', { class: 'small muted', style: { margin: 0 } }, 'New to Bistouri? ',
    h('button', { type: 'button', class: 'link', id: 'request-program', onclick: () => renderRequestProgram(root) }, 'Request it for your program'));
  clear(root).append(card(body, msg, request, dev));
  stepEmail();
}

/** "Request a program": anyone can ask, no account needed (sign-in is limited to
 *  McGill and invited emails). Admins approve on the Admin page, which creates the
 *  program and invites the requester as its program director. */
export function renderRequestProgram(root, { email = '', signedIn = false } = {}) {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const field = (id, label, input, hint) => [h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null];
  const input = (id, attrs = {}) => h('input', { id, type: 'text', required: true, ...attrs });
  const name = input('req-name', { autocomplete: 'name', maxlength: '120' });
  const mail = input('req-email', { type: 'email', autocomplete: 'email', maxlength: '254', value: email, readonly: signedIn && !!email });
  const program = input('req-program', { placeholder: 'e.g. Orthopaedic Surgery', maxlength: '120' });
  const institution = input('req-institution', { placeholder: 'e.g. McGill University', maxlength: '160' });
  const residents = h('input', { id: 'req-residents', type: 'number', min: '1', max: '500', inputmode: 'numeric' });
  const note = h('textarea', { id: 'req-message', rows: '3', maxlength: '2000', placeholder: 'Anything we should know: your rotation sites, when you would like to start…' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Send request');
  const back = signedIn
    ? h('button', { type: 'button', class: 'link', onclick: () => renderNotDirector(root) }, 'Back')
    : h('button', { type: 'button', class: 'link', onclick: () => renderSignIn(root) }, 'Back to sign in');

  const form = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = 'Sending…';
      msg.textContent = '';
      const { error } = await sb.from('program_requests').insert({
        email: mail.value.trim().toLowerCase(), full_name: name.value.trim(), program_name: program.value.trim(),
        institution: institution.value.trim(), resident_count: residents.value ? Number(residents.value) : null,
        message: note.value.trim() || null,
      });
      btn.disabled = false; btn.textContent = 'Send request';
      if (error) {
        msg.className = 'form-msg error';
        msg.textContent = error.code === 'P0001' ? error.message
          : error.code === '23514' ? 'Please check the fields: some are too short or too long.'
            : 'Could not send your request. Please try again in a moment.';
        return;
      }
      clear(body).append(h('h1', { class: 'auth-h1' }, 'Request sent'),
        h('p', null, 'Thank you. We will review it and email ', h('strong', null, mail.value.trim().toLowerCase()),
          ' once your program is set up. You will then sign in here with that address and find a starting set of lists to adjust.'),
        back);
    },
  },
  ...field('req-name', 'Your name', name),
  ...field('req-email', 'Work email', mail, 'Your sign-in address once the program is approved.'),
  ...field('req-program', 'Program', program),
  ...field('req-institution', 'University', institution),
  ...field('req-residents', 'Number of residents (optional)', residents),
  ...field('req-message', 'Message (optional)', note),
  btn);

  const body = h('div', null,
    h('h1', { class: 'auth-h1' }, 'Request Bistouri for your program'),
    h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'For program directors. We set up your program with a starting procedure list you can edit, and invite you as its director.'),
    form);
  clear(root).append(card(body, msg, back));
  name.focus();
}

function devForm(setMsg) {
  const em = h('input', { type: 'email', id: 'dev-email', autocomplete: 'username', required: true });
  const pw = h('input', { type: 'password', id: 'dev-password', autocomplete: 'current-password', required: true });
  return h('details', { class: 'dev-signin' },
    h('summary', null, 'Developer sign-in (localhost only)'),
    h('form', {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        setMsg('');
        const { error } = await sb.auth.signInWithPassword({ email: em.value.trim(), password: pw.value });
        if (error) setMsg(friendlyAuthError(error));
      },
    },
    h('label', { for: 'dev-email' }, 'Email'), em,
    h('label', { for: 'dev-password' }, 'Password'), pw,
    h('button', { class: 'btn btn-block', type: 'submit' }, 'Sign in with password')));
}

export function renderNotDirector(root) {
  const isResident = state.memberships.some((m) => m.role === 'resident' && m.active);
  clear(root).append(card(
    h('h1', { class: 'auth-h1' }, 'This dashboard is for program directors'),
    h('p', null, isResident
      ? 'You are signed in as a resident. Log your cases in the Bistouri iPhone app: your progress, targets and milestones are all there.'
      : 'Log your cases in the Bistouri iPhone app. If you direct a surgical program, request it below, or ask the Bistouri team for access to one that already exists.'),
    h('p', { class: 'muted' }, 'Signed in as ', h('strong', null, state.profile?.email || state.session?.user?.email || ''), '.'),
    h('div', { class: 'row-between' },
      h('button', {
        type: 'button', class: 'link', id: 'request-program',
        onclick: () => renderRequestProgram(root, { email: state.profile?.email || state.session?.user?.email || '', signedIn: true }),
      }, 'Request a program'),
      h('a', { href: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Bistouri dashboard access')}` }, 'Ask for access to an existing one'),
      h('button', { class: 'btn', onclick: () => sb.auth.signOut() }, 'Sign out')),
  ));
}
