/*
 * Декор сайта — всё необязательное оформление в одном месте.
 * Переключатели — в data.js, объект decor. Выключили пункт (false) — его элементы не создаются,
 * а картинки и стили для него не загружаются. Выключили всё — не грузится и decor.css.
 * Чтобы убрать декор совсем: удалите строку <script src="decor.js…"> в index.html.
 */
(function () {
  "use strict";

  const D = (window.SITE && window.SITE.decor) || {};
  const on = (k) => D[k] === true;
  const KEYS = ["lambethDividers", "marquee", "marble", "lineArt", "stats", "scriptAccents", "revealAnimation"];
  if (!KEYS.some(on)) return;

  const VERSION = "1";
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (sel, r = document) => r.querySelector(sel);
  const $$ = (sel, r = document) => Array.from(r.querySelectorAll(sel));
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    });
    [].concat(children || []).forEach((c) => c && n.append(c));
    return n;
  }

  // Стили декора и классы-включатели: html.dc-marquee, html.dc-marble …
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "decor.css?v=" + VERSION;
  document.head.append(link);
  KEYS.filter(on).forEach((k) => root.classList.add("dc-" + k));

  const main = $("main");
  const hero = $(".hero");
  /* ---------- Бегущая строка под первым экраном ---------- */
  if (on("marquee") && hero) {
    const TEXT = "натуральные сливки · без маргарина · торты от 2 кг · доставка по Электростали · каждый торт под заказ · 20+ начинок · ";
    // строка повторена, чтобы лента была длиннее любого экрана; вторая половина — копия для бесшовного круга
    const half = () => el("span", { class: "decor-marquee__half" }, [TEXT.repeat(3)]);
    const copy = half();
    copy.setAttribute("aria-hidden", "true");
    hero.after(el("div", { class: "decor-marquee", role: "note", "aria-label": TEXT.replace(/ · $/, "") }, [
      el("div", { class: "decor-marquee__track", "aria-hidden": "true" }, [half(), copy]),
    ]));
  }
  /* ---------- Цифры после «Обо мне» ---------- */
  if (on("stats")) {
    const about = $("#about");
    const STATS = [
      ["20+", "начинок"],
      ["от 2 кг", "торты на заказ"],
      ["1300+", "подписчиков в Instagram"],
      ["Электросталь", "доставка по городу", "word"],
    ];
    if (about) {
      about.after(el("section", { class: "decor-stats", "aria-label": "Коротко о кондитерской" }, [
        el("div", { class: "container decor-stats__grid" }, STATS.map(([num, label, mod]) =>
          el("div", { class: "decor-stat" + (mod ? " decor-stat--" + mod : "") }, [
            el("strong", { class: "decor-stat__num", text: num }),
            el("span", { class: "decor-stat__label", text: label }),
          ]))),
      ]));
    }
  }
  /* ---------- Кремовые бордюры между секциями ---------- */
  if (on("lambethDividers") && main) {
    // между секциями: пропускаем первый экран и первую секцию после него (там бегущая строка)
    $$(":scope > section:not(.hero)", main).slice(1).forEach((s, i) => {
      s.prepend(el("div", { class: "decor-divider decor-divider--" + (i % 2 ? "beads" : "wave"), "aria-hidden": "true" }));
    });
  }
  /* ---------- Линейные рисунки у краёв секций ---------- */
  if (on("lineArt")) {
    const ART = { fillings: "whisk", desserts: "cherry", how: "piping-bag", about: "sprig", gallery: "cake-slice", reviews: "strawberry" };
    Object.entries(ART).forEach(([id, name]) => {
      const s = document.getElementById(id);
      if (!s) return;
      s.append(el("img", { class: "decor-art decor-art--" + name, src: "images/decor/" + name + ".svg?v=" + VERSION,
        alt: "", "aria-hidden": "true", loading: "lazy", decoding: "async" }));
    });
  }
  /* ---------- Одно слово в заголовке — рукописным ---------- */
  if (on("scriptAccents")) {
    const ACCENTS = {
      "fillings-title": ["Выберите ", "начинку"],
      "how-title": ["Как ", "заказать"],
      "gallery-title": ["Мои ", "работы"],
      "reviews-title": ["Что говорят ", "гости"],
    };
    Object.entries(ACCENTS).forEach(([id, [before, word]]) => {
      const h = document.getElementById(id);
      if (h) h.replaceChildren(before, el("span", { class: "decor-script", text: word }));
    });
  }
  /* ---------- Мягкое появление блоков при прокрутке (один раз) ---------- */
  if (on("revealAnimation") && !reduce && "IntersectionObserver" in window && main) {
    const SEL = [".section__title", ".section__lead", ".filters", ".group", ".grid--desserts > .card", ".step", ".panel",
      ".about__media", ".features li", ".work-card", ".quotes", ".contacts", ".contacts__actions", ".decor-stat"].join(",");
    const seen = new Set();  // перерисованные блоки (свежие данные с сервера) второй раз не анимируем
    const keyOf = (n) => n.id || (n.dataset && n.dataset.cat) || "";
    const io = new IntersectionObserver((entries) => {
      entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)
        .forEach((e, k) => {
          e.target.style.transitionDelay = Math.min(k, 5) * 80 + "ms";
          e.target.classList.add("is-in");
          const key = keyOf(e.target);
          if (key) seen.add(key);
          io.unobserve(e.target);
        });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.08 });
    const watch = (n) => {
      if (n.classList.contains("decor-reveal")) return;
      const key = keyOf(n);
      if (key && seen.has(key)) return;
      n.classList.add("decor-reveal");
      io.observe(n);
    };
    $$(SEL, main).forEach(watch);
    // карточки начинок и десертов перерисовываются при обновлении данных
    new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.matches(SEL)) watch(n);
      $$(SEL, n).forEach(watch);
    }))).observe(main, { childList: true, subtree: true });
  }
})();
