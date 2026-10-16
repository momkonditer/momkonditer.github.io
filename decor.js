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
  const KEYS = ["lambethDividers", "marquee", "marble", "lineArt", "scriptAccents", "revealAnimation",
    "priceTags", "handUnderline", "scrollBackground"];
  if (!KEYS.some(on)) return;

  const VERSION = "10";
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
      "reviews-title": ["Что говорят ", "клиенты"],
    };
    Object.entries(ACCENTS).forEach(([id, [before, word]]) => {
      const h = document.getElementById(id);
      if (h) h.replaceChildren(before, el("span", { class: "decor-script", text: word }));
    });
  }
  /* ---------- Мягкое появление блоков при прокрутке (один раз) ---------- */
  if (on("revealAnimation") && !reduce && main && "IntersectionObserver" in window) {
    const SEL = [".section__title", ".section__lead", ".filters", ".group", ".grid--desserts > .card", ".step", ".panel",
      ".about__media", ".features li", ".work-card", ".quotes", ".contacts", ".contacts__actions"].join(",");
    const seen = new Set();  // перерисованные блоки (свежие данные с сервера) второй раз не анимируем
    const keyOf = (n) => n.id || (n.dataset && n.dataset.cat) || "";
    const pending = new Set();
    function show(n, delay) {
      pending.delete(n);
      io.unobserve(n);
      // will-change — только на время анимации
      n.style.willChange = "opacity, transform";
      n.style.transitionDelay = `${delay}ms`;
      n.classList.add("is-in");
      const done = () => { n.style.willChange = ""; n.style.transitionDelay = ""; };
      n.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 400 + delay + 100);
      const key = keyOf(n);
      if (key) seen.add(key);
    }
    // Блоки появляются чуть раньше, чем доезжают до экрана (rootMargin 15% снизу)
    const io = new IntersectionObserver((entries) => {
      const shown = entries.filter((e) => e.isIntersecting).map((e) => e.target)
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      if (!shown.length) return;
      // проскочившее выше при быстрой прокрутке — сразу, без анимации-задержки
      const last = shown[shown.length - 1];
      pending.forEach((n) => {
        if (!shown.includes(n) && n.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING && n.getBoundingClientRect().bottom < 0) show(n, 0);
      });
      // задержка между соседними — 40 мс, не больше 3 подряд
      shown.forEach((n, k) => show(n, Math.min(k, 2) * 40));
    }, { rootMargin: "0px 0px 15% 0px", threshold: 0 });
    const watch = (n) => {
      if (n.classList.contains("decor-reveal")) return;
      const key = keyOf(n);
      if (key && seen.has(key)) return;
      n.classList.add("decor-reveal");
      pending.add(n);
      io.observe(n);
    };
    $$(SEL, main).forEach(watch);
    // карточки начинок и десертов перерисовываются при обновлении данных
    new MutationObserver((list) => {
      list.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.matches(SEL)) watch(n);
        $$(SEL, n).forEach(watch);
      }));
      pending.forEach((n) => { if (!n.isConnected) { pending.delete(n); io.unobserve(n); } });
    }).observe(main, { childList: true, subtree: true });
  }
  /* ---------- Волнистое подчёркивание акцентных слов («выдавлено кондитерским мешком») ---------- */
  if (on("handUnderline")) {
    const NS = "http://www.w3.org/2000/svg";
    // неровная волна в координатах 200×20: шаг и высота чуть гуляют, как у крема из мешка
    const WAVE = "M2 11 C 14 4, 22 4, 33 10 S 52 17, 64 10 S 84 3, 97 9 S 117 16, 129 10 S 150 4, 162 9 S 183 15, 198 8";
    const words = $$(".hero__script, .decor-script, .accent-word");

    // Размер линии — из раскладки (ширина SVG в CSS = % от ширины слова), а не из getBoundingClientRect:
    // на него влияют transform анимации появления. Волна строится в этих пикселях,
    // preserveAspectRatio="none" — даже при устаревших размерах линия тянется на всю ширину, а не сжимается к центру.
    function fit(w) {
      const svg = w.querySelector(".decor-underline"), path = svg && svg.firstChild;
      if (!path) return;
      const cs = getComputedStyle(svg);
      const width = parseFloat(cs.width), height = parseFloat(cs.height);
      if (!(width > 0) || !(height > 0)) return;
      let i = 0;
      path.setAttribute("d", WAVE.replace(/\d+(\.\d+)?/g, (n) => (i++ % 2 ? n * height / 20 : n * width / 200).toFixed(1)));
      svg.setAttribute("viewBox", `0 0 ${width.toFixed(1)} ${height.toFixed(1)}`);
      const len = Math.ceil(path.getTotalLength()) + 2;
      path.style.transition = "none";  // подгонка без анимации
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = w.classList.contains("is-drawn") ? "0" : `${len}`;
      path.getBoundingClientRect();
      path.style.transition = "";
    }
    const fitAll = () => words.forEach(fit);

    words.forEach((w) => {
      if (w.querySelector(".decor-underline")) return;
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "decor-underline");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.append(document.createElementNS(NS, "path"));
      w.classList.add("decor-underlined");
      w.append(svg);
      fit(w);
    });

    // Пересчёт: шрифт загрузился (общий и именно Playfair Display), страница догрузилась, изменился размер
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(fitAll);
      if (document.fonts.load) document.fonts.load('italic 400 1em "Playfair Display"').then(fitAll, () => {});
      if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", fitAll);
    }
    window.addEventListener("load", fitAll);
    let resizeTimer = 0;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitAll, 150); });
    // ResizeObserver на inline-span не срабатывает — следим за заголовками
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(fitAll);
      new Set(words.map((w) => w.closest("h1, h2, h3") || w.parentElement)).forEach((h) => ro.observe(h));
    }

    const draw = (w) => {
      fit(w);  // перед рисованием — по текущей ширине слова
      requestAnimationFrame(() => {
        w.classList.add("is-drawn");
        const path = w.querySelector(".decor-underline path");
        if (path) path.style.strokeDashoffset = "0";
      });
    };
    if (reduce || !("IntersectionObserver" in window)) {
      words.forEach((w) => { w.classList.add("is-drawn"); fit(w); });
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
    // очень светлые оттенки из палитры: сливочный (фон body::before) → пудрово-розовый → карамельно-латте.
    // Каждый оттенок — свой фиксированный слой размером с экран; при прокрутке меняется только его opacity.
    // Уровень: 0 — сливочный, 1 — пудровый, 2 — латте (слои накладываются, смесь = как раньше rgb-переход)
    const STOPS = [["top", 0], ["#fillings", 1], ["#gallery", 1], ["#reviews", 2], ["#contacts", 2]];
    const layers = ["powder", "latte"].map((name) => {
      const d = el("div", { class: `decor-bg decor-bg--${name}`, "aria-hidden": "true" });
      document.body.prepend(d);
      return d;
    });
    let pts = [], frame = 0;
    const last = ["", ""];
    // Позиции разделов кешируем: пересчёт только при изменении размеров страницы, не на каждом кадре
    function measure() {
      pts = STOPS.map(([sel, level]) => {
        if (sel === "top") return [0, level];
        const n = $(sel);
        if (!n || n.hidden) return null;
        return [n.offsetTop + n.offsetHeight / 2, level];
      }).filter(Boolean).sort((a, b) => a[0] - b[0]);
      schedule();
    }
    function paint() {
      frame = 0;
      if (!pts.length) return;
      const mid = window.scrollY + window.innerHeight / 2;
      let level = pts[pts.length - 1][1];
      for (let i = 0; i < pts.length - 1; i++) {
        const [y0, l0] = pts[i], [y1, l1] = pts[i + 1];
        if (mid <= y0) { level = l0; break; }
        if (mid <= y1) { const t = (mid - y0) / (y1 - y0 || 1); level = l0 + (l1 - l0) * t * t * (3 - 2 * t); break; }
      }
      [Math.min(level, 1), Math.max(level - 1, 0)].forEach((o, i) => {
        const v = o.toFixed(3);
        if (v !== last[i]) { layers[i].style.opacity = v; last[i] = v; }
      });
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("load", measure);
    if ("ResizeObserver" in window && main) new ResizeObserver(measure).observe(main);
  }
})();
