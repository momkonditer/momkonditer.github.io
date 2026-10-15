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
  /* ---------- Кремовые бордюры между секциями ---------- */
  if (on("lambethDividers") && main) {
    // между секциями: пропускаем первый экран и первую секцию после него (там бегущая строка)
    $$(":scope > section:not(.hero)", main).slice(1).forEach((s, i) => {
      s.prepend(el("div", { class: "decor-divider decor-divider--" + (i % 2 ? "beads" : "wave"), "aria-hidden": "true" }));
    });
  }
})();
