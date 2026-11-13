/* app.js — ECC Playbook (وب‌اپ، بدون وابستگی)
   ماژول ES: مسیریابی هش‌محور، رندر ویوها، جست‌وجوی فازی، کپی، تم، پالت دستور. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ── وضعیت ─────────────────────────────────────────── */
const state = {
  data: { skills: [], commands: [], agents: [], version: "2.2.3" },
  services: [],
  filterTag: "all",
  serviceQuery: "",
  libKind: "skills",
  libQuery: "",
  libLimit: 60,
  libOnlyMine: false,
  current: null,
};

const ready = (async () => {
  const [dataRes, pbRes] = await Promise.all([
    fetch("assets/data.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("assets/playbooks.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (dataRes) state.data = dataRes;
  state.services = (pbRes && pbRes.services) || [];
  if (!state.data.skills.length || !state.services.length) throw new Error("کاتالوگ یا مسیرها بارگذاری نشد");
  buildIndexes();
  paintStaticBindings();
})();

const skillSet = new Set();
const commandSet = new Set();
const agentSet = new Set();
function buildIndexes() {
  state.data.skills.forEach((s) => skillSet.add(s.name));
  state.data.commands.forEach((s) => commandSet.add(s.name));
  state.data.agents.forEach((s) => agentSet.add(s.name));
}

/* ── تم ─────────────────────────────────────────────── */
const THEME_KEY = "ecc-theme";
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#111b19" : "#f5f7f5");
  const ico = $("#themeIcon");
  if (ico) ico.textContent = t === "dark" ? "☀" : "◐";
  $("#themeToggle")?.setAttribute("aria-label", t === "dark" ? "تغییر به تم روشن" : "تغییر به تم تاریک");
}
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  const prefersDark = (() => {
    try { return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false; } catch { return false; }
  })();
  applyTheme(saved || (prefersDark ? "dark" : "light"));
})();
$("#themeToggle")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
});

/* ── توست و کپی ─────────────────────────────────────── */
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2000);
}
async function copyText(text, okMsg = "کپی شد ✓") {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
    toast(ok ? okMsg : "کپی نشد — دستی انتخاب کنید");
    return ok;
  }
}
function markDone(btn, label = "کپی شد ✓") {
  if (!btn) return;
  btn.dataset.label ||= btn.textContent;
  btn.textContent = label;
  btn.classList.add("is-done");
  setTimeout(() => { btn.textContent = btn.dataset.label; btn.classList.remove("is-done"); }, 1600);
}

/* ── کلیدواژهٔ جست‌وجوی نرمال‌شده (فارسی/عربی) ───────── */
const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/[\u0643]/g, "ک")
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/[\u064B-\u065F]/g, "");

/* ── اتصال مقادیر ثابت صفحه ─────────────────────────── */
function paintStaticBindings() {
  const d = state.data;
  const counts = {
    "count-skills": d.skills.length,
    "count-commands": d.commands.length,
    "count-agents": d.agents.length,
    "count-services": state.services.length,
    "count-prompts": state.services.reduce((a, s) => a + (s.prompts?.length || 0), 0),
    "count-total": d.skills.length + d.commands.length + d.agents.length,
  };
  $$("[data-bind]").forEach((el) => {
    const key = el.dataset.bind;
    if (key === "version") el.textContent = d.version || "2.2.3";
    else if (key in counts) el.textContent = fa(counts[key]);
  });
  document.title = `Agent Studio — ${fa(state.services.length)} مسیر کاری و ابزارهای ایجنت`;
}

/* ── پیشرفت محلی مسیرها ────────────────────────────── */
const PROGRESS_KEY = "agent-studio-progress-v1";
let progress = {};
try { const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); if (saved && typeof saved === "object" && !Array.isArray(saved)) progress = saved; } catch {}
function progressFor(id) {
  const item = progress[id];
  return { favorite: item?.favorite === true, steps: Array.isArray(item?.steps) ? item.steps.filter((i) => Number.isInteger(i) && i >= 0) : [] };
}
function saveProgress(id, item) {
  progress[id] = item;
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch { toast("ذخیره روی مرورگر ممکن نبود."); }
}
function renderJourney() {
  const host = $("#journeyList");
  const items = state.services.filter((s) => { const p = progressFor(s.id); return p.favorite || p.steps.some((i) => i < (s.steps?.length || 0)); });
  if (!items.length) { host.innerHTML = `<div class="journey-empty"><span>✧</span><div><strong>هنوز مسیری ذخیره نشده</strong><p>یک مسیر را باز کنید، ذخیره کنید و مراحل انجام‌شده را علامت بزنید.</p></div><a href="#/services">انتخاب مسیر ←</a></div>`; return; }
  host.innerHTML = items.map((s) => {
    const p = progressFor(s.id), total = s.steps?.length || 0, done = new Set(p.steps.filter((i) => i < total)).size;
    return `<a href="#/s/${esc(s.id)}" class="journey-item"><span class="journey-icon">${esc(s.icon || "◆")}</span><span class="journey-item-body"><strong>${esc(s.title)} ${p.favorite ? "★" : ""}</strong><small>${fa(done)} از ${fa(total)} مرحله انجام شده</small><span class="journey-track"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></span></span><span aria-hidden="true">←</span></a>`;
  }).join("");
}
function paintProgress(s) {
  const p = progressFor(s.id), total = s.steps?.length || 0, done = new Set(p.steps.filter((i) => i < total)).size;
  const fav = $("#favoritePlaybook");
  fav.setAttribute("aria-pressed", String(p.favorite)); fav.textContent = p.favorite ? "★ مسیر ذخیره شد" : "☆ ذخیره مسیر";
  $("#pbProgress").textContent = `${fa(done)} از ${fa(total)} مرحله انجام شده · ذخیره در همین مرورگر`;
}

/* ── کارت‌های خدمت ──────────────────────────────────── */
function cardHtml(s, compact = false) {
  return `
  <li class="card${compact ? " card--compact" : ""}" data-id="${esc(s.id)}">
    <a class="card__hit" href="#/s/${esc(s.id)}" aria-label="${esc(s.title)} — دیدن مسیر">
      <div class="card__top">
        <span class="card__icon" aria-hidden="true">${esc(s.icon || "◆")}</span>
        <div class="card__head">
          <h3 class="card__title">${esc(s.title)}</h3>
          <p class="card__tagline">${esc(s.tagline || "")}</p>
        </div>
      </div>
      ${compact ? "" : `<p class="card__summary">${esc(s.summary || "")}</p>`}
      <div class="card__foot">
        <span class="card__count">${fa(s.skills?.length || 0)} اسکیل · ${fa(s.commands?.length || 0)} دستور · ${fa(s.agents?.length || 0)} agent</span>
        <span class="card__open" aria-hidden="true">دیدن مسیر ←</span>
      </div>
    </a>
  </li>`;
}

function renderPopular() {
  const popular = ["website", "webapp", "api", "harness"].map((id) => state.services.find((s) => s.id === id)).filter(Boolean);
  $("#popularCards").innerHTML = popular.map((s) => cardHtml(s, true)).join("");
}

function renderTagFilter() {
  const tags = new Set();
  state.services.forEach((s) => (s.tags || []).forEach((t) => tags.add(t)));
  const label = {
    all: "همه", frontend: "فرانت‌اند", backend: "بک‌اند", design: "طراحی", data: "داده",
    ai: "AI", quality: "کیفیت", security: "امنیت", devops: "دواپس", architecture: "معماری",
    mobile: "موبایل", testing: "تست", docs: "مستندات", content: "محتوا", harness: "هارنس",
  };
  $("#tagFilter").innerHTML =
    `<button class="chip is-active" data-tag="all" type="button">همه</button>` +
    [...tags]
      .map((t) => `<button class="chip" data-tag="${esc(t)}" type="button">${esc(label[t] || t)}</button>`)
      .join("");
}

function renderServices() {
  const q = normalize(state.serviceQuery);
  const list = state.services.filter((s) => {
    const tagOk = state.filterTag === "all" || (s.tags || []).includes(state.filterTag);
    const qOk = !q || normalize(`${s.title} ${s.tagline} ${s.summary} ${(s.tags || []).join(" ")}`).includes(q);
    return tagOk && qOk;
  });
  $("#serviceCards").innerHTML = list.map((s) => cardHtml(s)).join("");
  $("#serviceEmpty").hidden = list.length > 0;
}

/* ── رندر مسیر ──────────────────────────────────────── */
const pill = (name, kind, label) => {
  const known = kind === "skill" ? skillSet.has(name) : kind === "command" ? commandSet.has(name) : agentSet.has(name);
  const display = kind === "command" ? `/${name}` : kind === "agent" ? name : name;
  return `<button class="pill pill--${kind}" type="button" data-copy-text="${esc(display)}"${
    known ? "" : ' data-missing="1" title="در کاتالوگ پیدا نشد"'
  }>${esc(label || display)}</button>`;
};

function renderPlaybook(id) {
  const s = state.services.find((x) => x.id === id);
  if (!s) { location.hash = "#/services"; return; }
  state.current = s;

  $("#pbCrumb").textContent = s.title;
  $("#pbIcon").textContent = s.icon || "◆";
  $("#pbTitle").textContent = s.title;
  $("#pbTagline").textContent = s.tagline || "";
  $("#pbSummary").textContent = s.summary || "";

  $("#pbMeta").innerHTML = [
    `<span class="tag tag--accent">${esc(s.tagline || "")}</span>`,
    ...(s.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`),
    `<span class="tag">${fa(s.steps?.length || 0)} مرحله</span>`,
    `<span class="tag">${fa(s.prompts?.length || 0)} پرامپت آماده</span>`,
  ].join("");

  $("#pbToc").innerHTML = `
    <a href="#/s/${esc(s.id)}/steps">مراحل</a>
    <a href="#/s/${esc(s.id)}/prompts">پرامپت‌ها</a>
    <a href="#/s/${esc(s.id)}/pitfalls">تله‌ها</a>
    <a href="#/s/${esc(s.id)}/toolbox">جعبه‌ابزار</a>`;

  $("#pbSteps").innerHTML = (s.steps || [])
    .map(
      (st, i) => `
      <li id="step-${i + 1}">
        <label class="step-check"><input type="checkbox" data-step="${i}" ${progressFor(s.id).steps.includes(i) ? "checked" : ""} /><span class="step-title">${esc(st.t)}</span></label>
        <p>${esc(st.d)}</p>
        ${st.cmds?.length ? `<div class="cmds">${st.cmds.map((c) => `<button type="button" class="cmd-chip" data-copy-text="${esc(String(c))}" title="کپی">${esc(c)}</button>`).join("")}</div>` : ""}
      </li>`
    )
    .join("");

  paintProgress(s);

  const groups = [
    ["اسکیل‌ها", (s.skills || []).map((n) => pill(n, "skill"))],
    ["دستورها", (s.commands || []).map((n) => pill(n, "command"))],
    ["agentها", (s.agents || []).map((n) => pill(n, "agent"))],
  ].filter(([, items]) => items.length);
  $("#pbToolbox").innerHTML = groups
    .map(([label, items]) => `<div class="toolbox__group"><h4>${label}</h4><div class="toolbox__items">${items.join("")}</div></div>`)
    .join("");

  const profile = s.install?.profile || "developer";
  const skillArg = s.install?.skills ? ` \\\n  --skills ${s.install.skills}` : "";
  const cmd = `git clone https://github.com/affaan-m/ecc.git && cd ecc\n./install.sh --profile ${profile} --target claude${skillArg}`;
  $("#pbInstall").textContent = cmd;
  const copyBtn = $("#pbInstall").parentElement.querySelector(".cmd__copy");
  copyBtn.dataset.copyText = cmd;
  copyBtn.dataset.label = "کپی";

  $("#pbDeliverable").textContent = s.deliverable || "—";

  $("#pbPrompts").innerHTML = (s.prompts || [])
    .map(
      (p, i) => `
      <article class="prompt" id="prompt-${i + 1}">
        <div class="prompt__head">
          <h3 class="prompt__title">${esc(p.title || `پرامپت ${fa(i + 1)}`)}</h3>
          <button class="prompt__copy" type="button" data-prompt="${i}" data-id="${esc(s.id)}" aria-label="کپی پرامپت">کپی</button>
        </div>
        <pre class="prompt__body" tabindex="0">${esc(p.text)}</pre>
      </article>`
    )
    .join("");

  $("#pbPitfalls").innerHTML = (s.pitfalls || []).map((x) => `<li>${esc(x)}</li>`).join("");

  const related = state.services
    .filter((x) => x.id !== s.id && (x.tags || []).some((t) => (s.tags || []).includes(t)))
    .slice(0, 4);
  $("#pbRelated").innerHTML = related.length
    ? related.map((r) => `<li><a href="#/s/${esc(r.id)}"><span aria-hidden="true">${esc(r.icon || "◆")}</span> ${esc(r.title)}</a></li>`).join("")
    : `<li class="muted">—</li>`;
}

/* ── کتابخانه ───────────────────────────────────────── */
const LIB = () => ({ skills: state.data.skills, commands: state.data.commands, agents: state.data.agents });

function myNames(kind) {
  const key = kind === "skills" ? "skills" : kind === "commands" ? "commands" : "agents";
  const set = new Set();
  state.services.forEach((s) => (s[key] || []).forEach((n) => set.add(n)));
  return set;
}

function renderLibrary() {
  const list = LIB()[state.libKind] || [];
  const q = normalize(state.libQuery);
  const mine = state.libOnlyMine ? myNames(state.libKind) : null;
  const filtered = list.filter((x) => {
    if (mine && !mine.has(x.name)) return false;
    if (!q) return true;
    return normalize(x.name).includes(q) || normalize(x.desc).includes(q);
  });
  const slice = filtered.slice(0, state.libLimit);

  $("#libList").innerHTML = slice
    .map(
      (x) => `
    <li>
      <button class="lib__name" type="button" data-copy-text="${esc(state.libKind === "commands" ? "/" + x.name : x.name)}" title="کپی نام">
        <span class="mark" aria-hidden="true">${state.libKind === "commands" ? "/" : state.libKind === "agents" ? "@" : "◇"}</span>${esc(x.name)}
      </button>
      <p class="lib__desc">${esc(x.desc || "—")}</p>
    </li>`
    )
    .join("");

  $("#libMore").hidden = filtered.length <= slice.length;
  $("#libStatus").textContent = filtered.length
    ? `${fa(slice.length)} از ${fa(filtered.length)} مورد${q ? ` برای «${state.libQuery}»` : ""}${mine ? " · فقط ابزارهای مسیرها" : ""}`
    : "چیزی پیدا نشد — عبارت یا فیلتر دیگری امتحان کن.";
}

/* ── نصب ────────────────────────────────────────────── */
const HARNESS = [
  ["claude", "Claude Code", "./install.sh --profile developer --target claude"],
  ["codex", "Codex CLI", "./install.sh --profile minimal --target codex"],
  ["cursor", "Cursor", "./install.sh --profile minimal --target cursor"],
  ["opencode", "OpenCode", "npm install && npm run build:opencode && ./install.sh --profile full --target opencode --enable-hooks"],
  ["gemini", "Gemini CLI", "./install.sh --profile minimal --target gemini"],
  ["copilot", "GitHub Copilot", "./install.sh --profile full --target copilot"],
  ["zed", "Zed", "./install.sh --profile minimal --target zed"],
  ["qwen", "Qwen CLI", "./install.sh --profile minimal --target qwen"],
];

function renderInstall() {
  $("#harnessList").innerHTML = HARNESS.map(
    ([id, name, cmd]) => `
    <button class="harness__item" type="button" data-copy-text="${esc(cmd)}" title="کپی دستور">
      <strong>${esc(name)}</strong>
      <code>${esc(cmd)}</code>
    </button>`
  ).join("");

  const cmds = [
    ["کلون", "git clone https://github.com/affaan-m/ecc.git && cd ecc"],
    ["پروفایل developer", "./install.sh --profile developer --target claude"],
    ["بدون hook", "./install.sh --profile core --without baseline:hooks --target claude"],
    ["نصب گزیده", "./install.sh --target claude --skills tdd-workflow,api-design,design-system"],
  ];
  $("#installCmds").innerHTML = cmds
    .map(
      ([label, cmd]) => `
    <div class="cmd-group">
      <span class="cmd-group__label">${esc(label)}</span>
      <div class="cmd">
        <code>${esc(cmd)}</code>
        <button class="cmd__copy" type="button" data-copy-text="${esc(cmd)}">کپی</button>
      </div>
    </div>`
    )
    .join("");
}

/* ── روتر ───────────────────────────────────────────── */
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, sub] = raw.split("/");
  const seg = raw.split("/").filter(Boolean);
  if (!seg.length) return { view: "home" };
  if (seg[0] === "services") return { view: "services" };
  if (seg[0] === "library") return { view: "library" };
  if (seg[0] === "install") return { view: "install" };
  if (seg[0] === "fcc") return { view: "fcc" };
  if (seg[0] === "workspace") return { view: "workspace" };
  if (seg[0] === "s" && seg[1]) return { view: "playbook", id: seg[1], anchor: seg[2] };
  return { view: "home" };
}

let firstRender = true;
async function router() {
  await ready;
  const r = parseRoute();
  $$(".view").forEach((v) => { v.hidden = v.dataset.view !== r.view; });

  $$("[data-nav]").forEach((a) => {
    const isActive = a.dataset.nav === r.view || (r.view === "playbook" && a.dataset.nav === "services");
    a.classList.toggle("is-active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  if (r.view === "home") renderJourney();
  if (r.view === "services") renderServices();
  if (r.view === "library") renderLibrary();
  if (r.view === "install") renderInstall();
  if (r.view === "playbook") renderPlaybook(r.id);

  const bar = $("#routeProgress");
  bar.style.transform = "scaleX(1)";
  setTimeout(() => (bar.style.transform = "scaleX(0)"), 320);

  if (r.anchor) {
    const map = { steps: "#h-steps", prompts: "#h-prompts", pitfalls: "#h-pitfalls", toolbox: "#pbToolbox" };
    const target = map[r.anchor] ? $(map[r.anchor]) : null;
    if (target) { target.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  }
  if (!firstRender) window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  firstRender = false;
  $("#main").focus({ preventScroll: true });
}

window.addEventListener("hashchange", router);

/* ── رویدادهای سراسری ───────────────────────────────── */
document.addEventListener("click", (e) => {
  const copyEl = e.target.closest("[data-copy-text]");
  if (copyEl) {
    copyText(copyEl.dataset.copyText).then((ok) => {
      if (ok && (copyEl.classList.contains("cmd__copy") || copyEl.classList.contains("prompt__copy"))) markDone(copyEl);
    });
    return;
  }

  const cmdCopy = e.target.closest(".cmd__copy");
  if (cmdCopy && !cmdCopy.dataset.copyText) {
    const text = cmdCopy.parentElement.querySelector("code")?.textContent || "";
    copyText(text).then((ok) => ok && markDone(cmdCopy));
    return;
  }

  const promptCopy = e.target.closest(".prompt__copy");
  if (promptCopy) {
    const svc = state.services.find((x) => x.id === promptCopy.dataset.id);
    const p = svc?.prompts?.[Number(promptCopy.dataset.prompt)];
    if (p) copyText(p.text).then((ok) => ok && markDone(promptCopy));
    return;
  }

  const chip = e.target.closest(".chip[data-tag]");
  if (chip) {
    state.filterTag = chip.dataset.tag;
    $$(".chip[data-tag]").forEach((c) => c.classList.toggle("is-active", c === chip));
    renderServices();
    return;
  }
});

$("#serviceSearch")?.addEventListener("input", (e) => { state.serviceQuery = e.target.value; renderServices(); });

$("#libSearch")?.addEventListener("input", (e) => { state.libQuery = e.target.value; state.libLimit = 60; renderLibrary(); });
$("#libOnlyMine")?.addEventListener("change", (e) => { state.libOnlyMine = e.target.checked; state.libLimit = 60; renderLibrary(); });
$$(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => { t.classList.remove("is-active"); t.setAttribute("aria-pressed", "false"); });
    tab.classList.add("is-active");
    tab.setAttribute("aria-pressed", "true");
    state.libKind = tab.dataset.lib;
    state.libLimit = 60;
    renderLibrary();
  })
);
$("#libMore")?.addEventListener("click", () => { state.libLimit += 120; renderLibrary(); });

$("#copyAllPrompts")?.addEventListener("click", () => {
  const s = state.current;
  if (!s) return;
  const text = `# ${s.title} — پرامپت‌های آماده (ECC Playbook)\n\n` +
    s.prompts.map((p, i) => `### ${i + 1}) ${p.title}\n\n${p.text}`).join("\n\n---\n\n");
  copyText(text, "همهٔ پرامپت‌های این مسیر کپی شد ✓");
});

$("#favoritePlaybook")?.addEventListener("click", () => {
  if (!state.current) return;
  const p = progressFor(state.current.id); p.favorite = !p.favorite; saveProgress(state.current.id, p); paintProgress(state.current);
});
$("#pbSteps")?.addEventListener("change", (e) => {
  const input = e.target.closest("input[data-step]"); if (!input || !state.current) return;
  const i = Number(input.dataset.step), p = progressFor(state.current.id);
  p.steps = p.steps.filter((n) => n !== i); if (input.checked) p.steps.push(i);
  saveProgress(state.current.id, p); paintProgress(state.current);
});

$("#pbPrint")?.addEventListener("click", () => window.print());

$("#surpriseBtn")?.addEventListener("click", () => {
  if (!state.services.length) return;
  const pick = state.services[Math.floor(Math.random() * state.services.length)];
  location.hash = `#/s/${pick.id}`;
  toast(`پیشنهاد: ${pick.title}`);
});

/* ── پالت دستور ─────────────────────────────────────── */
const palette = $("#palette");
const paletteInput = $("#paletteInput");
const paletteList = $("#paletteList");
let paletteIndex = 0;
let paletteView = [];
let paletteTrigger = null;

function paletteItems() {
  const items = [];
  state.services.forEach((s) => items.push({ type: "مسیر", label: s.title, desc: s.tagline || "", href: `#/s/${s.id}` }));
  state.data.skills.forEach((s) => items.push({ type: "اسکیل", label: s.name, desc: s.desc || "", copy: s.name }));
  state.data.commands.forEach((s) => items.push({ type: "دستور", label: "/" + s.name, desc: s.desc || "", copy: "/" + s.name }));
  state.data.agents.forEach((s) => items.push({ type: "agent", label: "@" + s.name, desc: s.desc || "", copy: s.name }));
  return items;
}
let palCache = null;

function renderPalette() {
  const q = normalize(paletteInput.value.trim());
  palCache ||= paletteItems();
  const source = palCache.filter((it) => !q || normalize(it.label).includes(q) || normalize(it.desc).includes(q));
  paletteView = source.slice(0, 40);
  paletteIndex = Math.min(paletteIndex, Math.max(paletteView.length - 1, 0));
  paletteList.innerHTML = paletteView.length
    ? paletteView
        .map(
          (it, i) => `<li><button type="button" data-i="${i}"${i === paletteIndex ? ' class="is-selected" aria-current="true"' : ""}>
            <span class="palette__type">${it.type}</span>
            <span class="palette__label">${esc(it.label)}</span>
            <span class="palette__desc">${esc(it.desc)}</span>
          </button></li>`
        )
        .join("")
    : `<li class="palette__empty">نتیجه‌ای نبود.</li>`;
}

function openPalette() {
  paletteTrigger = document.activeElement;
  palette.hidden = false;
  paletteInput.value = "";
  paletteIndex = 0;
  renderPalette();
  paletteInput.focus();
}
function closePalette() {
  palette.hidden = true;
  if (paletteTrigger?.isConnected) paletteTrigger.focus();
  paletteTrigger = null;
}

function runPalette(index) {
  const item = paletteView[index];
  if (!item) return;
  closePalette();
  if (item.href) location.hash = item.href;
  else if (item.copy) copyText(item.copy, `کپی شد: ${item.copy}`);
}

$("#searchOpen")?.addEventListener("click", openPalette);
$("#searchMobile")?.addEventListener("click", openPalette);
$("[data-close-palette]")?.addEventListener("click", closePalette);
paletteInput?.addEventListener("input", () => { paletteIndex = 0; renderPalette(); });
paletteList?.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]");
  if (b) runPalette(Number(b.dataset.i));
});

document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
  if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
    e.preventDefault();
    palette.hidden ? openPalette() : closePalette();
    return;
  }
  if (palette.hidden) return;
  if (e.key === "Escape") return closePalette();
  if (e.key === "Tab") {
    const focusable = [paletteInput, ...$$("#paletteList button")];
    const index = focusable.indexOf(document.activeElement);
    if (e.shiftKey && index <= 0) { e.preventDefault(); focusable[focusable.length - 1].focus(); }
    else if (!e.shiftKey && index === focusable.length - 1) { e.preventDefault(); focusable[0].focus(); }
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = paletteView.length;
    if (!n) return;
    paletteIndex = (paletteIndex + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
    renderPalette();
    $$("#paletteList button")[paletteIndex]?.scrollIntoView({ block: "nearest" });
  }
  if (e.key === "Enter") { e.preventDefault(); runPalette(paletteIndex); }
});

/* ── دکمهٔ بازگشت به بالا ───────────────────────────── */
const toTop = $("#toTop");
window.addEventListener("scroll", () => { toTop.hidden = window.scrollY < 600; }, { passive: true });
toTop?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

/* ── سرویس‌ورکر (کارکرد آفلاین) ─────────────────────── */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

/* ── راه‌اندازی ─────────────────────────────────────── */
(async () => {
  try {
    await ready;
    renderPopular();
    renderTagFilter();
    renderServices();
    router();
  } catch (err) {
    $("#main").innerHTML = `<div class="wrap" style="padding:3rem 0">
      <h1>بارگذاری داده ناموفق بود</h1>
      <p>فایل‌های <code>assets/data.json</code> و <code>assets/playbooks.json</code> در دسترس نیستند. اگر سایت را از فایل باز کرده‌اید، آن را با یک سرور محلی اجرا کنید:</p>
      <pre class="cmd" style="padding:12px"><code>node site/serve.mjs</code></pre>
    </div>`;
    console.error(err);
  }
})();
