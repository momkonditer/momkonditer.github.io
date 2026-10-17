(function () {
  "use strict";

  const SITE = window.SITE;
  const Cal = window.MiniCalendar;
  const CACHE_KEY = "mom_site_data_v2";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const child of [].concat(children)) {
      if (child != null) node.append(child);
    }
    return node;
  }

  // 2100 → «2 100» (неразрывный пробел)
  const money = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const kg = (w) => String(w).replace(".", ",");
  const pad = (n) => String(n).padStart(2, "0");
  const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  // 1 день, 2 дня, 5 дней
  const daysWord = (n) => {
    const a = n % 10, b = n % 100;
    return a === 1 && b !== 11 ? "день" : a >= 2 && a <= 4 && (b < 12 || b > 14) ? "дня" : "дней";
  };

  /* ================= Данные ================= */

  const KNOWN_CATS = { "Стандарт": "standard", "Лайт": "light", "Премиум": "premium", "Советская классика": "classic" };
  let D = null;          // нормализованные данные, по ним рисуется страница
  let rawString = "";    // чтобы не перерисовывать, если с сервера пришло то же самое

  function handle(value, re) {
    const s = String(value || "").trim()
      .replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me|instagram\.com)\//i, "")
      .replace(/^@/, "").replace(/[/?#].*$/, "");
    return re.test(s) ? s : "";
  }

  function phoneHref(phone) {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
    return d ? "tel:+" + d : "";
  }

  // Приводит ответ сервера (или fallback из data.js) к виду, удобному для отрисовки
  function normalize(raw) {
    const fb = SITE.fallback;
    const s = Object.assign({}, fb.settings);
    // Пустой текст из таблицы — осознанно пустой (например, акции сейчас нет); null — значения нет
    Object.entries((raw && raw.settings) || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined) s[k] = v;
    });

    const tg = handle(s.telegram, /^[A-Za-z0-9_]{3,64}$/) || handle(fb.settings.telegram, /^\w+$/);
    const ig = handle(s.instagram, /^[A-Za-z0-9_.]{1,64}$/) || handle(fb.settings.instagram, /^[\w.]+$/);
    const contacts = {
      telegram: `https://t.me/${tg}`,
      telegramLabel: `@${tg}`,
      instagram: `https://instagram.com/${ig}`,
      instagramLabel: `@${ig}`,
      phone: String(s.phone || ""),
      phoneHref: phoneHref(s.phone),
      pickupAddress: String(s.address || ""),
      delivery: String(s.delivery || ""),
    };

    const list = (arr, fbArr) => (Array.isArray(arr) ? arr : fbArr)
      .filter((x) => x && x.id && x.name)
      .map((x) => Object.assign({}, x, {
        id: String(x.id), name: String(x.name), desc: String(x.desc || ""),
        price: Number(x.price) > 0 ? Number(x.price) : null, photo: String(x.photo || ""),
      }));

    const fillings = list(raw && raw.fillings, fb.fillings).filter((f) => f.price);
    fillings.forEach((f) => (f.category = String(f.category || "Стандарт").trim()));

    // Категории: сначала известные по порядку, потом новые — в порядке появления
    const names = [];
    fillings.forEach((f) => { if (!names.includes(f.category)) names.push(f.category); });
    const rank = (n) => { const i = SITE.categoryOrder.indexOf(n); return i < 0 ? 100 + names.indexOf(n) : i; };
    const sorted = names.slice().sort((a, b) => rank(a) - rank(b));
    const categories = sorted.map((name, i) => {
      const prices = fillings.filter((f) => f.category === name).map((f) => f.price);
      const min = Math.min.apply(null, prices);
      const info = (SITE.categoryInfo || {})[name] || {};
      return { id: KNOWN_CATS[name] || `cat-${i + 1}`, name, price: min, same: prices.every((p) => p === min),
        note: info.note || "", minWeight: Number(info.minWeight) > 0 ? Number(info.minWeight) : null };
    });
    fillings.forEach((f) => (f.cat = categories.find((c) => c.name === f.category)));

    const reviews = (Array.isArray(raw && raw.reviews) ? raw.reviews : fb.reviews || [])
      .filter((r) => r && String(r.text || "").trim())
      .map((r) => ({ id: String(r.id || ""), name: String(r.name || "").trim(),
        text: String(r.text).trim(), filling: String(r.filling || "").trim() }));

    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const busy = (Array.isArray(raw && raw.busy) ? raw.busy : fb.busy)
      .filter((r) => r && isoRe.test(r.from))
      .map((r) => ({ from: r.from, to: isoRe.test(r.to) && r.to >= r.from ? r.to : r.from }));

    const minWeight = Number(s.minWeight) > 0 ? Number(s.minWeight) : 2;
    return {
      contacts,
      settings: s,
      fillings,
      categories,
      desserts: list(raw && raw.desserts, fb.desserts).map((d) => Object.assign(d, {
        unit: String(d.unit || "").trim(),
        minQty: Number(d.minQty) >= 1 ? Math.floor(Number(d.minQty)) : null,
        options: (Array.isArray(d.options) ? d.options : String(d.options || "").split(/\s*[;\n]\s*/))
          .map((o) => String(o).trim()).filter(Boolean),
      })),
      busy,
      reviews,
      prepayment: Number(s.prepayment) >= 0 ? Number(s.prepayment) : 50,
      cancelDays: Number(s.cancelDays) >= 0 ? Math.floor(Number(s.cancelDays)) : 2,
      minDaysAhead: Math.max(0, Math.floor(Number(s.minDaysAhead) || 0)),
      weight: { min: minWeight, max: Math.max(10, minWeight), step: 0.5, default: minWeight },
    };
  }

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY));
      return c && c.data && Array.isArray(c.data.fillings) ? c.data : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (e) { /* нет места или хранилище запрещено */ }
  }

  // Свежие данные из Google Таблицы. Ошибка — молча остаёмся на кэше или data.js
  function refresh() {
    if (!SITE.api) return;
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), 12000);
    fetch(SITE.api, { cache: "no-store", signal: ctrl && ctrl.signal })
      .then((r) => r.json())
      .then((json) => {
        if (!json || json.ok === false || !Array.isArray(json.fillings)) return;
        writeCache(json);
        apply(json);
      })
      .catch(() => {})
      .then(() => clearTimeout(timer));
  }

  /* ================= Фото с заглушкой =================
     Заглушка рисуется самим контейнером (фон / подпись), картинка лежит поверх.
     Нет файла → img удаляется, остаётся заглушка. Есть файл → он закрывает заглушку.
     src может быть списком: не загрузился первый — пробуем следующий. */
  // Фото из папки сайта: рядом лежат уменьшенные копии в sm/ — телефон берёт маленькую, компьютер большую.
  // [ширина маленькой, ширина большой, высота большой]; sizes — сколько места фото занимает на экране
  const PHOTO_SIZES = {
    fillings: { sm: 450, w: 900, h: 900, sizes: "(min-width: 960px) 240px, (min-width: 640px) 200px, 140px" },
    desserts: { sm: 500, w: 1000, h: 1000, sizes: "(min-width: 960px) 340px, (min-width: 640px) 220px, 150px" },
    gallery: { sm: 600, w: 1000, h: 1250, sizes: "(min-width: 960px) 380px, (min-width: 640px) 240px, 160px" },
  };
  const LOCAL_PHOTO = /^images\/(fillings|desserts|gallery)\/([^/?]+\.jpg)(\?.*)?$/;
  function setPhotoSrc(img, box, src) {
    const m = LOCAL_PHOTO.exec(src);
    if (m) {
      const k = PHOTO_SIZES[m[1]];
      img.srcset = `images/${m[1]}/sm/${m[2]}${m[3] || ""} ${k.sm}w, ${src} ${k.w}w`;
      img.sizes = box.classList.contains("photo--sm") ? "72px" : k.sizes;
      img.width = k.w;
      img.height = k.h;
    } else {
      // фото с Google Диска (из админки) — как есть
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
    }
    img.src = src;
  }

  function attachPhoto(box, src, alt, onLoad) {
    const srcs = [].concat(src).filter((s, i, a) => s && a.indexOf(s) === i);
    const img = new Image();
    img.alt = alt || "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("load", () => {
      box.classList.add("has-photo");
      if (onLoad) onLoad(img);
    });
    img.addEventListener("error", () => (srcs.length ? setPhotoSrc(img, box, srcs.shift()) : img.remove()));
    box.append(img);
    setPhotoSrc(img, box, srcs.shift() || "");
    return box;
  }

  function placeholderPhoto(cls, src, alt, label, onLoad) {
    const box = el("div", { class: "photo " + cls }, [
      el("span", { class: "photo__label", text: label }),
    ]);
    return attachPhoto(box, src, alt, onLoad);
  }

  // Круг с горизонтальными слоями в цветах начинки
  function layersGradient(colors) {
    const step = 100 / colors.length;
    const stops = colors.map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`);
    return `linear-gradient(to top, ${stops.join(", ")})`;
  }

  // Файл товара из папки сайта; ?v= сбрасывает кэш после замены фото (SITE.photoVersion)
  function localPhoto(dir, id) {
    const file = (SITE.photoFiles || {})[id] || id;
    return `images/${dir}/${file}.jpg?v=${encodeURIComponent(SITE.photoVersion || 1)}`;
  }

  function fillingPhoto(f, cls = "photo--round") {
    const box = el("div", { class: "photo " + cls + " photo--layers" });
    box.style.backgroundImage = layersGradient(SITE.layers[f.id] || SITE.defaultLayers);
    return attachPhoto(box, [f.photo, localPhoto("fillings", f.id)], `Начинка «${f.name}» в разрезе`);
  }

  const dessertSrc = (d) => [d.photo, localPhoto("desserts", d.id)];

  /* ================= Тост ================= */
  const dialog = $("#order");
  const toast = $("#toast");
  let toastTimer;
  function showToast(msg) {
    // Открытый <dialog> лежит в верхнем слое — тост должен быть внутри него, иначе его не видно
    const host = dialog.open ? dialog : document.body;
    if (toast.parentNode !== host) host.append(toast);
    toast.textContent = msg;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3500);
  }

  /* ================= Копирование ================= */
  const canClipboard = !!(navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext);

  // Старый способ через execCommand; работает синхронно в обработчике клика
  function legacyCopy(text) {
    const host = dialog.open ? dialog : document.body;
    const ta = el("textarea", { readonly: true, class: "visually-hidden-input" });
    ta.value = text;
    host.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  // Возвращает Promise<boolean>. Вызывать синхронно из обработчика клика.
  function copyText(text) {
    if (canClipboard) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  /* ================= Контакты, условия, акции ================= */
  function renderInfo() {
    const C = D.contacts;
    const values = Object.assign({ city: "Электросталь" }, C);
    $$("[data-tg]").forEach((a) => (a.href = C.telegram));
    $$("[data-ig]").forEach((a) => (a.href = C.instagram));
    $$("[data-phone]").forEach((a) => (C.phoneHref ? (a.href = C.phoneHref) : a.removeAttribute("href")));
    $$("[data-text]").forEach((n) => (n.textContent = values[n.dataset.text] || ""));
    $$("[data-setting]").forEach((n) => (n.textContent = D[n.dataset.setting]));

    // Полоса фактов под первым экраном: начинок — по данным (вниз до десятков с «+»)
    const nFill = D.fillings.length;
    $("#fact-fillings").textContent = nFill >= 10 ? `${Math.floor(nFill / 10) * 10}+` : String(nFill);

    const terms = ["Оптимально заказывать за 2–3 недели до события (свадебные торты — заранее, уточняйте). При возможности возьму заказ даже за 2–3 дня.",
      `Предоплата ${D.prepayment}% от стоимости — обязательна для всех заказов.`]
      .concat(D.cancelDays > 0
        ? `При отказе позже чем за ${D.cancelDays} ${daysWord(D.cancelDays)} до выдачи предоплата не возвращается.`
        : "При отказе в день выдачи предоплата не возвращается.")
      .concat(C.pickupAddress ? [`Самовывоз: ${C.pickupAddress}.`] : [])
      .concat(C.delivery ? [`${C.delivery.replace(/\.$/, "")}.`] : []);
    $("#terms-list").replaceChildren(...terms.map((t) => el("li", { text: t })));

    const promos = [
      { title: "Подарок за первый заказ", text: D.settings.promoFirst },
      { title: "Кешбэк «Приведи друга»", text: D.settings.promoFriend },
    ].filter((p) => p.text);
    $("#promos-list").replaceChildren(...promos.map((p) =>
      el("li", {}, [el("strong", { text: p.title }), el("span", { text: p.text })])));
  }

  /* ================= Начинки ================= */
  const fillingsList = $("#fillings-list");
  const filters = $("#filters");
  let currentFilter = "all";

  const catPrice = (c) => `${c.same ? "" : "от "}${money(c.price)} ₽`;

  function renderFillings() {
    let num = 0;
    const groups = D.categories.map((cat) => {
      const grid = el("div", { class: "grid grid--fillings" });
      D.fillings.filter((x) => x.cat === cat).forEach((x) => grid.append(fillingCard(x, ++num)));
      return el("div", { class: "group", "data-cat": cat.id }, [
        el("div", { class: "group__head" }, [
          el("h3", { class: "group__title", text: cat.name }),
          el("span", { class: "group__price", text: `${catPrice(cat)}/кг` }),
        ]),
        cat.note ? el("p", { class: "group__note", text: cat.note }) : null,
        grid,
      ]);
    });
    fillingsList.replaceChildren(...groups);
    if (!groups.length) fillingsList.append(el("p", { class: "section__lead", text: "Скоро здесь появятся начинки." }));

    const btn = (id, label) =>
      el("button", { type: "button", class: "chip", "data-filter": id, text: label, onclick: () => setFilter(id) });
    filters.replaceChildren(btn("all", "Все"), ...D.categories.map((c) => btn(c.id, `${c.name} ${catPrice(c)}`)));
    filters.hidden = D.categories.length < 2;
    if (!D.categories.some((c) => c.id === currentFilter)) currentFilter = "all";
    setFilter(currentFilter);
  }

  function fillingCard(item, num) {
    return el("article", { class: "card card--filling", id: item.id, "data-item": item.id }, [
      fillingPhoto(item),
      el("span", { class: "card__num", text: pad(num) }),
      el("button", { type: "button", class: "card__share", title: "Скопировать ссылку",
        "aria-label": `Скопировать ссылку на начинку «${item.name}»`, onclick: () => copyLink(item.id) }, [shareIcon()]),
      el("h4", { class: "card__title", text: item.name }),
      el("p", { class: "card__desc", text: item.desc }),
      // цена и кнопка прижаты к низу карточки — в ряду стоят на одной линии
      el("div", { class: "card__foot" }, [
        el("p", { class: "card__price" }, [el("strong", { text: `${money(item.price)} ₽` }), " / кг"]),
        el("div", { class: "card__actions" }, [
          el("button", { type: "button", class: "btn btn--primary btn--block", text: "Заказать",
            onclick: (e) => openOrder({ type: "filling", item }, e.currentTarget) }),
        ]),
      ]),
    ]);
  }

  function setFilter(id) {
    currentFilter = id;
    $$(".chip", filters).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === id)));
    $$(".group", fillingsList).forEach((g) => (g.hidden = id !== "all" && g.dataset.cat !== id));
  }

  // Значок «поделиться»: три точки, соединённые линиями
  function shareIcon() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML = '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4"/>';
    return svg;
  }

  function copyLink(id) {
    const url = location.href.split("#")[0] + "#" + id;
    copyText(url).then((ok) => {
      if (ok) showToast("Ссылка скопирована");
      else window.prompt("Скопируйте ссылку на начинку:", url);
    });
  }

  /* ================= Десерты ================= */
  // «300 ₽/шт · от 4 шт», «2 500 ₽/кг», «1 700 ₽» (full: «1 700 ₽ за торт»)
  function dessertPrice(d, full) {
    if (!d.price) return "";
    const p = `${money(d.price)} ₽`;
    if (d.unit === "шт") return `${p}/шт` + (d.minQty > 1 ? ` · от ${d.minQty} шт` : "");
    if (d.unit === "кг") return `${p}/кг` + (d.minQty ? ` · от ${kg(d.minQty)} кг` : "");
    return full && d.unit ? `${p} ${d.unit}` : p;
  }

  function optionsShort(d) {
    const n = d.options.length;
    if (!n) return "";
    if (n <= 3) return `Начинки: ${d.options.map(lowerFirst).join(", ")}`;
    return `${n} ${n % 10 === 1 && n % 100 !== 11 ? "начинка" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "начинки" : "начинок"} на выбор`;
  }

  function renderDesserts() {
    $("#desserts-list").replaceChildren(...D.desserts.map((d) =>
      el("article", { class: "card card--dessert", id: d.id, "data-item": d.id }, [
        placeholderPhoto("photo--square", dessertSrc(d), d.name, `Фото: ${d.name}`),
        el("h3", { class: "card__title", text: d.name }),
        el("p", { class: "card__desc", text: d.desc }),
        d.options.length ? el("p", { class: "card__desc card__options", text: optionsShort(d) }) : null,
        el("div", { class: "card__foot" }, [
          d.price ? el("p", { class: "card__price" }, [el("strong", { text: dessertPrice(d) })]) : null,
          el("div", { class: "card__actions" }, [
            el("button", { type: "button", class: "btn btn--outline btn--block",
              text: d.price ? "Заказать" : "Узнать цену",
              onclick: (e) => openOrder({ type: "dessert", item: d }, e.currentTarget) }),
          ]),
        ]),
      ])
    ));
    $("#desserts").hidden = !D.desserts.length;
  }

  /* ================= Отзывы: слайдер, один отзыв за раз ================= */
  const slider = $("#reviews-slider");
  let slideIndex = 0;
  const pad2 = (n) => String(n).padStart(2, "0");

  function renderReviews() {
    const list = $("#reviews-list");
    const n = D.reviews.length;
    $("#reviews").hidden = !n;
    if (slideIndex >= n) slideIndex = 0;
    // Все отзывы лежат в одной ячейке сетки: высота блока = самый длинный отзыв, страница не прыгает
    list.replaceChildren(...D.reviews.map((r, i) => {
      const f = r.filling && D.fillings.find((x) => x.id === r.filling);
      return el("figure", { class: "rquote", role: "group", "aria-roledescription": "отзыв", "aria-label": `${i + 1} из ${n}` }, [
        el("blockquote", { class: "rquote__text", text: r.text }),
        el("figcaption", { class: "rquote__foot" }, [
          r.name ? el("span", { class: "rquote__by", text: `— ${r.name}` }) : null,
          f ? el("a", { class: "rquote__tag", href: `#${f.id}`,
            "aria-label": `Начинка «${f.name}» — показать в меню`,
            onclick: (e) => {
              e.preventDefault();
              if (location.hash !== "#" + f.id) history.pushState(null, "", "#" + f.id);
              handleHash();
            } }, [el("span", { "aria-hidden": "true", text: "🍰" }), el("span", { text: f.name })]) : null,
        ]),
      ]);
    }));
    $("#reviews-dots").replaceChildren(...D.reviews.map((r, i) =>
      el("button", { type: "button", class: "quotes__dot", "aria-label": `Отзыв ${i + 1}`, onclick: () => showReview(i) })));
    $$(".quotes__arrow", slider).forEach((b) => (b.hidden = n < 2));
    $("#reviews-dots").hidden = n < 2;
    showReview(slideIndex, 0);
  }

  function showReview(i, dir) {
    const slides = $$(".rquote", slider);
    const n = slides.length;
    if (!n) return;
    const next = (i + n) % n;
    // направление сдвига: вперёд — новый отзыв приходит справа
    const d = dir != null ? dir : next >= slideIndex ? 1 : -1;
    slider.style.setProperty("--from", `${d * 24}px`);
    slideIndex = next;
    slides.forEach((s, k) => {
      const on = k === next;
      s.classList.toggle("is-active", on);
      s.setAttribute("aria-hidden", String(!on));
      s.inert = !on;
    });
    $$(".quotes__dot", slider).forEach((b, k) => b.setAttribute("aria-current", k === next ? "true" : "false"));
    $("#reviews-count").textContent = `${pad2(next + 1)} / ${pad2(n)}`;
    sizeReviews(dir !== 0);
  }

  // Высота блока — по текущему отзыву: стрелки и точки сразу под текстом, смена высоты плавная (0.3 с)
  const reviewsViewport = $("#reviews-list");
  function sizeReviews(animate) {
    const active = $(".rquote.is-active", slider);
    if (!active) return;
    const cs = getComputedStyle(reviewsViewport);
    const h = active.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    if (!animate) reviewsViewport.style.transition = "none";
    reviewsViewport.style.height = `${h}px`;
    if (!animate) { reviewsViewport.getBoundingClientRect(); reviewsViewport.style.transition = ""; }
  }
  let reviewsResize = 0;
  window.addEventListener("resize", () => { clearTimeout(reviewsResize); reviewsResize = setTimeout(() => sizeReviews(false), 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => sizeReviews(false));
  window.addEventListener("load", () => sizeReviews(false));

  $$(".quotes__arrow", slider).forEach((b) =>
    b.addEventListener("click", () => showReview(slideIndex + Number(b.dataset.dir), Number(b.dataset.dir))));

  // Свайп на телефоне
  let swipeX = null, swipeY = null;
  const viewport = $("#reviews-list");
  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { swipeX = null; return; }
    swipeX = e.touches[0].clientX;
    swipeY = e.touches[0].clientY;
  }, { passive: true });
  viewport.addEventListener("touchend", (e) => {
    if (swipeX === null) return;
    const dx = e.changedTouches[0].clientX - swipeX;
    const dy = e.changedTouches[0].clientY - swipeY;
    swipeX = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      const d = dx < 0 ? 1 : -1;
      showReview(slideIndex + d, d);
    }
  });

  // Клавиши ← → — когда слайдер на экране и курсор не в поле ввода
  document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.altKey || e.ctrlKey || e.metaKey || $("#reviews").hidden) return;
    if (document.querySelector("dialog[open]") || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) return;
    const r = slider.getBoundingClientRect();
    const visible = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    if (visible < r.height / 2) return;
    e.preventDefault();
    const d = e.key === "ArrowRight" ? 1 : -1;
    showReview(slideIndex + d, d);
  });

  /* ================= Частые вопросы: аккордеон + разметка FAQPage ================= */
  function renderFaq() {
    const list = $("#faq-list");
    const items = (SITE.faq || []).filter((x) => x && x.q && x.a);
    $("#faq").hidden = !items.length;
    if (!items.length) return;

    list.replaceChildren(...items.map((item, i) => {
      const btn = el("button", { type: "button", class: "faq__q", id: `faq-q-${i + 1}`,
        "aria-expanded": "false", "aria-controls": `faq-a-${i + 1}` }, [
        el("span", { class: "faq__text", text: item.q }),
        el("span", { class: "faq__icon", "aria-hidden": "true" }),
      ]);
      const panel = el("div", { class: "faq__a", id: `faq-a-${i + 1}`, role: "region", "aria-labelledby": `faq-q-${i + 1}` }, [
        el("div", { class: "faq__inner" }, [el("p", { text: item.a })]),
      ]);
      panel.inert = true;
      btn.addEventListener("click", () => toggleFaq(btn));
      return el("div", { class: "faq__item" }, [el("h3", { class: "faq__head" }, [btn]), panel]);
    }));

    // Разметка для поисковиков — из тех же текстов
    const ld = document.getElementById("faq-ld") || document.head.appendChild(el("script", { type: "application/ld+json", id: "faq-ld" }));
    ld.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: items.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
    });
  }

  // Открыт только один ответ: открываем нажатый, остальные закрываем
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function toggleFaq(btn) {
    const open = btn.getAttribute("aria-expanded") !== "true";
    $$(".faq__q", $("#faq-list")).forEach((b) => {
      const on = b === btn && open;
      const item = b.closest(".faq__item");
      if (item.classList.contains("is-open") === on) return;
      const panel = $("#" + b.getAttribute("aria-controls"));
      b.setAttribute("aria-expanded", String(on));
      panel.inert = !on;
      animateFaq(item, panel, on);
    });
  }
  // Плавно меняем высоту только у этого ответа: замеряем «было» и «стало», анимируем height
  function animateFaq(item, panel, open) {
    const from = panel.getBoundingClientRect().height;
    if (panel._anim) panel._anim.cancel();
    item.classList.toggle("is-open", open);
    const to = open ? panel.scrollHeight : 0;
    if (reduceMotion() || !panel.animate || from === to) return;
    panel._anim = panel.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 350, easing: "ease" });
    panel._anim.onfinish = panel._anim.oncancel = () => { panel._anim = null; };
  }

  /* ================= Галерея, отзывы, фото страницы (один раз) ================= */
  function renderStatic() {
    renderFaq();
    const gl = $("#gallery-list");
    const works = SITE.gallery.map((w, i) => {
      const file = typeof w === "string" ? w : w.file;
      const caption = (typeof w === "string" ? "" : w.title || w.caption) || `Работа ${i + 1}`;
      const text = (typeof w === "string" ? "" : w.text) || "";
      return { src: `images/gallery/${file}?v=${encodeURIComponent(SITE.photoVersion || 1)}`, caption, text };
    });
    works.forEach((w, i) => {
      const btn = el("button", { type: "button", class: "work", "aria-label": `Открыть фото: ${w.caption}` }, [
        placeholderPhoto("photo--work", w.src, w.caption, `Фото работы ${pad(i + 1)}`),
      ]);
      btn.addEventListener("click", () => openLightbox(works, i, btn));
      gl.append(el("figure", { class: "work-card" }, [
        btn,
        el("figcaption", { class: "work-card__caption" }, [
          el("h3", { class: "work-card__title", text: w.caption }),
          w.text ? el("p", { class: "work-card__text", text: w.text }) : null,
        ].filter(Boolean)),
      ]));
    });

    $$(".photo[data-src]").forEach((box) => {
      box.append(el("span", { class: "photo__label", text: box.dataset.label }));
      attachPhoto(box, `${box.dataset.src}?v=${encodeURIComponent(SITE.photoVersion || 1)}`, box.dataset.alt);
    });
  }

  /* ================= Лайтбокс галереи ================= */
  const lb = $("#lightbox");
  let lbItems = [];
  let lbIndex = 0;
  let lbOpener = null;

  function showSlide(i) {
    lbIndex = (i + lbItems.length) % lbItems.length;
    const w = lbItems[lbIndex];
    const img = $(".lightbox__img", lb);
    img.src = w.src;
    img.alt = w.caption;
    $(".lightbox__caption", lb).textContent = w.caption;
    $(".lightbox__text", lb).textContent = w.text || "";
    $(".lightbox__text", lb).hidden = !w.text;
    $(".lightbox__count", lb).textContent = `${lbIndex + 1} / ${lbItems.length}`;
    $$(".lightbox__nav", lb).forEach((b) => (b.hidden = lbItems.length < 2));
  }

  function openLightbox(items, i, from) {
    lbItems = items;
    lbOpener = from || null;
    showSlide(i);
    document.documentElement.classList.add("is-locked");
    if (lb.showModal) lb.showModal();
    else lb.setAttribute("open", "");
    $(".lightbox__close", lb).focus();
  }

  function closeLightbox() {
    if (lb.close) lb.close();
    else { lb.removeAttribute("open"); lb.dispatchEvent(new Event("close")); }
  }

  lb.addEventListener("close", () => {
    document.documentElement.classList.remove("is-locked");
    if (lbOpener && document.contains(lbOpener)) lbOpener.focus();
  });
  $(".lightbox__close", lb).addEventListener("click", closeLightbox);
  $$(".lightbox__nav", lb).forEach((b) => b.addEventListener("click", () => showSlide(lbIndex + Number(b.dataset.dir))));
  // Клик мимо фото и кнопок закрывает
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.classList.contains("lightbox__stage")) closeLightbox(); });
  lb.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") showSlide(lbIndex - 1);
    else if (e.key === "ArrowRight") showSlide(lbIndex + 1);
    else if (e.key === "Escape" && !lb.showModal) closeLightbox();
  });
  // Листание свайпом
  let touchX = null;
  lb.addEventListener("touchstart", (e) => { touchX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50 && lbItems.length > 1) showSlide(lbIndex + (dx < 0 ? 1 : -1));
  });

  /* ================= Окно заявки ================= */
  const f = {
    title: $("#order-title"),
    meta: $("#order-meta"),
    photo: $("#order-photo"),
    weightField: $("#order-weight-field"),
    weightLabel: $("#weight-label"),
    weight: $("#order-weight"),
    qtyField: $("#order-qty-field"),
    qty: $("#order-qty"),
    optionField: $("#order-option-field"),
    option: $("#order-option"),
    optionError: $("#order-option-error"),
    dateBtn: $("#order-date-btn"),
    nearest: $("#order-nearest"),
    cal: $("#order-cal"),
    wishes: $("#order-wishes"),
    time: $("#order-time"),
    totalBox: $("#order-total-box"),
    total: $("#order-total"),
    send: $("#order-send"),
    manual: $("#order-manual"),
    manualText: $("#order-manual-text"),
  };
  let current = null;
  let weight = 2;
  let qty = 1;
  let selectedDate = "";
  let opener = null;
  let manualShown = false;

  /* --- даты --- */
  const earliest = () => Cal.addDays(Cal.today(), D.minDaysAhead);
  const lastDate = () => Cal.addDays(Cal.today(), 366);
  const isBusy = (iso) => D.busy.some((r) => iso >= r.from && iso <= r.to);
  const isFree = (iso) => iso >= earliest() && iso <= lastDate() && !isBusy(iso);

  function nearestFree() {
    for (let d = earliest(), end = lastDate(); d <= end; d = Cal.addDays(d, 1)) {
      if (!isBusy(d)) return d;
    }
    return "";
  }

  const calendar = Cal.create(f.cal, {
    minMonth: Cal.today(),
    maxMonth: lastDate(),
    day: (iso) => {
      const busy = iso >= Cal.today() && isBusy(iso);
      return {
        disabled: !isFree(iso),
        busy,
        selected: iso === selectedDate,
        note: busy ? "занято" : isFree(iso) ? "свободно" : "недоступно",
      };
    },
    onPick: (iso) => {
      selectedDate = iso;
      toggleCalendar(false);
      updateDate();
      f.dateBtn.focus();
    },
  });

  function toggleCalendar(open) {
    f.cal.hidden = !open;
    f.dateBtn.setAttribute("aria-expanded", String(open));
    if (open) calendar.show(selectedDate || nearestFree() || earliest());
  }

  function updateDate() {
    if (selectedDate && !isFree(selectedDate)) selectedDate = "";
    f.dateBtn.textContent = selectedDate ? Cal.human(selectedDate) : "Выберите дату";
    f.dateBtn.classList.toggle("is-empty", !selectedDate);

    const near = nearestFree();
    const parts = [];
    if (near) {
      parts.push("Ближайшая свободная дата: ",
        el("button", { type: "button", class: "link-btn link-btn--inline", text: Cal.human(near),
          onclick: () => { selectedDate = near; toggleCalendar(false); updateDate(); } }));
    } else {
      parts.push("Свободных дат в календаре пока нет — напишите Марине, она подскажет.");
    }
    if (selectedDate) {
      parts.push(" · ", el("button", { type: "button", class: "link-btn link-btn--inline", text: "убрать дату",
        onclick: () => { selectedDate = ""; updateDate(); } }));
    }
    f.nearest.replaceChildren(...parts);
    if (!f.cal.hidden) calendar.render();
  }

  f.dateBtn.addEventListener("click", () => toggleCalendar(f.cal.hidden));

  /* --- окно --- */
  let lastOrderKey = "";
  function setOptionError(on) {
    f.optionField.classList.toggle("has-error", on);
    f.optionError.hidden = !on;
    if (on) f.option.setAttribute("aria-invalid", "true");
    else f.option.removeAttribute("aria-invalid");
  }

  function openOrder(order, from) {
    current = order;
    opener = from || null;
    manualShown = false;
    f.manual.hidden = true;
    setOptionError(false);
    // пожелания по декору относятся к конкретному товару: у другого товара — чистое поле
    // (дата, время и способ получения остаются)
    const orderKey = `${order.type}:${order.item.id}`;
    if (orderKey !== lastOrderKey) f.wishes.value = "";
    lastOrderKey = orderKey;

    const isFilling = order.type === "filling";
    const item = order.item;
    weight = weightRange().min;
    qty = item.minQty || 1;
    f.title.textContent = item.name;
    f.meta.textContent = isFilling
      ? `${item.category} · ${money(item.price)} ₽/кг`
      : item.price ? dessertPrice(item, true) : "Цену подскажет Марина";

    // начинка на выбор (у десертов)
    const opts = isFilling ? [] : item.options;
    f.option.replaceChildren(el("option", { value: "", text: "Выберите начинку" }),
      ...opts.map((o) => el("option", { value: o, text: o })));
    f.optionField.hidden = !opts.length;
    f.photo.replaceChildren(
      isFilling
        ? fillingPhoto(item, "photo--round photo--sm")
        : placeholderPhoto("photo--round photo--sm", dessertSrc(item), item.name, "")
    );
    const byWeight = isFilling || item.unit === "кг";
    f.weightField.hidden = !byWeight;
    f.weightLabel.textContent = isFilling ? "Вес торта" : "Вес";
    f.qtyField.hidden = isFilling || item.unit !== "шт";
    f.totalBox.hidden = !(isFilling || (item.price && (item.unit === "шт" || item.unit === "кг")));
    f.send.href = D.contacts.telegram;
    toggleCalendar(false);
    updateWeight();
    updateDate();

    document.documentElement.classList.add("is-locked");
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector(".sheet__close").focus();
  }

  function closeOrder() {
    if (dialog.close) dialog.close();
    else dialog.removeAttribute("open");
  }

  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("is-locked");
    document.body.append(toast);
    if (opener && document.contains(opener)) opener.focus();
  });
  // Клик по фону (сам <dialog> вне .sheet__body)
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeOrder(); });
  $$("[data-close]", dialog).forEach((b) => b.addEventListener("click", closeOrder));
  // Esc для браузеров без нативного <dialog>
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dialog.hasAttribute("open") && !dialog.showModal) closeOrder();
  });

  // Вес: общий минимум из настроек; у категории (советская классика) и у десерта «на вес» — свой
  function weightRange() {
    const W = D.weight;
    if (!current) return W;
    const item = current.item;
    const min = current.type === "filling"
      ? (item.cat && item.cat.minWeight) || W.min
      : item.minQty || 1;
    return { min, max: Math.max(W.max, min), step: W.step };
  }

  const QTY_MAX = 200;

  function updateWeight() {
    const W = weightRange();
    weight = Math.min(W.max, Math.max(W.min, weight));
    f.weight.textContent = `${kg(weight)} кг`;
    $$("[data-step]", dialog).forEach((b) => {
      b.disabled = b.dataset.step < 0 ? weight <= W.min : weight >= W.max;
    });
    const minQ = (current && current.item.minQty) || 1;
    qty = Math.min(QTY_MAX, Math.max(minQ, qty));
    f.qty.textContent = `${qty} шт`;
    $$("[data-qstep]", dialog).forEach((b) => {
      b.disabled = b.dataset.qstep < 0 ? qty <= minQ : qty >= QTY_MAX;
    });
    if (!current) return;
    const item = current.item;
    if (current.type === "filling" || item.unit === "кг") f.total.textContent = `${money(item.price * weight)} ₽`;
    else if (item.unit === "шт") f.total.textContent = `${money(item.price * qty)} ₽`;
  }

  $$("[data-step]", dialog).forEach((b) =>
    b.addEventListener("click", () => {
      weight = Math.round((weight + Number(b.dataset.step) * weightRange().step) * 100) / 100;
      updateWeight();
    })
  );
  $$("[data-qstep]", dialog).forEach((b) =>
    b.addEventListener("click", () => {
      qty += Number(b.dataset.qstep);
      updateWeight();
    })
  );

  function buildText() {
    const { item, type } = current;
    const lines = [];
    if (type === "filling") {
      lines.push(`Здравствуйте, Марина! Хочу заказать торт с начинкой «${item.name}» (${item.category.toLowerCase()}, ${money(item.price)} ₽/кг).`);
      lines.push(`Вес: примерно ${kg(weight)} кг`);
    } else if (item.price) {
      const price = item.unit === "шт" ? `${money(item.price)} ₽/шт` : item.unit === "кг" ? `${money(item.price)} ₽/кг`
        : dessertPrice(item, true);
      lines.push(`Здравствуйте, Марина! Хочу заказать: ${lowerFirst(item.name)} (${price}).`
        + (selectedDate ? "" : " Подскажите, пожалуйста, свободные даты."));
      if (f.option.value) lines.push(`Начинка: ${f.option.value}`);
      if (item.unit === "шт") lines.push(`Количество: ${qty} шт`);
      if (item.unit === "кг") lines.push(`Вес: примерно ${kg(weight)} кг`);
    } else {
      lines.push(`Здравствуйте, Марина! Интересует: ${lowerFirst(item.name)}. Подскажите, пожалуйста, цену и свободные даты.`);
      if (f.option.value) lines.push(`Начинка: ${f.option.value}`);
    }
    if (selectedDate) lines.push(`Дата: ${Cal.human(selectedDate)}`);
    const time = f.time.value.trim();
    if (time) lines.push(`Время: ${time}`);
    const receive = $('input[name="order-receive"]:checked', dialog);
    if (receive) lines.push(`Получение: ${receive.value.toLowerCase()}`);
    const wishes = f.wishes.value.trim().replace(/\s*\n\s*/g, "; ");
    if (wishes) lines.push(`Пожелания: ${wishes}`);
    return lines.join("\n");
  }

  function showManual(text) {
    f.manualText.value = text;
    f.manual.hidden = false;
    f.manualText.focus();
    f.manualText.select();
    showToast("Скопируйте текст заявки вручную");
  }

  // <a href="t.me/..."> — переход происходит сам, здесь только копируем текст
  f.option.addEventListener("change", () => { if (f.option.value) setOptionError(false); });

  f.send.addEventListener("click", (e) => {
    // у десерта есть начинки на выбор — без выбора заявку не отправляем
    if (!f.optionField.hidden && !f.option.value) {
      e.preventDefault();
      setOptionError(true);
      f.option.focus();
      showToast("Выберите начинку");
      return;
    }
    const text = buildText();
    f.manualText.value = text;

    if (canClipboard) {
      navigator.clipboard.writeText(text).then(
        () => showToast("Заявка скопирована. Вставьте её в чат и отправьте"),
        () => (legacyCopy(text) ? showToast("Заявка скопирована. Вставьте её в чат и отправьте") : showManual(text))
      );
      return;
    }
    if (legacyCopy(text)) {
      showToast("Заявка скопирована. Вставьте её в чат и отправьте");
      return;
    }
    // Скопировать не удалось: сначала показываем текст, повторное нажатие уже просто откроет Telegram
    showManual(text);
    if (!manualShown) {
      manualShown = true;
      e.preventDefault();
    }
  });

  /* ================= Плавающая кнопка «Заказать» ================= */
  // Появляется, когда первый экран пролистан; прячется у вопросов, контактов и футера — там своя кнопка Telegram
  const fab = $(".fab");
  const heroStage = $(".hero__stage");
  const fabHideZones = ["#faq", "#contacts", ".footer"].map((s) => $(s)).filter(Boolean);
  function updateFab() {
    if (!fab) return;
    const vh = window.innerHeight;
    const pastHero = !heroStage || heroStage.getBoundingClientRect().bottom < 80;
    const inZone = fabHideZones.some((n) => {
      if (n.hidden) return false;
      const r = n.getBoundingClientRect();
      return r.top < vh - 40 && r.bottom > 0;
    });
    fab.classList.toggle("is-hidden", !pastHero || inZone);
  }

  /* ================= Шапка поверх фото первого экрана ================= */
  // Наверху шапка прозрачная поверх фото, ниже — обычная (кремовая)
  const header = $(".header");
  const updateHeader = () => header.classList.toggle("is-over", window.scrollY < 40);

  // Один обработчик прокрутки на шапку и плавающую кнопку: не чаще раза за кадр
  let scrollFrame = 0;
  const onScrollFrame = () => { scrollFrame = 0; updateHeader(); updateFab(); };
  const scheduleScroll = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(onScrollFrame); };
  onScrollFrame();
  window.addEventListener("scroll", scheduleScroll, { passive: true });
  window.addEventListener("resize", scheduleScroll);

  /* ================= Ссылка #id на начинку ================= */
  let highlightTimer;
  let hashDone = false;
  function handleHash() {
    let id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    // старая ссылка на товар, который переехал (#praga → #praga-classic)
    if (!document.getElementById(id) && (SITE.idAliases || {})[id]) id = SITE.idAliases[id];
    const card = $$("[data-item]").find((n) => n.id === id);
    if (!card) return;
    hashDone = true;
    const group = card.closest(".group");
    if (group && group.hidden) setFilter("all");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    $$(".is-highlight").forEach((n) => n.classList.remove("is-highlight"));
    // перезапуск анимации, если ссылку открыли повторно
    void card.offsetWidth;
    card.classList.add("is-highlight");
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => card.classList.remove("is-highlight"), 2500);
  }

  /* ================= Отрисовка ================= */
  function apply(raw) {
    const str = JSON.stringify(raw);
    if (str === rawString) return;
    rawString = str;
    D = normalize(raw);
    renderInfo();
    renderFillings();
    renderDesserts();
    renderReviews();
    if (dialog.open) {
      // данные обновились, пока окно открыто: цена и занятые даты могли поменяться
      if (current && current.type === "filling") {
        const fresh = D.fillings.find((x) => x.id === current.item.id);
        if (fresh) current.item = fresh;
      }
      updateWeight();
      updateDate();
    }
    // карточка из ссылки #id могла появиться только в свежих данных
    if (location.hash && !hashDone && document.readyState === "complete") handleHash();
  }

  renderStatic();
  apply(readCache() || SITE.fallback);
  refresh();

  window.addEventListener("hashchange", handleHash);
  if (location.hash) {
    // ждём шрифты и раскладку, чтобы прокрутка попала точно
    const go = () => setTimeout(handleHash, 50);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go);
    else window.addEventListener("load", go);
  }
})();
