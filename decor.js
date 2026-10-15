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
  const KEYS = ["lambethDividers", "marquee", "marble", "lineArt", "stats", "scriptAccents", "revealAnimation",
    "priceTags", "handUnderline", "scrollBackground"];
  if (!KEYS.some(on)) return;

  const VERSION = "3";
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
    const TEXT = "каждый торт под заказ · 20+ начинок · доставка по Электростали · торты от 2 кг · ";
    // строка повторена, чтобы лента была длиннее любого экрана; вторая половина — копия для бесшовного круга
    const half = () => el("span", { class: "decor-marquee__half" }, [TEXT.repeat(4)]);
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
  if (on("revealAnimation") && !reduce && main) {
    const SEL = [".section__title", ".section__lead", ".filters", ".group", ".grid--desserts > .card", ".step", ".panel",
      ".about__media", ".features li", ".work-card", ".quotes", ".contacts", ".contacts__actions", ".decor-stat"].join(",");
    const seen = new Set();  // перерисованные блоки (свежие данные с сервера) второй раз не анимируем
    const keyOf = (n) => n.id || (n.dataset && n.dataset.cat) || "";
    const pending = new Set();
    let frame = 0;
    // Показываем всё, что дошло до экрана или уже выше него (быстрая прокрутка, переход по ссылке)
    function check() {
      frame = 0;
      const edge = window.innerHeight * 0.94;
      const ready = [];
      pending.forEach((n) => {
        if (!n.isConnected) { pending.delete(n); return; }
        const r = n.getBoundingClientRect();
        if (r.top < edge) ready.push([n, r]);
      });
      ready.sort((a, b) => a[1].top - b[1].top || a[1].left - b[1].left).forEach(([n, r], k) => {
        // по одному — только то, что видно; проскочившее выше показываем сразу
        n.style.transitionDelay = r.bottom > 0 ? Math.min(k, 5) * 80 + "ms" : "0ms";
        n.classList.add("is-in");
        pending.delete(n);
        const key = keyOf(n);
        if (key) seen.add(key);
      });
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(check); };
    const watch = (n) => {
      if (n.classList.contains("decor-reveal")) return;
      const key = keyOf(n);
      if (key && seen.has(key)) return;
      n.classList.add("decor-reveal");
      pending.add(n);
    };
    $$(SEL, main).forEach(watch);
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // карточки начинок и десертов перерисовываются при обновлении данных
    new MutationObserver((list) => {
      list.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.matches(SEL)) watch(n);
        $$(SEL, n).forEach(watch);
      }));
      schedule();
    }).observe(main, { childList: true, subtree: true });
  }
  /* ---------- Волнистое подчёркивание акцентных слов («выдавлено кондитерским мешком») ---------- */
  if (on("handUnderline")) {
    const NS = "http://www.w3.org/2000/svg";
    // неровная волна: шаг и высота чуть гуляют, как у крема из мешка
    const WAVE = "M2 11 C 14 4, 22 4, 33 10 S 52 17, 64 10 S 84 3, 97 9 S 117 16, 129 10 S 150 4, 162 9 S 183 15, 198 8";
    const words = $$(".hero__script, .decor-script");
    words.forEach((w) => {
      if (w.querySelector(".decor-underline")) return;
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "decor-underline");
      svg.setAttribute("viewBox", "0 0 200 20");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", WAVE);
      path.setAttribute("pathLength", "1");
      svg.append(path);
      w.classList.add("decor-underlined");
      w.append(svg);
    });
    const draw = (w) => w.classList.add("is-drawn");
    if (reduce || !("IntersectionObserver" in window)) {
      words.forEach(draw);
    } else {
      const io = new IntersectionObserver((entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        draw(e.target);
        io.unobserve(e.target);
      }), { rootMargin: "0px 0px -10% 0px" });
      words.forEach((w) => io.observe(w));
    }
  }
  /* ---------- Фон страницы плавно меняет оттенок при прокрутке ---------- */
  if (on("scrollBackground")) {
    // очень светлые оттенки из палитры: сливочный → пудрово-розовый → карамельно-латте
    const CREAM = [247, 240, 231], POWDER = [248, 234, 231], LATTE = [242, 230, 216];
    const STOPS = [["top", CREAM], ["#fillings", POWDER], ["#gallery", POWDER], ["#reviews", LATTE], ["#contacts", LATTE]];
    const body = document.body;
    let frame = 0, last = "";
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    function paint() {
      frame = 0;
      const mid = window.scrollY + window.innerHeight / 2;
      // опорные точки — середины разделов; между ними цвет смешивается плавно
      const pts = STOPS.map(([sel, c]) => {
        if (sel === "top") return [0, c];
        const n = $(sel);
        if (!n || n.hidden) return null;
        const r = n.getBoundingClientRect();
        return [r.top + window.scrollY + r.height / 2, c];
      }).filter(Boolean).sort((a, b) => a[0] - b[0]);
      let c = pts[pts.length - 1][1];
      for (let i = 0; i < pts.length - 1; i++) {
        const [y0, c0] = pts[i], [y1, c1] = pts[i + 1];
        if (mid <= y0) { c = c0; break; }
        if (mid <= y1) { const t = (mid - y0) / (y1 - y0 || 1); c = mix(c0, c1, t * t * (3 - 2 * t)); break; }
      }
      const css = `rgb(${c.join(", ")})`;
      if (css !== last) { body.style.backgroundColor = css; last = css; }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    paint();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
  }
})();
