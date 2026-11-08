/* app.js — منطق ECC Playbook (بدون وابستگی) */
(() => {
  "use strict";

  const DATA = window.ECC_DATA || { skills: [], commands: [], agents: [], counts: {} };
  const PB = (window.ECC_PLAYBOOKS && window.ECC_PLAYBOOKS.services) || [];
  const services = PB;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const skillNames = new Set(DATA.skills.map((s) => s.name));
  const teamNames = new Set(DATA.commands.map((s) => s.name));
  const agentNames = new Set(DATA.agents.map((s) => s.name));

  /* ── تم ─────────────────────────────────────────────── */
  const THEME_KEY = "ecc-theme";
  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    const btn = $("#themeToggle");
    if (btn) btn.setAttribute("aria-label", t === "dark" ? "تغییر به تم روشن" : "تغییر به تم تاریک");
  };
  try {
    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  } catch {
    applyTheme("light");
  }
  $("#themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  });

  /* ── توست ───────────────────────────────────────────── */
  let toastTimer;
  const toast = (msg) => {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 1900);
  };

  const copy = async (text, okMsg = "کپی شد ✓") => {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
      return true;
    } catch {
      // فالبک برای محیط‌های بدون clipboard API
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch {}
      ta.remove();
      toast(ok ? okMsg : "کپی نشد — دستی انتخاب کنید");
      return ok;
    }
  };

  const markDone = (btn, label = "کپی شد ✓") => {
    if (!btn) return;
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = label;
    btn.classList.add("is-done");
    setTimeout(() => { btn.textContent = original; btn.classList.remove("is-done"); }, 1600);
  };

  /* ── شمارنده‌های هیرو ───────────────────────────────── */
  const setCounters = () => {
    const map = { skills: DATA.skills.length, commands: DATA.commands.length, agents: DATA.agents.length };
    $$("[data-count]").forEach((el) => { el.textContent = fa(map[el.dataset.count] ?? 0); });
    const libTotal = DATA.skills.length + DATA.commands.length + DATA.agents.length;
    const lt = $("#libTotal"); if (lt) lt.textContent = fa(libTotal);
    const pc = $("#pathCount"); if (pc) pc.textContent = fa(services.length);
    const v = DATA.version || "2.2.3";
    ["#eccVersion", "#footVersion"].forEach((s) => { const e = $(s); if (e) e.textContent = v; });
    const ts = $("#tabCountSkills"); if (ts) ts.textContent = fa(DATA.skills.length);
    const tc = $("#tabCountCommands"); if (tc) tc.textContent = fa(DATA.commands.length);
    const ta = $("#tabCountAgents"); if (ta) ta.textContent = fa(DATA.agents.length);
  };
  setCounters();

  /* ── کارت خدمت‌ها ───────────────────────────────────── */
  const cardsEl = $("#serviceCards");
  const renderCards = (tag = "all") => {
    const list = tag === "all" ? services : services.filter((s) => (s.tags || []).includes(tag));
    cardsEl.innerHTML = list
      .map(
        (s) => `
      <li class="card" data-id="${esc(s.id)}">
        <div class="card__top">
          <span class="card__icon" aria-hidden="true">${esc(s.icon || "◆")}</span>
          <div>
            <h3 class="card__title">${esc(s.title)}</h3>
            <p class="card__tagline">${esc(s.tagline || "")}</p>
          </div>
        </div>
        <p class="card__summary">${esc(s.summary || "")}</p>
        <div class="card__foot">
          <span class="card__count">${fa((s.skills || []).length)} اسکیل · ${fa((s.commands || []).length)} دستور · ${fa((s.agents || []).length)} agent</span>
          <button class="card__open" type="button" data-open="${esc(s.id)}">دیدن مسیر ←</button>
        </div>
      </li>`
      )
      .join("");
    if (!list.length) cardsEl.innerHTML = `<li class="pb__empty">برای این فیلتر مسیری ثبت نشده است.</li>`;
  };
  renderCards();

  $$(".chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      $$(".chip").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      renderCards(chip.dataset.tag);
    })
  );

  /* ── رندر مسیر خدمت ────────────────────────────────── */
  const pbBody = $("#pbBody");
  const pbEmpty = $("#pbEmpty");
  const pbActions = $("#pbActions");
  let current = null;

  const pillHtml = (name, kind) => {
    const known = kind === "skill" ? skillNames.has(name) : kind === "command" ? teamNames.has(name) : agentNames.has(name);
    return `<button class="pill pill--${kind}" type="button" data-copy-text="${esc(kind === "command" ? "/" + name : name)}"${
      known ? "" : ' data-missing="1" title="در کاتالوگ پیدا نشد"'
    }>${esc(name)}</button>`;
  };

  const renderPlaybook = (id) => {
    const s = services.find((x) => x.id === id);
    if (!s) return;
    current = s;

    $$(".card").forEach((c) => c.classList.toggle("is-active", c.dataset.id === id));

    $("#pbTitle").textContent = s.title;
    $("#pbSummary").textContent = s.summary || "";
    pbEmpty.hidden = true;
    pbBody.hidden = false;
    pbActions.hidden = false;

    $("#pbMeta").innerHTML = [
      `<span class="tag tag--accent">${esc(s.tagline || "")}</span>`,
      ...(s.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`),
    ].join("");

    // مراحل
    $("#pbSteps").innerHTML = (s.steps || [])
      .map(
        (st) => `
        <li>
          <h4>${esc(st.t)}</h4>
          <p>${esc(st.d)}</p>
          ${st.cmds && st.cmds.length ? `<div class="cmds">${st.cmds.map((c) => `<code>${esc(c)}</code>`).join("")}</div>` : ""}
        </li>`
      )
      .join("");

    // جعبه‌ابزار
    const groups = [
      ["اسکیل‌ها", (s.skills || []).filter((n) => !n.includes("*")).map((n) => pillHtml(n, "skill"))],
      ["دستورها", (s.commands || []).map((n) => pillHtml(n, "command"))],
      ["agentها", (s.agents || []).map((n) => pillHtml(n, "agent"))],
    ].filter(([, items]) => items.length);

    $("#pbToolbox").innerHTML = groups
      .map(([label, items]) => `<div class="toolbox__group"><h4>${label}</h4><div class="toolbox__items">${items.join("")}</div></div>`)
      .join("");

    // نصب سریع
    const profile = (s.install && s.install.profile) || "developer";
    const skillsArg = s.install && s.install.skills ? ` \\\n  --skills ${s.install.skills}` : "";
    const installCmd = `git clone https://github.com/affaan-m/ecc.git && cd ecc\n./install.sh --profile ${profile} --target claude${skillsArg}`;
    const installEl = $("#pbInstall");
    installEl.textContent = installCmd;
    $("#pbInstall").parentElement.querySelector(".cmd__copy").dataset.copyText = installCmd;

    // خروجی
    $("#pbDeliverable").textContent = s.deliverable || "—";

    // پرامپت‌ها
    $("#pbPrompts").innerHTML = (s.prompts || [])
      .map(
        (p, i) => `
        <article class="prompt">
          <div class="prompt__head">
            <h4 class="prompt__title">${esc(p.title || `پرامپت ${fa(i + 1)}`)}</h4>
            <button class="prompt__copy" type="button" data-prompt="${i}" data-id="${esc(s.id)}">کپی</button>
          </div>
          <pre class="prompt__body">${esc(p.text)}</pre>
        </article>`
      )
      .join("");

    // تله‌ها
    $("#pbPitfalls").innerHTML = (s.pitfalls || []).map((x) => `<li>${esc(x)}</li>`).join("");

    $("#pbGitHub").href = `https://github.com/affaan-m/ecc`;

    // تاریخچهٔ آدرس
    const url = new URL(location.href);
    url.hash = `service=${s.id}`;
    history.replaceState(null, "", url);

    // اسکرول ملایم به بخش مسیر
    const target = $("#playbook");
    if (target && target.getBoundingClientRect().top > 120) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  /* کلیک‌های سراسری: باز کردن مسیر / کپی */
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open) {
      renderPlaybook(open.dataset.open);
      return;
    }

    const cmdCopy = e.target.closest(".cmd__copy");
    if (cmdCopy) {
      const text = cmdCopy.dataset.copyText || cmdCopy.parentElement.querySelector("code")?.textContent || "";
      copy(text).then((ok) => ok && markDone(cmdCopy));
      return;
    }

    const promptCopy = e.target.closest(".prompt__copy");
    if (promptCopy) {
      const svc = services.find((x) => x.id === promptCopy.dataset.id);
      const p = svc && svc.prompts[Number(promptCopy.dataset.prompt)];
      if (p) copy(p.text).then((ok) => ok && markDone(promptCopy));
      return;
    }

    const pill = e.target.closest(".pill[data-copy-text]");
    if (pill) {
      copy(pill.dataset.copyText).then((ok) => ok && toast(`کپی شد: ${pill.dataset.copyText}`));
      return;
    }
  });

  $("#copyAllPrompts")?.addEventListener("click", () => {
    if (!current) return;
    const text = current.prompts
      .map((p, i) => `### ${i + 1}) ${p.title}\n\n${p.text}`)
      .join("\n\n---\n\n");
    copy(`# ${current.title} — پرامپت‌های آماده (ECC Playbook)\n\n${text}`, "همهٔ پرامپت‌های این مسیر کپی شد ✓");
  });

  $("#surpriseBtn")?.addEventListener("click", () => {
    const pick = services[Math.floor(Math.random() * services.length)];
    renderPlaybook(pick.id);
    toast(`پیشنهاد: ${pick.title}`);
  });

  /* ── کتابخانه ──────────────────────────────────────── */
  const LIB_SOURCES = { skills: DATA.skills, commands: DATA.commands, agents: DATA.agents };
  let libKind = "skills";
  let libQuery = "";
  let libLimit = 48;

  const renderLib = () => {
    const list = LIB_SOURCES[libKind] || [];
    const q = libQuery.trim().toLowerCase();
    const filtered = q
      ? list.filter((x) => x.name.toLowerCase().includes(q) || (x.desc || "").toLowerCase().includes(q))
      : list;
    const slice = filtered.slice(0, libLimit);

    $("#libList").innerHTML = slice
      .map(
        (x) => `
      <li>
        <button class="lib__name" type="button" data-copy-text="${esc(libKind === "commands" ? "/" + x.name : x.name)}" title="کپی نام">
          <span class="mark" aria-hidden="true">${libKind === "commands" ? "/" : libKind === "agents" ? "@" : "◇"}</span>${esc(x.name)}
        </button>
        <p class="lib__desc">${esc(x.desc || "—")}</p>
      </li>`
      )
      .join("");

    const has = filtered.length > slice.length;
    $("#libMore").hidden = !has;
    $("#libStatus").textContent = filtered.length
      ? `${fa(slice.length)} از ${fa(filtered.length)} مورد${q ? ` برای «${q}»` : ""}`
      : "چیزی پیدا نشد — عبارت دیگری امتحان کن.";
  };

  $("#libSearch").addEventListener("input", (e) => {
    libQuery = e.target.value;
    libLimit = 48;
    renderLib();
  });

  $$(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => { t.classList.remove("is-active"); t.setAttribute("aria-pressed", "false"); });
      tab.classList.add("is-active");
      tab.setAttribute("aria-pressed", "true");
      libKind = tab.dataset.lib;
      libLimit = 48;
      renderLib();
    })
  );

  $("#libMore").addEventListener("click", () => { libLimit += 96; renderLib(); });
  renderLib();

  /* ── پالت دستور (Ctrl/Cmd+K یا /) ──────────────────── */
  const palette = $("#palette");
  const paletteInput = $("#paletteInput");
  const paletteList = $("#paletteList");
  let paletteItems = [];
  let paletteIndex = 0;

  const buildPaletteIndex = () => {
    const items = [];
    services.forEach((s) => items.push({ type: "مسیر", label: s.title, desc: s.tagline || "", action: () => renderPlaybook(s.id) }));
    DATA.skills.forEach((s) => items.push({ type: "اسکیل", label: s.name, desc: s.desc, action: () => copy(s.name, `کپی شد: ${s.name}`) }));
    DATA.commands.forEach((s) => items.push({ type: "دستور", label: "/" + s.name, desc: s.desc, action: () => copy("/" + s.name, `کپی شد: /${s.name}`) }));
    DATA.agents.forEach((s) => items.push({ type: "agent", label: "@" + s.name, desc: s.desc, action: () => copy(s.name, `کپی شد: ${s.name}`) }));
    return items;
  };

  const renderPalette = () => {
    const q = paletteInput.value.trim().toLowerCase();
    const source = paletteItems.filter((it) =>
      !q || it.label.toLowerCase().includes(q) || (it.desc || "").toLowerCase().includes(q)
    );
    const view = source.slice(0, 40);
    paletteIndex = Math.min(paletteIndex, Math.max(view.length - 1, 0));
    paletteList.innerHTML = view.length
      ? view
          .map(
            (it, i) => `<li><button type="button" data-i="${i}"${i === paletteIndex ? ' class="is-selected" aria-current="true"' : ""}>
              <span class="palette__type">${it.type}</span>
              <span class="palette__label">${esc(it.label)}</span>
              <span class="palette__desc">${esc(it.desc || "")}</span>
            </button></li>`
          )
          .join("")
      : `<li class="palette__empty">نتیجه‌ای نبود.</li>`;
    paletteList.dataset.view = "1";
    paletteList._view = view;
  };

  const openPalette = () => {
    if (!paletteItems.length) paletteItems = buildPaletteIndex();
    palette.hidden = false;
    paletteInput.value = "";
    paletteIndex = 0;
    renderPalette();
    paletteInput.focus();
  };
  const closePalette = () => { palette.hidden = true; };

  $("#searchOpen").addEventListener("click", openPalette);
  $("[data-close-palette]").addEventListener("click", closePalette);
  paletteInput.addEventListener("input", () => { paletteIndex = 0; renderPalette(); });
  paletteList.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const item = paletteList._view[Number(b.dataset.i)];
    if (item) { closePalette(); item.action(); }
  });

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
      e.preventDefault();
      palette.hidden ? openPalette() : closePalette();
      return;
    }
    if (palette.hidden) return;
    if (e.key === "Escape") { closePalette(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = paletteList._view?.length || 0;
      if (!n) return;
      paletteIndex = (paletteIndex + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      renderPalette();
    }
    if (e.key === "Enter") {
      const item = paletteList._view?.[paletteIndex];
      if (item) { closePalette(); item.action(); }
    }
  });

  /* ── راه‌اندازی از هش آدرس ─────────────────────────── */
  const fromHash = () => {
    const m = location.hash.match(/service=([\w-]+)/);
    if (m && services.some((s) => s.id === m[1])) {
      renderPlaybook(m[1]);
      // اسکرول بدون انیمیشن آزاردهنده در بارگذاری اول
      requestAnimationFrame(() => $("#playbook").scrollIntoView({ block: "start" }));
    }
  };
  fromHash();
  window.addEventListener("hashchange", fromHash);

  // اگر داده‌ای بارگذاری نشده باشد، پیام روشن بده
  if (!DATA.skills.length) {
    $("#libStatus").textContent = "دادهٔ کاتالوگ یافت نشد؛ assets/data.js را با node site/tools/gen-data.mjs بسازید.";
  }
})();
