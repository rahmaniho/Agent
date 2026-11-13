/* app.js — ECC Playbook (وب‌اپ، بدون وابستگی)
   ماژول ES: مسیریابی هش‌محور، رندر ویوها، جست‌وجوی فازی، کپی، تم، پالت دستور. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Only redact source names in published editorial content; keep actual identifiers for copying.
const cleanSource = (text) => String(text ?? "").replace(/Everything Claude Code/gi, "the toolkit").replace(/\bECC\b/gi, "کیت ابزار").replace(/https?:\/\/github\.com\/[^\s)]+/gi, "[نشانی منبع]");
const toolLabel = (name) => String(name).replace(/ecc/gi, "toolkit");

// Local inline line-icons, keyed by existing subject IDs (no remote assets).
const TOPIC_ICONS = {
  website: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01M7 13h5M7 16h9"/>',
  webapp: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11M12 13h6M12 16h4"/>',
  api: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01M12 10v4M16 7h2M16 17h2"/>',
  architecture: '<path d="M12 2 3 7l9 5 9-5-9-5ZM3 12l9 5 9-5M3 17l9 5 9-5"/>',
  mobile: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 19h2"/>',
  ai: '<path d="M9 4a3 3 0 0 0-3 3v.5A3.5 3.5 0 0 0 5 14a3 3 0 0 0 4 4.5V20M15 4a3 3 0 0 1 3 3v.5A3.5 3.5 0 0 1 19 14a3 3 0 0 1-4 4.5V20M12 3v18M8 10h2M14 14h2"/>',
  testing: '<path d="M9 3h6M10 3v5L5 17a3 3 0 0 0 2.6 4h8.8A3 3 0 0 0 19 17l-5-9V3M8 15h8M10 17l1.5 1.5L15 15"/>',
  security: '<path d="M12 2 4 5v6c0 5 3.3 8.5 8 11 4.7-2.5 8-6 8-11V5l-8-3ZM9 12l2 2 4-4"/>',
  performance: '<path d="M4 18a8 8 0 1 1 16 0M12 14l4-4M7 18h10"/><circle cx="12" cy="14" r="1"/>',
  seo: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/>',
  devops: '<path d="M12 16V3M8 7l4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  onboarding: '<path d="M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4V4Zm16 0h-4a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h4V4Z"/>',
  data: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V7M16 16v-6M20 16V5"/>',
  harness: '<path d="m14 6 4-4 4 4-4 4-4-4ZM3 21l9-9M5 14l5 5M9 4l2 2M4 9l2 2M19 14v4M17 16h4"/>',
  all: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  other: '<path d="M4 6h16v13H4zM4 10h16M8 15h.01M12 15h.01M16 15h.01"/>'
};
function topicIcon(id) {
  return `<svg class="topic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${Object.hasOwn(TOPIC_ICONS, id) ? TOPIC_ICONS[id] : TOPIC_ICONS.other}</svg>`;
}

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
  libCategory: "all",
  libLevel: "all",
  libFavorites: false,
  current: null,
  entitled: false,
};

let sampleCatalog = null;
let catalogRevision = 0;
const ready = (async () => {
  const [dataRes, pbRes] = await Promise.all([
    fetch("assets/data.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("assets/playbooks.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (dataRes) state.data = dataRes;
  state.services = (pbRes && pbRes.services) || [];
  sampleCatalog = {data: state.data, services: state.services};
  if (!state.data.skills.length || !state.services.length) throw new Error("کاتالوگ یا مسیرها بارگذاری نشد");
  buildIndexes();
  paintStaticBindings();
})();

const skillSet = new Set();
const commandSet = new Set();
const agentSet = new Set();
function buildIndexes() {
  skillSet.clear(); commandSet.clear(); agentSet.clear();
  state.data.skills.forEach((s) => skillSet.add(s.name));
  state.data.commands.forEach((s) => commandSet.add(s.name));
  state.data.agents.forEach((s) => agentSet.add(s.name));
}


// پیش‌نیازهای انسانی، مستقل از نام‌های فنی ابزارها.
const NEEDS = {
 website: "هدف سایت، مخاطب، متن و تصاویر، نمونه‌های مورد علاقه و در صورت انتشار دامنه و محل میزبانی.",
 webapp: "ایده و کاربران برنامه، فهرست صفحه‌ها، اطلاعات مورد نیاز، نقش کاربران و محل نگهداری داده‌ها.",
 api: "فهرست کارهایی که سرویس باید انجام دهد، نوع داده‌ها، کاربران مجاز و محیط اجرا.",
 architecture: "کد یا توضیح پروژه فعلی، مشکل اصلی، محدودیت‌ها و نتیجه‌ای که انتظار دارید.",
 mobile: "نوع گوشی‌های هدف، صفحه‌ها و کارهای اصلی، طرح اولیه و شیوه انتشار برنامه.",
 ai: "مسئله مورد نظر، منابع اطلاعاتی، مدل و ارائه‌دهنده، مجوز ابزارها و محیط امن اجرا.",
 testing: "کد یا قابلیت آماده، رفتار مورد انتظار، نمونه ورودی و خروجی و محیط آزمون.",
 security: "شناخت داده‌های حساس، نقش کاربران، روش ورود و نقاطی که باید بررسی شوند.",
 performance: "صفحه یا سرویس کند، شرایط تکرار مشکل و راهی برای اندازه‌گیری سرعت پیش و پس از تغییر.",
 seo: "موضوع و مخاطب محتوا، کلمات مورد جست‌وجو، نشانی صفحه‌ها و هدف کسب‌وکار.",
 devops: "کد آماده، محیط اجرا، محل انتشار، تنظیمات محرمانه و روش بازگشت در صورت خطا.",
 database: "نوع اطلاعات، رابطه میان آن‌ها، پایگاه داده فعلی، نسخه پشتیبان و برنامه انتقال.",
 onboarding: "دسترسی به کد یا مستندات، مخاطب راهنما و کارهایی که فرد تازه‌وارد باید یاد بگیرد.",
 data: "داده‌های قابل استفاده، پرسش اصلی، معیار موفقیت و محدودیت‌های حریم خصوصی.",
 harness: "پروژه محلی، دستیار کدنویسی نصب‌شده و مشخص بودن ابزارهایی که لازم دارید."
};

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
    return `<a href="#/s/${esc(s.id)}" class="journey-item"><span class="journey-icon">${topicIcon(s.id)}</span><span class="journey-item-body"><strong>${esc(s.title)} ${p.favorite ? "★" : ""}</strong><small>${fa(done)} از ${fa(total)} مرحله انجام شده</small><span class="journey-track"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></span></span><span aria-hidden="true">←</span></a>`;
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
        <span class="card__icon" aria-hidden="true">${topicIcon(s.id)}</span>
        <div class="card__head">
          <h3 class="card__title">${esc(s.title)}</h3>
          <p class="card__tagline">${esc(s.tagline || "")}</p>
        </div>
      </div>
      ${compact ? "" : `<p class="card__summary">${esc(s.summary || "")}</p>`}
      <div class="card__foot">
        <span class="card__count">${fa(s.skills?.length || 0)} مهارت · ${fa(s.prompts?.length || 0)} متن آماده</span>
        <span class="card__open" aria-hidden="true">دیدن مسیر ←</span>
      </div>
    </a>
  </li>`;
}

function renderHomeTopics() {
  $("#homeTopics").innerHTML = state.services.map(s => `<li><a href="#/s/${esc(s.id)}" class="topic-card"><span class="topic-card-icon">${topicIcon(s.id)}</span><span>${esc(s.title)}</span><b aria-hidden="true">←</b></a></li>`).join("");
}
function renderLibraryTopics() {
  if (state.libCategory !== "all" && state.libCategory !== "other" && !state.services.some(s => s.id === state.libCategory)) state.libCategory = "all";
  const topics = [{id:"all",title:"همه موضوع‌ها"}, ...state.services, {id:"other",title:"سایر ابزارها"}];
  const select = $("#libCategory");
  select.innerHTML = topics.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join("");
  select.value = state.libCategory;
  $("#libraryTopics").innerHTML = topics.map(s => `<button type="button" class="topic-filter${s.id === state.libCategory ? " is-active" : ""}" data-library-topic="${esc(s.id)}" aria-pressed="${s.id === state.libCategory}"><span class="topic-filter-icon">${topicIcon(s.id)}</span><span>${esc(s.title)}</span></button>`).join("");
}
function selectLibraryTopic(id) {
  if (!Array.from($("#libCategory").options).some(option => option.value === id)) return;
  state.libCategory = id; state.libLimit = 60; $("#libCategory").value = id;
  $$("[data-library-topic]").forEach(button => { const selected = button.dataset.libraryTopic === id; button.classList.toggle("is-active", selected); button.setAttribute("aria-pressed", String(selected)); });
  renderLibrary();
}

function renderProjectSuggestion() {
  const type = $("#projectType"), old = type.value;
  type.innerHTML = state.services.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join("");
  if (state.services.some(s => s.id === old)) type.value = old;
  const s = state.services.find(x => x.id === type.value);
  if (!s) { $("#projectSuggestion").textContent = "موضوعی در دسترس نیست."; return; }
  const skills = (s.skills || []).filter(name => skillSet.has(name)).slice(0,5);
  const selected = new Set($$('input[name="projectNeed"]:checked').map(input => input.value));
  const stages = ["هدف و نیازها را مشخص کنید", "پیش‌نیازها را آماده کنید"];
  for (const step of s.steps || []) if (step.simpleTitle && !stages.includes(step.simpleTitle)) stages.push(step.simpleTitle);
  if (selected.has("design")) stages.push("طرح رابط و صفحه‌ها را مشخص کنید");
  if (selected.has("data")) stages.push("اطلاعات، دسترسی و پشتیبان‌گیری را طراحی کنید");
  if (selected.has("accounts")) stages.push("ورود، نقش‌ها و امنیت حساب‌ها را طراحی کنید");
  stages.push("نسخه اولیه را بسازید", "کار را آزمایش و اصلاح کنید");
  if (selected.has("publish")) stages.push("میزبانی و انتشار امن را آماده کنید");
  else stages.push("برای تحویل آماده شوید");
  $("#projectSuggestion").innerHTML = `<strong>پیشنهاد برای ${esc(s.title)}</strong><p><b>پیش‌نیازها:</b> ${esc(NEEDS[s.id] || "هدف، مخاطب و امکانات مورد نیاز را مشخص کنید.")}</p><p><b>ابزارهای در دسترس:</b> ${skills.length ? skills.map(x => esc(toolLabel(x))).join("، ") : "در این سطح نمونه‌ای برای این موضوع موجود نیست."}</p><b>نقشه راه اولیه</b><ol>${stages.map(x=>`<li>${esc(x)}</li>`).join("")}</ol>`;
}
$("#projectType").addEventListener("change", renderProjectSuggestion);
$$('input[name="projectNeed"]').forEach(input => input.addEventListener("change", renderProjectSuggestion));

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
  }>${esc(toolLabel(label || display))}</button>`;
};

function renderPlaybook(id) {
  const s = state.services.find((x) => x.id === id);
  if (!s) { location.hash = "#/services"; return; }
  state.current = s;

  $("#pbPaywall").hidden = !s.sample;
  $("#openBuilder").href = `#/builder/${encodeURIComponent(s.id)}`;
  $("#pbCrumb").textContent = s.title;
  $("#pbIcon").innerHTML = topicIcon(s.id);
  $("#pbTitle").textContent = s.title;
  $("#pbTagline").textContent = s.tagline || "";
  $("#pbSummary").textContent = s.summary || "";
  $("#pbNeeds").textContent = NEEDS[s.id] || "هدف پروژه، مخاطب، نمونه مورد علاقه و امکانات لازم را مشخص کنید.";

  $("#pbMeta").innerHTML = [
    `<span class="tag tag--accent">${esc(s.tagline || "")}</span>`,

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
        <label class="step-check"><input type="checkbox" data-step="${i}" ${progressFor(s.id).steps.includes(i) ? "checked" : ""} /><span class="step-title">${esc(st.simpleTitle || st.t)}</span></label>
        <details class="step-detail"><summary>توضیح فنی و ابزارهای پیشنهادی</summary><p>${esc(cleanSource(st.d))}</p></details>
        ${st.cmds?.length ? `<div class="cmds">${st.cmds.map((c) => `<button type="button" class="cmd-chip" data-copy-text="${esc(String(c))}" title="کپی">${esc(toolLabel(c))}</button>`).join("")}</div>` : ""}
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

  // کیت محلی گزیده است و ممکن است همه ابزارهای کاتالوگ را نداشته باشد.
  const cmd = "./kit/install-kit.sh --dry-run";
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
        <pre class="prompt__body" tabindex="0">${esc(cleanSource(p.text))}</pre>
      </article>`
    )
    .join("");

  $("#pbPitfalls").innerHTML = (s.pitfalls || []).map((x) => `<li>${esc(x)}</li>`).join("");

  const related = state.services
    .filter((x) => x.id !== s.id && (x.tags || []).some((t) => (s.tags || []).includes(t)))
    .slice(0, 4);
  $("#pbRelated").innerHTML = related.length
    ? related.map((r) => `<li><a href="#/s/${esc(r.id)}"><span aria-hidden="true">${topicIcon(r.id)}</span> ${esc(r.title)}</a></li>`).join("")
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

// Only explicitly reviewed examples have a level and a specific Persian explanation.
// Unreviewed catalog items are not guessed or machine-translated.
const LIB_REVIEW = {
  accessibility: ["beginner", "برای دسترسی آسان، صفحه‌ها را برای افراد با نیازهای مختلف قابل استفاده‌تر می‌کند."],
  benchmark: ["advanced", "سرعت و عملکرد را اندازه می‌گیرد تا بتوانید تغییرات را مقایسه کنید."],
  "browser-qa": ["advanced", "پس از انتشار، بخش‌های مختلف رابط را در مرورگر بررسی می‌کند."],
  "click-path-audit": ["advanced", "مسیر کاربر و نتیجهٔ کلیک‌ها را برای پیدا کردن خطا بررسی می‌کند."],
  "design-system": ["advanced", "رنگ‌ها، فاصله‌ها و اجزای رابط را برای هماهنگی طراحی بررسی می‌کند."],
  "agent-architecture-audit": ["advanced", "ساختار برنامهٔ ایجنت را برای یافتن ایرادهای معماری، حافظه و ابزارها بررسی می‌کند."],
  "agent-eval": ["advanced", "عملکرد چند ایجنت را روی کارهای مشخص با معیارهایی مانند کیفیت، هزینه و زمان مقایسه می‌کند."],
  "agent-harness-construction": ["advanced", "به طراحی ابزارها و محیطی کمک می‌کند که ایجنت در آن وظایفش را انجام می‌دهد."],
  "agent-introspection-debugging": ["advanced", "برای ثبت، تشخیص و رفع مرحله‌ای خطاهای اجرای ایجنت راهنما می‌دهد."],
  "agent-payment-x402": ["advanced", "برای افزودن پرداخت x402 به ایجنت، کنترل بودجه و کیف پول را راهنمایی می‌کند."],
  "agent-runtime-gateway-smoke-test": ["advanced", "اتصال محلی ایجنت و درگاه و بازگشت پاسخ از محیط راه‌دور را با یک آزمون ساده بررسی می‌کند."],
  "frontend-design-direction": ["beginner", "پیش از طراحی رابط، هدف، مخاطب و سبک مناسب پروژه را مشخص می‌کند."],
  "frontend-patterns": ["advanced", "الگوهای ساخت و بهبود بخش کاربری برنامه‌های React و Next.js را پیشنهاد می‌کند."],
  "make-interfaces-feel-better": ["beginner", "به بهتر شدن فاصله‌ها، نوشته‌ها، دکمه‌ها و جزئیات ظاهری رابط کمک می‌کند."],
  "motion-patterns": ["advanced", "الگوهای حرکت و انیمیشن برای اجزایی مانند دکمه، پنجره و تغییر صفحه ارائه می‌کند."],
  seo: ["beginner", "برای بررسی و بهبود دیده‌شدن سایت در موتورهای جست‌وجو راهنما می‌دهد."],
  "code-review": ["advanced", "تغییرات کد یا درخواست ادغام را برای یافتن ایراد بررسی می‌کند."],
  "feature-dev": ["advanced", "ساخت یک قابلیت جدید را با توجه به ساختار پروژه مرحله‌بندی می‌کند."],
  plan: ["beginner", "خواسته و خطرها را مرور می‌کند و پیش از تغییر کد یک برنامه پیشنهاد می‌دهد."],
  "quality-gate": ["advanced", "قواعد قالب‌بندی و کیفیت یک فایل را بررسی و موارد اصلاح را گزارش می‌کند."],
  "update-docs": ["advanced", "مستندات را با فایل‌ها و اجزای اصلی پروژه هماهنگ می‌کند."],
  "a11y-architect": ["advanced", "یک دستیار تخصصی برای بررسی دسترس‌پذیری رابط و استانداردهای مرتبط است."],
  architect: ["advanced", "یک دستیار تخصصی برای طراحی ساختار سیستم و تصمیم‌های فنی است."],
  "code-reviewer": ["advanced", "یک دستیار تخصصی برای بررسی کیفیت، امنیت و نگهداری کد است."],
  "seo-specialist": ["advanced", "یک دستیار تخصصی برای بررسی فنی و محتوایی بهینه‌سازی جست‌وجو است."],
};
// Premium descriptions travel only with the authorized catalog RPC, never as public assets.
function libraryReview(item) {
  const local = Object.hasOwn(LIB_REVIEW, item.name) ? LIB_REVIEW[item.name] : null;
  const level = item.level === "beginner" || item.level === "advanced" ? item.level : local?.[0] || "unknown";
  const description = typeof item.description_fa === "string" && item.description_fa.trim() ? item.description_fa : local?.[1];
  return [level, description];
}
const favoriteKey = "studio-library-favorites-v1";
function readLibraryFavorites() { try { const value=JSON.parse(localStorage.getItem(favoriteKey)||"[]"); return new Set(Array.isArray(value) ? value.filter(x=>typeof x==="string") : []); } catch {return new Set();} }
let libraryFavorites = readLibraryFavorites();
function renderLibrary() {
  $("#libraryPaywall").hidden = !state.services.some(s => s.sample);
  const list = LIB()[state.libKind] || [];
  const q = normalize(state.libQuery);
  const mine = state.libOnlyMine ? myNames(state.libKind) : null;
  const filtered = list.filter((x) => {
    if (mine && !mine.has(x.name)) return false;
    if (state.libFavorites && !libraryFavorites.has(`${state.libKind}:${x.name}`)) return false;
    if (state.libLevel !== "all" && libraryReview(x)[0] !== state.libLevel) return false;
    const paths = state.services.filter(s => (s[state.libKind] || []).includes(x.name));
    if (state.libCategory === "other" && paths.length) return false;
    if (state.libCategory !== "all" && state.libCategory !== "other" && !paths.some(s => s.id === state.libCategory)) return false;
    if (!q) return true;
    const haystack = normalize([x.name, x.desc, libraryReview(x)[1], ...paths.map(p => p.title)].join(" "));
    return q.trim().split(/\s+/).every(term => haystack.includes(term));
  });
  const slice = filtered.slice(0, state.libLimit);

  $("#libList").innerHTML = slice
    .map(
      (x) => `
    <li>
      <button class="lib__name" type="button" data-copy-text="${esc(state.libKind === "commands" ? "/" + x.name : x.name)}" title="کپی نام">
        <span class="mark" aria-hidden="true">${state.libKind === "commands" ? "/" : state.libKind === "agents" ? "@" : "◇"}</span>${esc(toolLabel(x.name))}
      </button>
      <button type="button" class="library-favorite" data-favorite="${esc(x.name)}" aria-pressed="${libraryFavorites.has(`${state.libKind}:${x.name}`)}">${libraryFavorites.has(`${state.libKind}:${x.name}`) ? "★ حذف از علاقه‌مندی" : "☆ افزودن به علاقه‌مندی"}</button>
      <p class="lib__desc">${esc(libraryReview(x)[1] || (state.libKind === "skills" ? "یک راهنمای تخصصی برای انجام این نوع کار است؛ توضیح دقیق آن هنوز به فارسی بررسی نشده است." : state.libKind === "commands" ? "دستوری آماده برای انجام یک کار مشخص است؛ توضیح دقیق فارسی هنوز بررسی نشده است." : "یک دستیار تخصصی برای انجام وظیفه‌ای مشخص است؛ توضیح دقیق فارسی هنوز بررسی نشده است."))} <small>سطح: ${{beginner:"شروع",advanced:"پیشرفته"}[libraryReview(x)[0]] || "ارزیابی‌نشده"}</small></p>
      <p class="lib__desc">${(() => { const paths = state.services.filter(s => (s[state.libKind] || []).includes(x.name)); return paths.length ? `پیشنهاد شده برای: ${paths.map(p => `<a href="#/s/${esc(p.id)}">${esc(p.title)}</a>`).join("، ")}` : "هنوز به مسیری در این برنامه اضافه نشده است."; })()}</p>
      <details class="original-desc"><summary>توضیح اصلی به زبان انگلیسی</summary><p dir="ltr">${esc(cleanSource(x.desc || "—"))}</p></details>
    </li>`
    )
    .join("");

  $("#libMore").hidden = filtered.length <= slice.length;
  $("#libStatus").textContent = filtered.length
    ? `${fa(slice.length)} از ${fa(filtered.length)} مورد${q ? ` برای «${state.libQuery}»` : ""}${mine ? " · فقط ابزارهای مسیرها" : ""}`
    : "چیزی پیدا نشد — عبارت یا فیلتر دیگری امتحان کن.";
}

// The full catalog is supplied only by the authorized server RPC. Never persist it.
window.addEventListener("studio:catalog", async (event) => {
  const revision = ++catalogRevision;
  await ready;
  if (revision !== catalogRevision) return;
  const payload = event.detail;
  state.current = null; state.entitled = !!payload;
  if (!payload) resetBuilder();
  if (!payload) for (const selector of ['#pbSteps', '#pbPrompts', '#pbToolbox', '#pbPitfalls', '#pbDeliverable']) $(selector).replaceChildren();
  state.data = payload?.catalog || sampleCatalog.data;
  state.services = payload?.playbooks?.services || sampleCatalog.services;
  buildIndexes(); paintStaticBindings();
  palCache = null; paletteView = []; paletteList.replaceChildren(); if (!palette.hidden) closePalette();
  renderPopular(); renderHomeTopics(); renderLibraryTopics(); renderTagFilter(); renderServices(); renderLibrary(); renderProjectSuggestion();
  await router();
});

/* ── ساخت درخواست: قالب محلی، نه فراخوانی مدل ────────── */
const BUILDER_ROLES = {
  general: "یک دستیار دقیق و کاربردی",
  website: "یک متخصص طراحی و ساخت سایت",
  webapp: "یک متخصص طراحی و ساخت برنامه",
  writing: "یک نویسنده و ویراستار",
  analysis: "یک تحلیل‌گر دقیق",
  testing: "یک متخصص بررسی و آزمایش نرم‌افزار",
};
function setBuilderKind(kind) {
  const aliases = {api:"webapp", mobile:"webapp", ai:"webapp", seo:"writing", data:"analysis", architecture:"analysis", security:"testing", performance:"testing"};
  const resolved = aliases[kind] || kind;
  $("#builderKind").value = Object.hasOwn(BUILDER_ROLES, resolved) ? resolved : "general";
}
function clearBuilderOutput() {
  $("#builderOutput").textContent = "هنوز متنی ساخته نشده است.";
  $("#builderCopy").disabled = true;
  $("#builderStatus").textContent = "";
}
function resetBuilder() {
  $("#builderForm").reset();
  clearBuilderOutput();
}
$("#builderForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const task = $("#builderTask").value.trim();
  if (!task) { $("#builderStatus").textContent = "لطفاً کاری را که می‌خواهید بنویسید."; $("#builderTask").focus(); return; }
  const role = BUILDER_ROLES[$("#builderKind").value] || BUILDER_ROLES.general;
  const fields = [
    ["کاری که می‌خواهم", task],
    ["زمینه و اطلاعات مهم", $("#builderContext").value.trim()],
    ["شکل پاسخ مورد انتظار", $("#builderFormat").value.trim()],
    ["محدودیت‌ها و نکته‌های مهم", $("#builderConstraints").value.trim()],
    ["نمونهٔ دلخواه", $("#builderExample").value.trim()],
  ];
  const sections = fields.filter(([, value]) => value).map(([label, value]) => `${label}:\n${value}`);
  const question = $("#builderAsk").checked ? "اگر اطلاعات لازم را نداری، ابتدا سؤال‌های ضروری را بپرس و چیزی را حدس نزن." : "اگر چیزی نامشخص است، آن را در پاسخ مشخص کن و از ساختن اطلاعات پرهیز کن.";
  $("#builderOutput").textContent = [`در نقش ${role} کمکم کن.`, ...sections, question].join("\n\n");
  $("#builderCopy").disabled = false;
  $("#builderStatus").textContent = "متن آماده است؛ آن را کپی و در دستیار دلخواهت استفاده کن.";
});
$("#builderForm").addEventListener("reset", clearBuilderOutput);
$("#builderForm").addEventListener("input", clearBuilderOutput);
$("#builderForm").addEventListener("change", clearBuilderOutput);
$("#builderCopy").addEventListener("click", async () => {
  if (await copyText($("#builderOutput").textContent)) $("#builderStatus").textContent = "متن کپی شد.";
  else $("#builderStatus").textContent = "کپی ممکن نشد؛ متن را انتخاب و دستی کپی کن.";
});

/* ── نصب ────────────────────────────────────────────── */
function renderInstall() {
  $("#harnessList").innerHTML = '<p>کیت گزیده برای پوشهٔ تنظیمات دستیار کدنویسی آماده است. برای ابزارهای دیگر فایل‌ها را مطابق راهنمای همان ابزار به‌صورت دستی استفاده کنید.</p>';
  const cmds = [["پیش‌نمایش بدون تغییر فایل", "./kit/install-kit.sh --dry-run"], ["نصب کیت گزیده", "./kit/install-kit.sh"]];
  $("#installCmds").innerHTML = cmds.map(([label, cmd]) => `<div class="cmd-group"><span class="cmd-group__label">${esc(label)}</span><div class="cmd"><code>${esc(cmd)}</code><button class="cmd__copy" type="button" data-copy-text="${esc(cmd)}">کپی</button></div></div>`).join("");
}

/* ── روتر ───────────────────────────────────────────── */
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, sub] = raw.split("/");
  const seg = raw.split("/").filter(Boolean);
  if (!seg.length) return { view: "home" };
  if (seg[0] === "services") return { view: "services" };
  if (seg[0] === "library") return { view: "library" };
  if (seg[0] === "builder") return { view: "builder", type: seg[1] || "" };
  if (seg[0] === "install") return { view: "install" };
  if (seg[0] === "fcc") return { view: "fcc" };
  if (seg[0] === "plans") return { view: "plans" };
  if (seg[0] === "subscribe") return { view: "subscribe" };
  if (seg[0] === "admin") return { view: "admin" };
  if (seg[0] === "workspace") return { view: "workspace" };
  if (seg[0] === "projects") return { view: "projects" };
  if (seg[0] === "s" && seg[1]) return { view: "playbook", id: seg[1], anchor: seg[2] };
  return { view: "home" };
}

let firstRender = true;
async function router() {
  await ready;
  const r = parseRoute();
  const locked = ["fcc", "install", "builder"].includes(r.view) && !state.entitled;
  if (r.view === "home" || r.view === "subscribe") $(r.view === "home" ? "#homePurchaseSlot" : "#subscribePurchaseSlot").append($("#purchasePanel"));
  $$(".view").forEach((v) => { v.hidden = v.dataset.view !== (locked ? "paywall" : r.view); });

  $$("[data-nav]").forEach((a) => {
    const isActive = a.dataset.nav === r.view || (r.view === "playbook" && a.dataset.nav === "services") || (r.view === "subscribe" && a.dataset.nav === "plans");
    a.classList.toggle("is-active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  if (r.view === "projects") { renderProjectSuggestion(); window.dispatchEvent(new Event("studio:projects-open")); }
  if (r.view === "home") renderJourney();
  if (r.view === "services") renderServices();
  if (r.view === "library") renderLibrary();
  if (r.view === "install") renderInstall();
  if (r.view === "playbook") renderPlaybook(r.id);
  if (r.view === "builder" && !locked && r.type) setBuilderKind(r.type);

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
  if (!document.body.classList.contains("login-open")) $("#main").focus({ preventScroll: true });
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
    if (p) copyText(cleanSource(p.text)).then((ok) => ok && markDone(promptCopy));
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

$("#libCategory")?.addEventListener("change", (e) => selectLibraryTopic(e.target.value));
$("#libraryTopics")?.addEventListener("click", (e) => { const button = e.target.closest("[data-library-topic]"); if (button) selectLibraryTopic(button.dataset.libraryTopic); });
$("#libLevel").addEventListener("change", e => { state.libLevel=e.target.value; state.libLimit=60; renderLibrary(); });
$("#libFavorites").addEventListener("change", e => { state.libFavorites=e.target.checked; state.libLimit=60; renderLibrary(); });
$("#libList").addEventListener("click", e => {
  const button=e.target.closest("[data-favorite]"); if (!button) return;
  const key=`${state.libKind}:${button.dataset.favorite}`;
  if (libraryFavorites.has(key)) libraryFavorites.delete(key); else libraryFavorites.add(key);
  try { localStorage.setItem(favoriteKey,JSON.stringify([...libraryFavorites])); } catch { $("#libStatus").textContent="ذخیره علاقه‌مندی در مرورگر ممکن نیست."; return; }
  renderLibrary();
});
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
  const text = `# ${s.title} — پرامپت‌های آماده\n\n` +
    s.prompts.map((p, i) => `### ${i + 1}) ${p.title}\n\n${cleanSource(p.text)}`).join("\n\n---\n\n");
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
  items.push({ type: "ابزار", label: "ساخت متن درخواست", desc: "درخواست شخصی خود را قدم به قدم بسازید", href: "#/builder" });
  state.services.forEach((s) => items.push({ type: "مسیر", label: s.title, desc: s.tagline || "", href: `#/s/${s.id}` }));
  state.data.skills.forEach((s) => items.push({ type: "اسکیل", label: toolLabel(s.name), desc: "نام ابزار را کپی کنید و برای بررسی کاربرد، دسته‌بندی کتابخانه را ببینید.", copy: s.name }));
  state.data.commands.forEach((s) => items.push({ type: "دستور", label: "/" + toolLabel(s.name), desc: "نام ابزار را کپی کنید و برای بررسی کاربرد، دسته‌بندی کتابخانه را ببینید.", copy: "/" + s.name }));
  state.data.agents.forEach((s) => items.push({ type: "agent", label: "@" + toolLabel(s.name), desc: "نام ابزار را کپی کنید و برای بررسی کاربرد، دسته‌بندی کتابخانه را ببینید.", copy: s.name }));
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
  else if (item.copy) copyText(item.copy, "نام ابزار کپی شد ✓");
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
    if (window.studioCatalog?.catalog && window.studioCatalog?.playbooks?.services) {
      state.data = window.studioCatalog.catalog; state.services = window.studioCatalog.playbooks.services; state.entitled = true;
      buildIndexes(); paintStaticBindings();
    }
    renderProjectSuggestion();
    renderPopular();
    renderHomeTopics();
    renderLibraryTopics();
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
