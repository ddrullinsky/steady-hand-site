// Achievement medals, the detail panel, the "New achievement!" notification after a
// save, and program announcements (ios/Bistouri/Achievements.swift, Announcements.swift).
// Minor achievements stay on this device. Majors are recorded in achievement_unlocks
// (data.announce) and shown to the program, by name or as "A resident".
import { h, clear } from '../../shared/util.js';
import { icon } from '../ui.js';

/** The round badge: tinted when earned, a lock (or "?") when not. */
export function medal(a, { size = 60, forceEarned = false } = {}) {
  const earned = a.earned || forceEarned;
  const el = h('span', { class: `medal ${a.isMajor || a.tier === 'major' ? 'major' : ''} ${earned ? 'earned' : ''}`, style: { width: `${size}px`, height: `${size}px` } });
  if (earned) el.append(icon(a.tier === 'major' ? 'trophy' : 'medal', Math.round(size * 0.45)));
  else if (a.hidden) el.append(h('span', { class: 'q' }, '?'));
  else el.append(icon('lock', Math.round(size * 0.33)));
  return el;
}

export function achievementTile(a, onSelect) {
  return h('button', {
    type: 'button', class: `tile ${a.earned ? '' : 'locked'}`, onclick: () => onSelect(a), dataset: { achievement: a.id },
    'aria-label': `${a.displayTitle}. ${a.isMajor ? 'Major' : 'Minor'}. ${a.earned ? 'Earned' : 'Locked'}`,
  }, medal(a), h('span', { class: 't' }, a.displayTitle),
  a.progress && !a.isSecret ? h('span', { class: 'tiny muted num' }, a.progress) : null);
}

export function achievementGrid(list, onSelect) {
  return h('div', { class: 'medal-grid' }, list.map((a) => achievementTile(a, onSelect)));
}

const sysLabel = (text) => h('div', { class: 'sys-label' }, text);
const reward = (text) => h('div', { class: 'reward' }, h('b', null, 'Reward: '), text);

/** Element.append() writes null as text; h() children skip it, so wrap lists in this. */
const kids = (...list) => list.flat().filter(Boolean);

/** A dark "System" panel over a scrim. Returns { el, close }. */
function panel(major, build, onClose) {
  const host = document.getElementById('overlays');
  const scrim = h('div', { class: 'scrim', role: 'dialog', 'aria-modal': 'true' });
  const box = h('div', { class: `sys ${major ? 'major' : ''}` });
  scrim.append(box);
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  build(box, close);
  host.append(scrim);
  box.querySelector('button')?.focus();
  return close;
}

/** Re-read an achievement in full, or see how far along a locked one is. */
export function showAchievementDetail(a) {
  panel(a.isMajor, (box) => {
    box.append(...kids(
      h('div', { class: 'sys-head' }, medal(a, { size: 58 }),
        h('div', null, sysLabel(a.earned ? (a.isMajor ? 'Major achievement' : 'Achievement') : 'Locked'),
          h('div', { class: 'sys-title' }, a.displayTitle))),
      a.earned ? h('p', { class: 'sys-text' }, a.message) : null,
      a.earned ? reward(a.reward) : null,
      !a.earned && a.isSecret ? h('p', { class: 'sys-text' }, 'Hidden achievement. The System will not say what it is. Keep logging.') : null,
      !a.earned && !a.isSecret ? h('p', { class: 'sys-text num' }, a.progress ? `Progress: ${a.progress}` : 'Not yet earned.') : null,
      a.isMajor ? h('p', { class: 'sys-dim' }, 'Major achievements are announced to your program.') : null,
      h('button', { type: 'button', class: `btn btn-primary btn-block ${a.isMajor ? 'btn-amber' : ''}`, onclick: () => box.closest('.scrim').click() }, 'Close')));
  });
}

/** "New achievement!" after a save, one at a time (AchievementOverlay). */
export function showCelebration(list, { programName, anonymous, onDone }) {
  let index = 0;
  let confetti = null;
  const close = panel(list[0].isMajor, (box, done) => {
    const draw = () => {
      const a = list[index];
      const remaining = list.length - index - 1;
      box.className = `sys ${a.isMajor ? 'major' : ''}`;
      confetti?.remove();
      confetti = a.isMajor ? confettiLayer() : null;
      if (confetti) document.getElementById('overlays').append(confetti);
      clear(box).append(...kids(
        h('div', { class: 'sys-head' }, medal(a, { size: 58, forceEarned: true }),
          h('div', null, sysLabel(a.isMajor ? 'Major achievement!' : 'New achievement!'), h('div', { class: 'sys-title' }, a.title))),
        h('p', { class: 'sys-text' }, a.message),
        reward(a.reward),
        a.isMajor ? h('div', { class: 'announced' }, icon('megaphone', 16),
          anonymous ? `Announced anonymously to ${programName}.` : `Announced to ${programName}.`) : null,
        h('button', {
          type: 'button', class: `btn btn-primary btn-block ${a.isMajor ? 'btn-amber' : ''}`, id: 'celebration-dismiss',
          onclick: () => { if (remaining > 0) { index++; draw(); } else done(); },
        }, remaining > 0 ? `Next (${remaining} more)` : 'Noted.')));
      box.querySelector('button')?.focus();
    };
    draw();
  }, () => { confetti?.remove(); onDone?.(); });
  return close;
}

export function announcementSentence(a) {
  return `${a.name || 'A resident'} ${a.achievement.announcement || ''}`.trim();
}

function relative(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'last month' : `${months} months ago`;
}

function announcementText(a) {
  return [
    h('div', null, h('div', { style: { fontWeight: 650 } }, announcementSentence(a)), h('div', { class: 'sys-dim' }, relative(a.date))),
    h('hr'),
    sysLabel('The achievement'),
    h('p', { class: 'sys-text' }, a.achievement.message),
    reward(a.achievement.reward),
  ];
}

function announcementHead(a) {
  return h('div', { class: 'sys-head' }, medal({ ...a.achievement, isMajor: true }, { size: 58, forceEarned: true }),
    h('div', null, sysLabel('Program announcement'), h('div', { class: 'sys-title' }, a.achievement.title)));
}

/** Unlocks by others in the program since last seen, one at a time (AnnouncementOverlay). */
export function showAnnouncementQueue(list, onDone) {
  let index = 0;
  panel(true, (box, done) => {
    const draw = () => {
      const a = list[index];
      const remaining = list.length - index - 1;
      clear(box).append(...kids(announcementHead(a), announcementText(a),
        h('button', { type: 'button', class: 'btn btn-primary btn-block btn-amber', onclick: () => { if (remaining > 0) { index++; draw(); } else done(); } },
          remaining > 0 ? `Next (${remaining} more)` : 'Noted.'),
        remaining > 0 ? h('button', { type: 'button', class: 'link', onclick: done }, 'Dismiss all') : null));
    };
    draw();
  }, onDone);
}

export function showAnnouncementDetail(a) {
  panel(true, (box, done) => {
    box.append(announcementHead(a), ...announcementText(a),
      h('button', { type: 'button', class: 'btn btn-primary btn-block btn-amber', onclick: done }, 'Close'));
  });
}

export function announcementRow(a, onSelect) {
  return h('button', { type: 'button', class: 'ann', onclick: () => onSelect(a) },
    h('span', { class: 'dot' }, icon('trophy', 16)),
    h('span', { class: 'grow' },
      h('div', { style: { fontWeight: 650, fontSize: '15px' } }, a.achievement.title, a.isMine ? h('span', { class: 'you' }, 'You') : null),
      h('div', { class: 'small muted' }, announcementSentence(a)),
      h('div', { class: 'tiny muted' }, relative(a.date))),
    icon('chevron', 14));
}

/** Light confetti for major achievements (a canvas that removes itself). */
function confettiLayer() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const canvas = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = innerWidth, H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#f9735b', '#0f766e', '#f59e0b', '#6366f2', '#ec4899'];
  const pieces = Array.from({ length: 90 }, () => ({
    x: Math.random() * W, delay: Math.random() * 0.6, speed: 0.35 + Math.random() * 0.35, drift: -60 + Math.random() * 120,
    spin: 2 + Math.random() * 6, size: 6 + Math.random() * 6, color: colors[Math.floor(Math.random() * colors.length)], circle: Math.random() < 0.5,
  }));
  const start = performance.now();
  const frame = (now) => {
    if (!canvas.isConnected) return;
    const t = (now - start) / 1000;
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of pieces) {
      const local = t - p.delay;
      if (local < 0) { alive = true; continue; }
      const y = -20 + local * p.speed * H;
      if (y > H + 20) continue;
      alive = true;
      ctx.save();
      ctx.translate(p.x + Math.sin(local * 2) * p.drift, y);
      ctx.rotate(local * p.spin);
      ctx.fillStyle = p.color;
      if (p.circle) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
  return canvas;
}
