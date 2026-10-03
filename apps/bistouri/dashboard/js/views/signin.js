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
  clear(root).append(card(body, msg, dev));
  stepEmail();
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
      : 'Log your cases in the Bistouri iPhone app. If you direct a McGill surgical program and need access here, contact the Bistouri team.'),
    h('p', { class: 'muted' }, 'Signed in as ', h('strong', null, state.profile?.email || state.session?.user?.email || ''), '.'),
    h('div', { class: 'row-between' },
      h('a', { href: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Bistouri dashboard access')}` }, 'Request PD access'),
      h('button', { class: 'btn', onclick: () => sb.auth.signOut() }, 'Sign out')),
  ));
}
