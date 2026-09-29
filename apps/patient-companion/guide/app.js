// app.js — the web edition of Cardiac Surgery Patient Companion.
// Renders the same content.json the iOS app ships, as a read-only guide: the
// operation guides, checklists and "When to get help". The personal tools —
// surgery date, My path, bookmarks, checklist ticks, care-team number — are
// the paid app's, and the page points to it wherever they would appear.
// Only the language and the disclaimer acknowledgement are saved (localStorage);
// the page makes no requests beyond its own files.

import * as L from "./logic.js?v=135dd045a9";

// ---------------------------------------------------------------- storage
// Keys match the app's UserDefaults keys, so the two read the same.
const K = {
  lang: "preop-lang",
  ack: "preop-disclaimer-ack-v3",
};

// The App Store page. Empty until the app is live: the "Get the app" cards then
// say "coming soon" instead of linking. Format: https://apps.apple.com/app/id<Apple ID>
// (the Apple ID is on App Store Connect → App Information).
const APP_STORE_URL = "";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
};

// ---------------------------------------------------------------- state
let content = null;
const S = {
  lang: "en",
  weekSel: {},   // opKey → chosen week index (not persisted, like the app)
};

function loadState() {
  const saved = store.get(K.lang);
  S.lang = saved === "fr" || saved === "en"
    ? saved
    : ((navigator.language || "en").toLowerCase().startsWith("fr") ? "fr" : "en");
}

const T = () => content[S.lang];
const en = () => S.lang === "en";

// ---------------------------------------------------------------- web wording
const WEB = {
  en: {
    patientGuide: "Patient guide", duration: "Duration", hospital: "Hospital", recovery: "Recovery",
    done: "Done", langLabel: "Switch to French", privacy: "Privacy", support: "Support", menu: "Sections",
    appTitle: "Follow your own surgery with the app",
    appBody: "The iPhone and iPad app adds the tools for your own journey: set your surgery date for a countdown and see which recovery week you are in, follow My path from surgery through intensive care, the ward and home, bookmark your operations, tick off your checklists and keep your care team's number one tap away. It works offline, and everything stays on your device.",
    appButton: "Download on the App Store",
    appSoon: "Coming soon to the App Store.",
    appHint: "In the app, this timeline opens on your current week once you set your surgery date.",
    toolsSub: "What to do before surgery and what to bring to the hospital.",
  },
  fr: {
    patientGuide: "Guide du patient", duration: "Durée", hospital: "Hôpital", recovery: "Convalescence",
    done: "Terminé", langLabel: "Passer en anglais", privacy: "Confidentialité", support: "Assistance", menu: "Sections",
    appTitle: "Suivez votre propre chirurgie avec l\u2019application",
    appBody: "L\u2019application pour iPhone et iPad ajoute des outils pour votre propre parcours\u00a0: entrez la date de votre chirurgie pour voir un compte à rebours et votre semaine de convalescence, suivez Mon parcours de la chirurgie aux soins intensifs, à l\u2019unité de soins puis à la maison, épinglez vos opérations, cochez vos listes et gardez le numéro de votre équipe de soins à portée de main. Elle fonctionne hors ligne, et tout reste sur votre appareil.",
    appButton: "Télécharger dans l\u2019App Store",
    appSoon: "Bientôt offerte dans l\u2019App Store.",
    appHint: "Dans l\u2019application, cette ligne du temps s\u2019ouvre sur votre semaine actuelle une fois la date de chirurgie entrée.",
    toolsSub: "Quoi faire avant la chirurgie et quoi apporter à l\u2019hôpital.",
  },
};
const W = () => WEB[S.lang];
const site = () => T().site;

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const paras = (s) => String(s || "").split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join("");
const pad2 = (n) => String(n).padStart(2, "0");

const ICON = {
  heart: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21C5 15 3 10 6 7c2.5-2.5 5-1 6 1 1-2 3.5-3.5 6-1 3 3 1 8-6 14Z"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5C5.5 15 3.5 10.5 6 7.5c2.3-2.6 4.8-1.3 6 .8 1.2-2.1 3.7-3.4 6-.8 2.5 3 .5 7.5-6 13Z"/><path d="M4.5 12.5h4l1.5-2.5 2.5 5 1.5-2.5h5.5"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 21H20"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 6 1.5 1.5L8 4.5M3.5 13l1.5 1.5L8 11.5"/><path d="M11 6h9.5M11 13h9.5M11 20h9.5M4 20h3"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M12 10.5v6M9 13.5h6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  phoneApp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
};

/** "Get the app" card, shown where the app's personal tools would be. */
function appCard() {
  const w = W();
  return `<section class="card get-app" aria-labelledby="get-app">
    <div class="get-app-head"><span class="glyph">${ICON.phoneApp}</span><h2 id="get-app" class="big">${esc(w.appTitle)}</h2></div>
    <p class="lede small">${esc(w.appBody)}</p>
    ${APP_STORE_URL ? `<a class="primary" href="${esc(APP_STORE_URL)}">${esc(w.appButton)}</a>` : `<p class="status">${esc(w.appSoon)}</p>`}
  </section>`;
}

// ---------------------------------------------------------------- views
function viewHome() {
  const t = T(), s = site();
  let h = `<div class="stack">
    <section class="hero">
      <p class="eyebrow">${esc(W().patientGuide)}</p>
      <h1>${esc(s.tagline)}</h1>
      <p class="lede">${esc(s.intro)}</p>
    </section>
    <section class="op-list">
    <div class="section-head"><h2>${esc(s.selectOp)}</h2>
    <p class="lede">${esc(s.selectOpSub)}</p></div>`;
  for (const cat of L.sectionOrder(t.operations)) {
    const ops = t.operations.filter((o) => o.category === cat);
    if (!ops.length) continue;
    h += `<p class="eyebrow cat">${esc(t.categories[cat] || cat)}</p>${ops.map(opCard).join("")}`;
  }
  h += `</section>${appCard()}<p class="quiet">${esc(s.footerNote)}</p></div>`;
  return { title: s.practiceName, html: h };
}

function metaList(op) {
  return `<dl class="meta">
    <div><dt>${esc(W().duration)}</dt><dd>${esc(op.duration)}</dd></div>
    <div><dt>${esc(W().hospital)}</dt><dd>${esc(op.stay)}</dd></div>
    <div><dt>${esc(W().recovery)}</dt><dd>${esc(op.recovery)}</dd></div>
  </dl>`;
}

function opCard(op) {
  return `<a class="card op-card" href="#/op/${esc(op.key)}">
    <div class="op-card-head">
      <span class="glyph">${ICON.pulse}</span>
      <div><p class="eyebrow">${esc(op.short)}</p><h3>${esc(op.name)}</h3></div>
      <span class="arrow">${ICON.arrow}</span>
    </div>
    <p class="lede">${esc(op.lede)}</p>
    ${metaList(op)}
  </a>`;
}

const CHAPTERS = ["what", "why", "before", "day", "hospital", "home", "activity"];

function viewOperation(key) {
  const t = T(), op = t.operations.find((o) => o.key === key);
  if (!op) return null;
  const d = op.detail, s = site();
  const shell = (i, id, ch, inner) => `<section class="chapter" id="ch-${id}" data-chapter="${id}" aria-labelledby="h-${id}">
      <p class="num">${pad2(i + 1)}</p><h2 id="h-${id}">${esc(ch.heading)}</h2>${inner}</section>`;
  const terms = (items) => `<dl class="terms">${items.map((x) => `<div><dt>${esc(x.t)}</dt><dd>${esc(x.d)}</dd></div>`).join("")}</dl>`;

  const body = {
    what: `<p class="lede">${esc(d.what.body)}</p><p class="lede">${esc(d.what.body2)}</p><div class="callout">${esc(d.what.callout)}</div>`,
    why: `<p class="lede">${esc(d.why.body)}</p><ul class="benefits">${d.why.benefits.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`,
    before: `<p class="lede">${esc(d.before.body)}</p>${terms(d.before.items)}`,
    day: `<p class="lede">${esc(d.day.body)}</p>${d.day.note ? `<p class="quiet">${esc(d.day.note)}</p>` : ""}
      <div class="timeline-day">${d.day.timeline.map((x) => `<div><span class="time">${esc(x.time)}</span><span>${esc(x.t)}</span></div>`).join("")}</div>
      <div class="callout soft">${esc(d.day.callout)}</div>`,
    hospital: `<p class="lede">${esc(d.hospital.body)}</p><div class="phases">${d.hospital.phases.map((p, i) =>
      `<div class="card phase-card"><span class="num">${pad2(i + 1)}</span><h3>${esc(p.t)}</h3><p class="lede">${esc(p.d)}</p></div>`).join("")}</div>`,
    home: `<p class="lede">${esc(d.home.body)}</p><div id="weeks">${weeksWidget(op)}</div><p class="quiet small">${esc(W().appHint)}</p>`,
    activity: `<p class="lede">${esc(d.activity.body)}</p>${terms(d.activity.rules)}`,
  };

  const html = `<div class="stack">
    <div class="op-head">
      <div><p class="eyebrow">${esc(op.short)}</p><h1>${esc(op.name)}</h1></div>
    </div>
    <p class="lede">${esc(op.lede)}</p>
    ${metaList(op)}
    <nav class="chapter-bar" aria-label="${esc(W().menu)}">
      ${CHAPTERS.map((c, i) => `<a class="chip" href="#/op/${esc(op.key)}/${c}" data-chip="${c}">${pad2(i + 1)} · ${esc(t.chapters[c])}</a>`).join("")}
    </nav>
    ${CHAPTERS.map((c, i) => shell(i, c, d[c], body[c])).join("")}
    <p class="quiet">${esc(s.footerNote)}</p>
  </div>`;
  return { title: `${op.name} — ${s.practiceName}`, html, op };
}

/** Week-by-week slider. Browsing only: anchoring it to a surgery date is an app feature. */
function weeksWidget(op) {
  const steps = op.detail.home.timeline;
  if (!steps.length) return "";
  const idx = Math.min(S.weekSel[op.key] ?? 0, steps.length - 1);
  const w = steps[idx];
  const fill = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 0;
  return `<div class="weeks" style="--n:${steps.length}">
    <div class="weeks-dots" role="group" aria-label="${esc(T().chapters.home)}">
      <div class="weeks-track"><div class="weeks-fill" style="--fill:${fill}%"></div></div>
      ${steps.map((st, i) => `<button class="week-dot${i < idx ? " done" : ""}" data-action="week" data-key="${esc(op.key)}" data-i="${i}"
          aria-pressed="${i === idx}" aria-label="${esc(st.week)}"><span aria-hidden="true">${esc(L.shortLabel(st.week))}</span><i></i></button>`).join("")}
    </div>
    <div class="week-body" aria-live="polite">
      <p class="eyebrow">${esc(w.week)}</p>
      <h3>${esc(w.title)}</h3>
      <p class="lede">${esc(w.d)}</p>
    </div>
  </div>`;
}

/** Checklists as plain reading lists; ticking them off is an app feature. */
function viewPrepare() {
  const t = T(), s = site();
  const list = (id, cl) => `<section class="card" aria-labelledby="cl-${id}">
      <h2 id="cl-${id}" class="big">${esc(cl.title)}</h2><p class="lede small">${esc(cl.sub)}</p>
      <ul class="checks read">${cl.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    </section>`;
  const html = `<div class="stack">
    <div class="section-head"><h1>${esc(s.tools)}</h1><p class="lede">${esc(W().toolsSub)}</p></div>
    ${list("prep", t.tools.prep)}
    ${list("pack", t.tools.pack)}
    ${appCard()}
    <p class="quiet">${esc(s.footerNote)}</p>
  </div>`;
  return { title: `${s.tabPrepare} — ${s.practiceName}`, html };
}

function viewHelp() {
  const c = T().care, s = site();
  const tier = (k, x) => `<section class="tier ${k}" aria-labelledby="t-${k}"><h2 id="t-${k}">${esc(x.label)}</h2>
    <p class="${k === "emergency" ? "" : "lede"}">${esc(x.note)}</p><ul>${x.signs.map((g) => `<li>${esc(g)}</li>`).join("")}</ul></section>`;
  const html = `<div class="stack">
    <div class="section-head"><h1>${esc(c.title)}</h1><p class="lede">${esc(c.intro)}</p></div>
    ${tier("emergency", c.emergency)}${tier("urgent", c.urgent)}${tier("normal", c.normal)}
    <p class="quiet">${esc(s.footerNote)}</p></div>`;
  return { title: `${s.getHelp} — ${s.practiceName}`, html };
}

// ---------------------------------------------------------------- chrome
function renderChrome(route) {
  const s = site();
  document.documentElement.lang = S.lang;
  document.querySelector(".brand-name").innerHTML = esc(s.practiceName) + (s.doctorName ? `<span class="brand-sub">${esc(s.doctorName)}</span>` : "");
  const lang = document.getElementById("lang");
  lang.innerHTML = en() ? "<b>EN</b> · FR" : "EN · <b>FR</b>";
  lang.setAttribute("aria-label", W().langLabel);
  const tabs = [
    ["#/", s.tabGuide, ICON.book, route.tab === "guide"],
    ["#/prepare", s.tabPrepare, ICON.list, route.tab === "prepare"],
    ["#/help", s.getHelp, ICON.cross, route.tab === "help"],
  ];
  document.getElementById("tabs").innerHTML = tabs.map(([href, label, icon, on]) =>
    `<a class="tab" href="${href}"${on ? ' aria-current="page"' : ""}>${icon}<span>${esc(label)}</span></a>`).join("");

  // Full-length once per visit, like the app — but not while the disclaimer
  // sheet still covers it, or the first full showing would go unseen.
  const seen = session.get("preop-safety-seen");
  if (store.get(K.ack) === "1") session.set("preop-safety-seen", "1");
  document.getElementById("safety").innerHTML = `<div class="safety-inner">
    <button class="safety-note" data-action="important">${seen ? "" : `<p>${esc(s.disclaimerScreenNote)}</p>`}<span>${esc(s.importantLink)} ›</span></button>
    <div class="contact solo">
      <button class="em" data-action="emergency">${ICON.cross}<span>${esc(s.emergencyAction)}</span></button>
    </div></div>`;
  document.getElementById("foot").innerHTML = `<span>${esc(s.reviewedNote)}</span>
    <a href="../privacy.html">${esc(W().privacy)}</a><a href="../support.html">${esc(W().support)}</a>`;
  measureHeader();
}

/** Sticky header height drives the chapter bar's position and where a jump lands. */
function measureHeader() {
  const h = document.querySelector(".top").offsetHeight;
  const root = document.documentElement.style;
  root.setProperty("--top-h", h + "px");
  root.scrollPaddingTop = h + 56 + "px"; // header + chapter bar
}

// ---------------------------------------------------------------- router
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "op" && parts[1]) return { tab: "guide", op: parts[1], chapter: parts[2] };
  if (["prepare", "help"].includes(parts[0])) return { tab: parts[0] };
  return { tab: "guide" };
}

let current = null;       // { tab, op } last rendered
let spy = null;

function render({ keepScroll = false, focusChapter = null } = {}) {
  const route = parseRoute();
  const view = route.op ? viewOperation(route.op)
    : route.tab === "prepare" ? viewPrepare()
    : route.tab === "help" ? viewHelp()
    : viewHome();
  if (!view) { location.replace("#/"); return; }
  renderChrome(route);
  const main = document.getElementById("main");
  main.innerHTML = view.html;
  document.title = view.title;
  current = route;
  if (spy) { spy.disconnect(); spy = null; }
  const target = focusChapter || route.chapter;
  if (target && document.getElementById("ch-" + target)) {
    document.getElementById("ch-" + target).scrollIntoView();
  } else if (!keepScroll) {
    window.scrollTo(0, 0);
  }
  if (view.op) setupSpy();
}

function setupSpy() {
  const chips = [...document.querySelectorAll("[data-chip]")];
  const bar = document.querySelector(".chapter-bar");
  const sections = [...document.querySelectorAll(".chapter")];
  let shown = null, queued = false;
  // The chapter being read is the last one whose top has passed the chapter bar.
  const update = () => {
    queued = false;
    const line = bar.getBoundingClientRect().bottom + 24;
    let id = sections[0].dataset.chapter;
    for (const sec of sections) if (sec.getBoundingClientRect().top <= line) id = sec.dataset.chapter;
    // At the very bottom the last chapter may never reach the line.
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) id = sections.at(-1).dataset.chapter;
    if (id === shown) return;
    shown = id;
    chips.forEach((c) => {
      const on = c.dataset.chip === id;
      c.setAttribute("aria-current", on ? "true" : "false");
      if (on) bar.scrollTo({ left: c.offsetLeft - bar.clientWidth / 2 + c.clientWidth / 2, behavior: "smooth" });
    });
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener("scroll", onScroll, { passive: true });
  spy = { disconnect: () => removeEventListener("scroll", onScroll) };
  update();
}

/** The chapter currently at the top, so a language switch can land back on it. */
function currentChapter() {
  const on = document.querySelector('[data-chip][aria-current="true"]');
  return on ? on.dataset.chip : null;
}

window.addEventListener("hashchange", () => {
  const next = parseRoute();
  // A chapter link within the guide already on screen only scrolls.
  if (current?.op && next.op === current.op) {
    const el = document.getElementById("ch-" + (next.chapter || "what"));
    if (next.chapter && el) { el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); return; }
  }
  render();
});

// ---------------------------------------------------------------- dialogs
const dlg = () => document.getElementById("dlg");

function openDialog(html, { locked = false } = {}) {
  const d = dlg();
  d.innerHTML = `<div class="dlg">${html}</div>`;
  d.dataset.locked = locked ? "1" : "";
  if (!d.open) d.showModal();
  d.querySelector("[autofocus]")?.focus();
}
function closeDialog() { const d = dlg(); if (d.open) d.close(); }

function noticeDialog(title, body) {
  openDialog(`<div class="dlg-head"><h2>${esc(title)}</h2><button class="dlg-close" data-action="close" autofocus>${esc(W().done)}</button></div>${body}`);
}

function disclaimerDialog() {
  const s = site();
  openDialog(`<h2>${esc(s.disclaimerTitle)}</h2>${paras(s.disclaimerBody)}
    <div class="actions"><button class="primary" data-action="ack" autofocus>${esc(s.disclaimerAck)}</button></div>`, { locked: true });
}

function importantDialog() {
  const s = site();
  noticeDialog(s.importantTitle, `${paras(s.disclaimerBody)}<p>${esc(s.footerNote)}</p><p class="small mute">${esc(s.reviewedNote)}</p>
    <p class="small"><a href="../privacy.html">${esc(W().privacy)}</a> · <a href="../support.html">${esc(W().support)}</a></p>`);
}

// ---------------------------------------------------------------- events
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action, s = site();
  switch (a) {
    case "lang": {
      const ch = current?.op ? currentChapter() : null;
      S.lang = en() ? "fr" : "en"; store.set(K.lang, S.lang);
      render({ keepScroll: !ch, focusChapter: ch });
      if (dlg().open && dlg().dataset.locked) disclaimerDialog();
      break;
    }
    case "week": {
      S.weekSel[b.dataset.key] = +b.dataset.i;
      const op = T().operations.find((o) => o.key === b.dataset.key);
      document.getElementById("weeks").innerHTML = weeksWidget(op);
      document.querySelector(`#weeks [data-i="${b.dataset.i}"]`)?.focus();
      break;
    }
    case "important": importantDialog(); break;
    case "emergency": noticeDialog(T().care.emergency.label, `<p>${esc(T().care.emergency.note)}</p>`); break;
    case "close": closeDialog(); break;
    case "ack": store.set(K.ack, "1"); closeDialog(); render({ keepScroll: true }); break;
  }
});


// ---------------------------------------------------------------- boot
async function boot() {
  try {
    const res = await fetch("content.json?v=135dd045a9", { cache: "no-cache" });
    content = await res.json();
    if (!content.en || !content.fr) throw new Error("content");
  } catch {
    document.getElementById("main").innerHTML = `<div class="card"><h1>Something went wrong</h1>
      <p class="lede">The guide could not be loaded. Please reload the page. · Le guide n'a pas pu être chargé. Veuillez recharger la page.</p></div>`;
    return;
  }
  loadState();
  // Escape can't dismiss the first-visit disclaimer; it has to be acknowledged.
  dlg().addEventListener("cancel", (e) => { if (dlg().dataset.locked) e.preventDefault(); });
  render();
  if (store.get(K.ack) !== "1") disclaimerDialog();
  window.addEventListener("resize", measureHeader);
}
boot();
