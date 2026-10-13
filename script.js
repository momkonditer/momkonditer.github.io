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

  const KNOWN_CATS = { "Стандарт": "standard", "Лайт": "light", "Премиум": "premium" };
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
      return { id: KNOWN_CATS[name] || `cat-${i + 1}`, name, price: min, same: prices.every((p) => p === min) };
    });
    fillings.forEach((f) => (f.cat = categories.find((c) => c.name === f.category)));

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
      desserts: list(raw && raw.desserts, fb.desserts),
      busy,
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
     Нет файла → img удаляется, остаётся заглушка. Есть файл → он закрывает заглушку. */
  function attachPhoto(box, src, alt, onLoad) {
    const img = new Image();
    img.alt = alt || "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("load", () => {
      box.classList.add("has-photo");
      if (onLoad) onLoad(img);
    });
    img.addEventListener("error", () => img.remove());
    box.append(img);
    img.src = src;
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

  function fillingPhoto(f, cls = "photo--round") {
    const box = el("div", { class: "photo " + cls + " photo--layers" });
    box.style.backgroundImage = layersGradient(SITE.layers[f.id] || SITE.defaultLayers);
    return attachPhoto(box, f.photo || `images/fillings/${f.id}.jpg`, `Начинка «${f.name}» в разрезе`);
  }

  const dessertSrc = (d) => d.photo || `images/desserts/${d.id}.jpg`;

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

    const gift = $("#hero-gift");
    gift.hidden = !D.settings.promoFirstShort;
    $(".gift__text", gift).textContent = D.settings.promoFirstShort || "";

    const terms = [`Предоплата ${D.prepayment}% от стоимости — обязательна для всех заказов.`]
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
      el("h4", { class: "card__title", text: item.name }),
      el("p", { class: "card__desc", text: item.desc }),
      el("p", { class: "card__price" }, [el("strong", { text: `${money(item.price)} ₽` }), " / кг"]),
      el("div", { class: "card__actions" }, [
        el("button", { type: "button", class: "btn btn--primary btn--block", text: "Заказать",
          onclick: (e) => openOrder({ type: "filling", item }, e.currentTarget) }),
        el("button", { type: "button", class: "link-btn", text: "Скопировать ссылку на начинку",
          onclick: () => copyLink(item.id) }),
      ]),
    ]);
  }

  function setFilter(id) {
    currentFilter = id;
    $$(".chip", filters).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === id)));
    $$(".group", fillingsList).forEach((g) => (g.hidden = id !== "all" && g.dataset.cat !== id));
  }

  function copyLink(id) {
    const url = location.href.split("#")[0] + "#" + id;
    copyText(url).then((ok) => {
      if (ok) showToast("Ссылка на начинку скопирована");
      else window.prompt("Скопируйте ссылку на начинку:", url);
    });
  }

  /* ================= Десерты ================= */
  function renderDesserts() {
    $("#desserts-list").replaceChildren(...D.desserts.map((d) =>
      el("article", { class: "card card--dessert", id: d.id, "data-item": d.id }, [
        placeholderPhoto("photo--square", dessertSrc(d), d.name, `Фото: ${d.name}`),
        el("h3", { class: "card__title", text: d.name }),
        el("p", { class: "card__desc", text: d.desc }),
        d.price ? el("p", { class: "card__price" }, [el("strong", { text: `${money(d.price)} ₽` })]) : null,
        el("div", { class: "card__actions" }, [
          el("button", { type: "button", class: "btn btn--outline btn--block",
            text: d.price ? "Заказать" : "Узнать цену",
            onclick: (e) => openOrder({ type: "dessert", item: d }, e.currentTarget) }),
        ]),
      ])
    ));
    $("#desserts").hidden = !D.desserts.length;
  }

  /* ================= Галерея, отзывы, фото страницы (один раз) ================= */
  function renderStatic() {
    const gl = $("#gallery-list");
    SITE.gallery.forEach((file, i) =>
      gl.append(placeholderPhoto("photo--square", `images/gallery/${file}`, `Работа ${i + 1}`, `Фото работы ${pad(i + 1)}`))
    );

    const rl = $("#reviews-list");
    SITE.reviews.forEach((file, i) => {
      const src = `images/reviews/${file}`;
      rl.append(
        placeholderPhoto("photo--story", src, `Скриншот отзыва ${i + 1}`, "Здесь будет скриншот отзыва", (img) => {
          // Скриншот можно открыть крупно
          const a = el("a", { href: src, target: "_blank", rel: "noopener", "aria-label": `Открыть отзыв ${i + 1}` });
          img.replaceWith(a);
          a.append(img);
        })
      );
    });

    $$(".photo[data-src]").forEach((box) => {
      box.append(el("span", { class: "photo__label", text: box.dataset.label }));
      attachPhoto(box, box.dataset.src, box.dataset.alt);
    });
  }

  /* ================= Окно заявки ================= */
  const f = {
    title: $("#order-title"),
    meta: $("#order-meta"),
    photo: $("#order-photo"),
    weightField: $("#order-weight-field"),
    weight: $("#order-weight"),
    dateBtn: $("#order-date-btn"),
    nearest: $("#order-nearest"),
    cal: $("#order-cal"),
    wishes: $("#order-wishes"),
    totalBox: $("#order-total-box"),
    total: $("#order-total"),
    send: $("#order-send"),
    manual: $("#order-manual"),
    manualText: $("#order-manual-text"),
  };
  let current = null;
  let weight = 2;
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
  function openOrder(order, from) {
    current = order;
    opener = from || null;
    weight = D.weight.default;
    manualShown = false;
    f.manual.hidden = true;

    const isFilling = order.type === "filling";
    const item = order.item;
    f.title.textContent = item.name;
    f.meta.textContent = isFilling
      ? `${item.category} · ${money(item.price)} ₽/кг`
      : item.price ? `${money(item.price)} ₽` : "Цену подскажет Марина";
    f.photo.replaceChildren(
      isFilling
        ? fillingPhoto(item, "photo--round photo--sm")
        : placeholderPhoto("photo--round photo--sm", dessertSrc(item), item.name, "")
    );
    f.weightField.hidden = !isFilling;
    f.totalBox.hidden = !isFilling;
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

  function updateWeight() {
    const W = D.weight;
    weight = Math.min(W.max, Math.max(W.min, weight));
    f.weight.textContent = `${kg(weight)} кг`;
    $$("[data-step]", dialog).forEach((b) => {
      b.disabled = b.dataset.step < 0 ? weight <= W.min : weight >= W.max;
    });
    if (current && current.type === "filling") {
      f.total.textContent = `${money(current.item.price * weight)} ₽`;
    }
  }

  $$("[data-step]", dialog).forEach((b) =>
    b.addEventListener("click", () => {
      weight = Math.round((weight + Number(b.dataset.step) * D.weight.step) * 100) / 100;
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
      lines.push(`Здравствуйте, Марина! Хочу заказать: ${lowerFirst(item.name)} (${money(item.price)} ₽). Подскажите, пожалуйста, свободные даты.`);
    } else {
      lines.push(`Здравствуйте, Марина! Интересует: ${lowerFirst(item.name)}. Подскажите, пожалуйста, цену и свободные даты.`);
    }
    if (selectedDate) lines.push(`Дата: ${Cal.human(selectedDate)}`);
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
  f.send.addEventListener("click", (e) => {
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

  /* ================= Ссылка #id на начинку ================= */
  let highlightTimer;
  let hashDone = false;
  function handleHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
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
