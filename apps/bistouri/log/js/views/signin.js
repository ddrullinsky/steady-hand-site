// Sign-in (ios/Bistouri/AuthView.swift): McGill email, then the 6-digit code from
// the email. Code only: McGill's Safe Links opens (and so spends) emailed links.
// The App Review account signs in with a password, and on localhost a developer
// password form is offered for the test accounts, as on the dashboard.
import { h, clear, logo } from '../../shared/util.js';
import { sb, state } from '../data.js';
import { icon } from '../ui.js';

const REVIEW_ACCOUNT = 'appreview@steadyhandsoftware.com';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
export const isLocal = LOCAL_HOSTS.includes(location.hostname) || location.hostname.endsWith('.localhost');
export const usesPassword = (email) => email.trim().toLowerCase() === REVIEW_ACCOUNT;

export function friendlyAuthError(err) {
  const lower = `${err?.message || ''} ${err?.code || ''}`.toLowerCase();
  if (!navigator.onLine || /failed to fetch|load failed|networkerror/.test(lower)) return "You're offline. Connect to the internet to sign in.";
  if (lower.includes('mcgill') || lower.includes('invitation') || lower.includes('database error saving new user') || lower.includes('signups not allowed')) {
    return 'Bistouri is open to McGill addresses. Ask your program director for an invitation.';
  }
  if (lower.includes('expired') || (lower.includes('invalid') && (lower.includes('otp') || lower.includes('token')))) {
    return "That code didn't work or has expired. Request a new one.";
  }
  if (lower.includes('invalid login credentials')) return 'Wrong email or password.';
  if (lower.includes('rate limit') || lower.includes('security purposes') || lower.includes('too many') || err?.status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  return 'Sign-in failed. Check your email and try again.';
}

export function renderSignIn(root) {
  let email = '';
  const msg = h('p', { class: 'err', role: 'alert' });
  const body = h('div', { class: 'stack' });
  const setMsg = (text) => { msg.textContent = text || ''; };
  const plausible = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

  function stepEmail() {
    const input = h('input', {
      class: 'field', type: 'email', id: 'signin-email', autocomplete: 'email', inputmode: 'email',
      placeholder: 'first.last@mail.mcgill.ca', value: email, autocapitalize: 'off', spellcheck: 'false',
    });
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit', disabled: !plausible(email) }, 'Email me a code');
    input.addEventListener('input', () => { btn.disabled = !plausible(input.value.trim().toLowerCase()); });
    const form = h('form', {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        email = input.value.trim().toLowerCase();
        if (!plausible(email)) return;
        setMsg('');
        if (usesPassword(email)) return stepPassword();
        btn.disabled = true; btn.textContent = 'Sending…';
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        btn.disabled = false; btn.textContent = 'Email me a code';
        if (error) return setMsg(friendlyAuthError(error));
        stepCode();
      },
    },
    h('label', { class: 'lbl', for: 'signin-email' }, 'Sign in with your McGill email'), input, btn,
    h('p', { class: 'hint' }, "We'll email you a 6-digit code. No password needed."));
    clear(body).append(form);
    input.focus();
  }

  function stepCode() {
    const input = h('input', {
      class: 'field code-input', type: 'text', id: 'signin-code', inputmode: 'numeric', autocomplete: 'one-time-code',
      maxlength: '6', placeholder: '123456', 'aria-label': 'Sign-in code',
    });
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit', disabled: true }, 'Sign in');
    let busy = false;
    const verify = async () => {
      const code = input.value;
      if (code.length !== 6 || busy) return;
      busy = true; btn.disabled = true; btn.textContent = 'Checking…'; setMsg('');
      const { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
      busy = false; btn.textContent = 'Sign in';
      if (error) {
        setMsg(friendlyAuthError(error));
        input.value = '';
        btn.disabled = true;
        input.focus();
      }
      // Success: the auth listener in app.js takes over.
    };
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 6);
      if (digits !== input.value) input.value = digits;
      btn.disabled = digits.length !== 6;
      if (digits.length === 6) verify();
    });
    const form = h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); verify(); } },
      h('h2', { style: { fontSize: '18px' } }, 'Check your email'),
      h('p', { class: 'muted' }, 'Enter the 6-digit code we sent to ', h('strong', null, email), '.'),
      input, btn,
      h('div', { class: 'row-between' },
        h('button', { type: 'button', class: 'link', onclick: () => { setMsg(''); stepEmail(); } }, 'Use a different email'),
        h('button', {
          type: 'button', class: 'link',
          onclick: async () => {
            const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
            setMsg(error ? friendlyAuthError(error) : '');
            if (!error) msg.append(h('span', { class: 'ok-text' }, 'A new code is on its way.'));
          },
        }, 'Resend code')));
    clear(body).append(form);
    input.focus();
  }

  /** Only the App Review demo account reaches this step. */
  function stepPassword() {
    const pw = h('input', { class: 'field', type: 'password', autocomplete: 'current-password', 'aria-label': 'Password', placeholder: 'Password' });
    const form = h('form', {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        setMsg('');
        const { error } = await sb.auth.signInWithPassword({ email, password: pw.value });
        if (error) setMsg(friendlyAuthError(error));
      },
    },
    h('h2', { style: { fontSize: '18px' } }, 'Enter your password'),
    h('p', { class: 'muted' }, email), pw,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in'),
    h('button', { type: 'button', class: 'link', onclick: () => { setMsg(''); stepEmail(); } }, 'Use a different email'));
    clear(body).append(form);
    pw.focus();
  }

  clear(root).append(h('div', { class: 'auth' },
    h('div', { class: 'auth-inner' },
      h('div', { class: 'auth-brand' }, logo(88),
        h('h1', null, 'Bistouri'),
        h('div', { class: 'tagline' }, 'Log every cut.'),
        h('div', { class: 'muted' }, 'Case log · McGill Surgery')),
      state.accountDeleted ? h('div', { class: 'notice', role: 'status' }, icon('check'), 'Your account and all your cases were deleted.') : null,
      h('div', { class: 'card' }, body, msg),
      h('p', { class: 'hint row' }, icon('hand', 16), 'No patient identifiers, ever. Only case details you choose to log.'),
      isLocal ? devForm(setMsg) : null)));
  stepEmail();
}

function devForm(setMsg) {
  const em = h('input', { class: 'field', type: 'email', id: 'dev-email', autocomplete: 'off', placeholder: 'Email' });
  const pw = h('input', { class: 'field', type: 'password', id: 'dev-password', autocomplete: 'off', placeholder: 'Password' });
  return h('details', { class: 'dev' },
    h('summary', null, 'Developer sign-in (localhost only)'),
    h('form', {
      class: 'stack', style: { marginTop: '12px' },
      onsubmit: async (e) => {
        e.preventDefault();
        setMsg('');
        const { error } = await sb.auth.signInWithPassword({ email: em.value.trim().toLowerCase(), password: pw.value });
        if (error) setMsg(friendlyAuthError(error));
      },
    },
    h('label', { class: 'sr-only', for: 'dev-email' }, 'Email'), em,
    h('label', { class: 'sr-only', for: 'dev-password' }, 'Password'), pw,
    h('button', { class: 'btn btn-block', type: 'submit' }, 'Sign in with password'),
    h('p', { class: 'hint' }, 'For test accounts.')));
}
