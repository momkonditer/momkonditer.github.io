(function () {
  "use strict";

  const API = (window.SITE && window.SITE.api) || "";
  const Cal = window.MiniCalendar;
  const AUTH_KEY = "mom_admin_auth";
  const CATEGORIES = ["Стандарт", "Лайт", "Премиум", "Советская классика"];
  // Единица цены десерта: value — как пишется в таблице
  const UNITS = [
    { value: "шт", label: "за штуку" },
    { value: "за торт", label: "за торт" },
    { value: "за рулет", label: "за рулет" },
    { value: "кг", label: "за кг" },
    { value: "", label: "без подписи" },
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $("#view");
  const titleEl = $("#title");
  const backBtn = $("#back");
  const editor = $("#editor");
  const askDialog = $("#ask");
  const toastEl = $("#toast");

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
      if (child != null && child !== false) node.append(child);
    }
    return node;
  }

  const money = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  // «2 500 ₽», «2500», «2,5» → число; пусто → null; мусор → NaN
  function parseNum(v) {
    const s = String(v == null ? "" : v).replace(/[\s ₽%]|руб\.?|кг/gi, "").replace(",", ".");
    if (!s) return null;
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  /* ================= Сообщения ================= */

  const MSG = {
    offline: "Нет интернета. Проверьте связь и попробуйте ещё раз.",
    timeout: "Сервер долго не отвечает. Попробуйте ещё раз через минуту.",
    server: "Что-то пошло не так. Попробуйте ещё раз через минуту. Если не получится — напишите разработчику.",
    bad_request: "Что-то пошло не так. Обновите страницу и попробуйте ещё раз.",
    no_api: "Админка ещё не подключена к таблице. Напишите разработчику.",
    auth: "Вход устарел. Введите пароль ещё раз.",
    wrong_password: "Пароль не подошёл. Проверьте его и попробуйте ещё раз.",
    too_many: "Слишком много попыток. Подождите 10 минут и попробуйте снова.",
    no_password: "Вход ещё не настроен. Напишите разработчику.",
    name_required: "Напишите название.",
    price_required: "Напишите цену цифрами, например 2500.",
    number_required: "В полях с числами должны быть только цифры.",
    photo: "Не получилось сохранить фото. Попробуйте выбрать другое.",
    photo_big: "Фото слишком большое. Попробуйте выбрать другое.",
    // браузер не смог прочитать файл (чаще всего HEIC с iPhone в Chrome на Android)
    photo_open: "Это фото не получилось загрузить. Попробуйте сделать скриншот фото и загрузить его",
    not_found: "Этого товара уже нет. Обновите страницу.",
    hide_first: "Сначала скройте товар с сайта — потом его можно удалить.",
    text_required: "Напишите текст отзыва.",
  };

  class UserError extends Error {}

  /* ================= Вход ================= */

  function getAuth() {
    try {
      const a = JSON.parse(localStorage.getItem(AUTH_KEY));
      return a && a.token && a.expires > Date.now() ? a : null;
    } catch (e) {
      return null;
    }
  }
  function setAuth(a) {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (e) { /* приватный режим */ }
    memoryAuth = a;
  }
  let memoryAuth = getAuth();
  const isLoggedIn = () => !!(memoryAuth && memoryAuth.expires > Date.now());

  function logout(message) {
    try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* ничего */ }
    memoryAuth = null;
    state.data = null;
    if (editor.open) editor.close();
    renderLogin(message);
  }

  /* ================= Сеть ================= */

  async function api(action, payload = {}, timeout = 30000) {
    if (!API) throw new UserError(MSG.no_api);
    if (navigator.onLine === false) throw new UserError(MSG.offline);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        // text/plain — чтобы браузер не делал предварительный CORS-запрос, который Apps Script не умеет
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ action, token: memoryAuth && memoryAuth.token }, payload)),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new UserError(e.name === "AbortError" ? MSG.timeout : MSG.offline);
    } finally {
      clearTimeout(timer);
    }
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new UserError(MSG.server);
    }
    if (!json || !json.ok) {
      const code = json && json.error;
      if (code === "auth") {
        logout(MSG.auth);
        throw new UserError(MSG.auth);
      }
      throw new UserError(MSG[code] || MSG.server);
    }
    return json;
  }

  const errorText = (e) => (e instanceof UserError ? e.message : MSG.server);

  /* ================= Общие элементы ================= */

  const state = { data: null };

  let toastTimer;
  function toast(msg) {
    // Тост должен быть в самом верхнем открытом окне, иначе его закроет фон окна
    const host = askDialog.open ? askDialog : editor.open ? editor : document.body;
    if (toastEl.parentNode !== host) host.append(toastEl);
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 3000);
  }

  // Вопрос «Точно?» внутри страницы. Возвращает Promise<boolean>
  function ask(text, yesLabel, noLabel = "Отмена", danger = false) {
    return new Promise((resolve) => {
      $("#ask-text").textContent = text;
      const yes = $("#ask-yes"), no = $("#ask-no");
      yes.textContent = yesLabel;
      no.textContent = noLabel;
      yes.className = "btn btn--block " + (danger ? "btn--danger" : "btn--primary");
      const done = (v) => {
        yes.onclick = no.onclick = askDialog.oncancel = null;
        askDialog.close();
        resolve(v);
      };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
      askDialog.oncancel = (e) => { e.preventDefault(); done(false); };
      askDialog.showModal();
      no.focus();
    });
  }

  function field(label, control, hint, id) {
    if (id) control.id = id;
    // начали исправлять — красная подсказка уходит
    control.addEventListener("input", () => setFieldError(control.closest(".field"), ""));
    return el("div", { class: "field" }, [
      el("label", { class: "field__label", for: id || null, text: label }),
      control,
      hint ? el("p", { class: "field__hint", text: hint }) : null,
      el("p", { class: "field__error", "aria-live": "polite" }),
    ]);
  }
  function setFieldError(fieldEl, msg) {
    const e = fieldEl.querySelector(".field__error");
    e.textContent = msg || "";
    fieldEl.classList.toggle("has-error", !!msg);
  }

  function loader(text = "Загружаю…") {
    return el("div", { class: "loader" }, [el("span", { class: "spinner", "aria-hidden": "true" }), el("span", { text })]);
  }

  function errorPanel(message, retry) {
    return el("div", { class: "panel panel--error", role: "alert" }, [
      el("p", { text: message }),
      el("button", { type: "button", class: "btn btn--primary btn--block", text: "Попробовать ещё раз", onclick: retry }),
    ]);
  }

  // Кнопка сохранения: «Сохранить» → «Сохраняю…» → «Сохранено ✓»
  async function runSave(btn, msgEl, work, busyText = "Сохраняю…") {
    const label = btn.dataset.label || (btn.dataset.label = btn.textContent);
    btn.disabled = true;
    btn.textContent = busyText;
    btn.classList.remove("is-done");
    msgEl.textContent = "";
    msgEl.classList.remove("is-error");
    try {
      await work();
      btn.textContent = "Сохранено ✓";
      btn.classList.add("is-done");
      setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove("is-done");
        btn.disabled = false;
      }, 1800);
      return true;
    } catch (e) {
      btn.textContent = label;
      btn.disabled = false;
      msgEl.textContent = errorText(e);
      msgEl.classList.add("is-error");
      return false;
    }
  }

  function withData(render) {
    if (state.data) return render();
    view.replaceChildren(loader());
    api("adminData")
      .then((d) => {
        state.data = d;
        render();
      })
      .catch((e) => {
        if (!isLoggedIn()) return;
        view.replaceChildren(errorPanel(errorText(e), () => withData(render)));
      });
  }

  function thumb(kind, item, cls = "thumb") {
    const box = el("div", { class: cls }, [el("span", { class: "thumb__letter", text: item ? item.name.charAt(0) : "📷" })]);
    // Сначала фото из таблицы, не загрузилось — файл images/<kind>/<id>.jpg
    const srcs = item ? [item.photo, `../images/${kind}/${(SITE.photoFiles || {})[item.id] || item.id}.jpg?v=${encodeURIComponent(SITE.photoVersion || 1)}`].filter(Boolean) : [];
    if (srcs.length) {
      const img = new Image();
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onload = () => box.classList.add("has-photo");
      img.onerror = () => (srcs.length ? (img.src = srcs.shift()) : img.remove());
      box.append(img);
      img.src = srcs.shift();
    }
    return box;
  }

  /* ================= Навигация ================= */

  let dirtyCheck = null;        // функция «есть ли несохранённое» для текущего экрана
  let currentHash = "#/";

  function setTitle(text) {
    titleEl.textContent = text;
    document.title = text === "MOM кондитер" ? "MOM админка" : `${text} · MOM админка`;
  }

  window.addEventListener("hashchange", async () => {
    const target = location.hash || "#/";
    if (dirtyCheck && dirtyCheck()) {
      history.replaceState(null, "", currentHash);
      if (!(await ask("Есть несохранённые изменения. Уйти без сохранения?", "Уйти", "Остаться"))) return;
      dirtyCheck = null;
      location.hash = target;
      return;
    }
    route();
  });

  window.addEventListener("beforeunload", (e) => {
    if (dirtyCheck && dirtyCheck()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  backBtn.addEventListener("click", () => (location.hash = "#/"));

  function route() {
    currentHash = location.hash || "#/";
    dirtyCheck = null;
    if (!isLoggedIn()) return renderLogin();
    const r = currentHash.replace(/^#\/?/, "");
    backBtn.hidden = !r;
    const screens = {
      "": renderHome,
      fillings: () => renderItems("fillings"),
      desserts: () => renderItems("desserts"),
      reviews: renderReviews,
      dates: renderDates,
      settings: renderSettings,
    };
    (screens[r] || renderHome)();
    window.scrollTo(0, 0);
  }

  /* ================= Экран входа ================= */

  function renderLogin(message) {
    setTitle("MOM кондитер");
    backBtn.hidden = true;
    const input = el("input", { type: "password", class: "input", autocomplete: "current-password",
      autocapitalize: "none", autocorrect: "off", spellcheck: "false", enterkeyhint: "go" });
    const showBtn = el("button", { type: "button", class: "link-btn", text: "Показать пароль",
      onclick: () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        showBtn.textContent = show ? "Скрыть пароль" : "Показать пароль";
      } });
    const btn = el("button", { type: "submit", class: "btn btn--primary btn--big btn--block", text: "Войти" });
    const msg = el("p", { class: "form-msg" + (message ? " is-error" : ""), role: "alert", text: message || "" });

    const form = el("form", { class: "login", novalidate: true }, [
      el("div", { class: "login__logo", "aria-hidden": "true" }, [el("span", { text: "MOM" })]),
      el("h2", { class: "login__title", text: "Вход для Марины" }),
      field("Пароль", input, "Пароль дал разработчик. Телефон запомнит вход на 90 дней.", "password"),
      showBtn,
      btn,
      msg,
    ]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!input.value.trim()) {
        msg.textContent = "Введите пароль.";
        msg.className = "form-msg is-error";
        input.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = "Проверяю…";
      msg.textContent = "";
      try {
        const res = await api("login", { password: input.value });
        setAuth({ token: res.token, expires: res.expires });
        input.value = "";
        route();
      } catch (err) {
        msg.textContent = errorText(err);
        msg.className = "form-msg is-error";
        btn.disabled = false;
        btn.textContent = "Войти";
      }
    });
    view.replaceChildren(form);
    if (!("ontouchstart" in window)) input.focus();
  }

  /* ================= Главный экран ================= */

  function renderHome() {
    setTitle("MOM кондитер");
    const tile = (hash, icon, title, sub) =>
      el("a", { class: "tile", href: hash }, [
        el("span", { class: "tile__icon", "aria-hidden": "true", text: icon }),
        el("span", { class: "tile__text" }, [el("strong", { text: title }), el("span", { text: sub })]),
      ]);
    view.replaceChildren(
      el("p", { class: "lead", text: "Здравствуйте, Марина! Что поменяем на сайте?" }),
      el("nav", { class: "tiles" }, [
        tile("#/fillings", "🎂", "Начинки и цены", "Цены, составы, фото разрезов"),
        tile("#/desserts", "🧁", "Десерты", "Бенто, капкейки и другое"),
        tile("#/reviews", "💬", "Отзывы", "Добавить, поправить, скрыть"),
        tile("#/dates", "📅", "Занятые даты", "Когда заказы не принимаются"),
        tile("#/settings", "🎁", "Акции и контакты", "Подарки, телефон, адрес"),
      ]),
      el("div", { class: "home-links" }, [
        el("a", { class: "btn btn--ghost btn--block", href: "../", target: "_blank", rel: "noopener", text: "Открыть сайт" }),
        el("button", { type: "button", class: "link-btn", text: "Выйти из админки",
          onclick: async () => { if (await ask("Выйти из админки на этом телефоне?", "Выйти", "Остаться")) logout(); } }),
      ])
    );
    // Тихо обновляем данные — вдруг что-то поменяли прямо в таблице
    api("adminData").then((d) => (state.data = d)).catch(() => {});
  }

  /* ================= Начинки и десерты ================= */

  const KIND = {
    fillings: { title: "Начинки и цены", one: "начинку", add: "+ Добавить начинку", newTitle: "Новая начинка" },
    desserts: { title: "Десерты", one: "десерт", add: "+ Добавить десерт", newTitle: "Новый десерт" },
  };

  function itemSub(kind, it) {
    if (kind === "fillings") return `${it.category} · ${money(it.price)} ₽ за кг`;
    if (!it.price) return "Цена: «Узнать цену»";
    if (it.unit === "шт") return `${money(it.price)} ₽ за шт` + (it.minQty > 1 ? ` · от ${it.minQty} шт` : "");
    if (it.unit === "кг") return `${money(it.price)} ₽ за кг` + (it.minQty ? ` · от ${it.minQty} кг` : "");
    return `${money(it.price)} ₽` + (it.unit ? ` ${it.unit}` : "");
  }

  function renderItems(kind) {
    setTitle(KIND[kind].title);
    withData(() => {
      const items = state.data[kind];
      view.replaceChildren(
        el("button", { type: "button", class: "btn btn--primary btn--big btn--block", text: KIND[kind].add,
          onclick: () => openEditor(kind, null) }),
        kind === "fillings" ? categoryPrices() : null,
        el("p", { class: "hint", text: "Нажмите на карточку, чтобы поменять цену, описание или фото." }),
        items.length
          ? el("div", { class: "items" }, items.map((it) =>
            el("button", { type: "button", class: "item" + (it.visible ? "" : " is-hidden"), onclick: () => openEditor(kind, it) }, [
              thumb(kind, it),
              el("span", { class: "item__body" }, [
                el("strong", { class: "item__name", text: it.name }),
                el("span", { class: "item__sub", text: itemSub(kind, it) }),
                it.visible ? null : el("span", { class: "badge", text: "Скрыто с сайта" }),
              ]),
              el("span", { class: "item__arrow", "aria-hidden": "true", text: "›" }),
            ])))
          : el("p", { class: "empty", text: "Пока пусто. Нажмите «Добавить»." })
      );
    });
  }

  // Быстрая смена цены сразу у всей категории
  function categoryPrices() {
    const fillings = state.data.fillings;
    const names = CATEGORIES.concat(fillings.map((f) => f.category).filter((c) => !CATEGORIES.includes(c)))
      .filter((c, i, arr) => arr.indexOf(c) === i && fillings.some((f) => f.category === c));
    if (!names.length) return null;

    const rows = names.map((cat) => {
      const list = fillings.filter((f) => f.category === cat);
      const prices = [...new Set(list.map((f) => f.price))];
      const input = el("input", { class: "input input--price", inputmode: "numeric", placeholder: String(prices[0] || ""),
        "aria-label": `Новая цена за кг, категория ${cat}` });
      const msg = el("p", { class: "form-msg", "aria-live": "polite" });
      const btn = el("button", { type: "button", class: "btn btn--primary", text: "Применить" });
      btn.addEventListener("click", async () => {
        const price = parseNum(input.value);
        if (!(price > 0)) {
          msg.textContent = MSG.price_required;
          msg.className = "form-msg is-error";
          input.focus();
          return;
        }
        if (!(await ask(`Поставить ${money(price)} ₽ за кг всем начинкам «${cat}» (${list.length} шт.)?`, "Да, поставить"))) return;
        const ok = await runSave(btn, msg, async () => {
          await api("setCategoryPrice", { category: cat, price });
          fillings.forEach((f) => { if (f.category === cat) f.price = price; });
        });
        if (ok) {
          toast("Сохранено ✓");
          setTimeout(() => renderItems("fillings"), 1200);
        }
      });
      return el("div", { class: "catprice" }, [
        el("div", { class: "catprice__name" }, [
          el("strong", { text: cat }),
          el("span", { text: prices.length === 1 ? `сейчас ${money(prices[0])} ₽` : `сейчас разные цены` }),
        ]),
        el("div", { class: "catprice__row" }, [input, btn]),
        msg,
      ]);
    });

    return el("details", { class: "panel catprices" }, [
      el("summary", { text: "Поменять цену сразу всей категории" }),
      el("p", { class: "field__hint", text: "Новая цена за 1 кг встанет всем начинкам этой категории." }),
      ...rows,
    ]);
  }

  /* ---------- Окно редактирования ---------- */

  function openEditor(kind, item) {
    const isF = kind === "fillings";
    const isNew = !item;
    let photoData = null;
    let dirty = false;
    const markDirty = () => (dirty = true);

    // Фото
    const photoBox = thumb(kind, item, "thumb thumb--big" + (isF ? " thumb--round" : ""));
    const fileInput = el("input", { type: "file", accept: "image/*", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
    const photoBtn = el("button", { type: "button", class: "btn btn--ghost",
      text: item && (item.photo || photoBox.classList.contains("has-photo")) ? "Заменить фото" : "Выбрать фото",
      onclick: () => fileInput.click() });
    const photoMsg = el("p", { class: "form-msg", "aria-live": "polite" });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      photoMsg.className = "form-msg";
      photoMsg.textContent = "Готовлю фото…";
      try {
        photoData = await compressImage(file);
        photoBox.querySelectorAll("img").forEach((i) => i.remove());
        const img = new Image();
        img.alt = "";
        img.src = photoData;
        photoBox.append(img);
        photoBox.classList.add("has-photo");
        photoBtn.textContent = "Заменить фото";
        photoMsg.textContent = "Фото выбрано. Не забудьте нажать «Сохранить».";
        markDirty();
      } catch (e) {
        photoMsg.textContent = MSG.photo_open;
        photoMsg.className = "form-msg is-error";
      }
    });

    // Поля
    const nameInput = el("input", { class: "input", value: item ? item.name : "", maxlength: "80", autocapitalize: "sentences", oninput: markDirty });
    const priceInput = el("input", { class: "input", inputmode: "numeric", maxlength: "9",
      value: item && item.price ? String(item.price) : "", oninput: markDirty });
    const descInput = el("textarea", { class: "input", rows: "3", maxlength: "300", oninput: markDirty });
    descInput.value = item ? item.desc : "";

    let category = item ? item.category : "Стандарт";
    const catOptions = isF
      ? CATEGORIES.concat(state.data.fillings.map((f) => f.category)).filter((c, i, a) => c && a.indexOf(c) === i)
      : [];
    const catGroup = el("div", { class: "segmented", role: "group", "aria-labelledby": "cat-label" },
      catOptions.map((c) => el("button", { type: "button", class: "segmented__btn", "aria-pressed": String(c === category), text: c,
        onclick: (e) => {
          category = c;
          catGroup.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
          markDirty();
        } })));

    // Десерт: за что цена, минимальный заказ, начинки на выбор
    let unit = item ? item.unit || "" : "шт";
    if (!isF && !UNITS.some((u) => u.value === unit)) UNITS.push({ value: unit, label: unit });
    const unitGroup = el("div", { class: "segmented", role: "group", "aria-labelledby": "unit-label" },
      (isF ? [] : UNITS).map((u) => el("button", { type: "button", class: "segmented__btn", "aria-pressed": String(u.value === unit), text: u.label,
        onclick: (e) => {
          unit = u.value;
          unitGroup.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
          minField.hidden = !(unit === "шт" || unit === "кг");
          markDirty();
        } })));
    const minInput = el("input", { class: "input input--price", inputmode: "numeric", maxlength: "4",
      value: item && item.minQty ? String(item.minQty) : "", oninput: markDirty });
    const optionsInput = el("textarea", { class: "input", rows: "4", maxlength: "1500", oninput: markDirty });
    optionsInput.value = item && item.options ? item.options.join("\n") : "";
    const unitField = el("div", { class: "field" }, [
      el("span", { class: "field__label", id: "unit-label", text: "Цена указана" }),
      unitGroup,
      el("p", { class: "field__hint", text: "«За штуку» — клиент выберет количество, «за кг» — вес." }),
    ]);
    const minField = field("Минимальный заказ", minInput, "Сколько штук (или кг) минимум. Например 4. Можно оставить пустым.", "f-min");
    minField.hidden = !(unit === "шт" || unit === "кг");
    const optionsField = field("Начинки на выбор", optionsInput,
      "Каждая начинка с новой строки. Клиент выберет одну из списка при заказе.", "f-options");

    const nameField = field("Название", nameInput, isF ? "Как начинка будет называться на сайте." : "Как десерт будет называться на сайте.", "f-name");
    const priceField = field(isF ? "Цена за 1 кг, ₽" : "Цена, ₽", priceInput,
      isF ? "Только цифры, например 2500." : "Оставьте пустым — на сайте будет кнопка «Узнать цену».", "f-price");
    const descField = field(isF ? "Состав" : "Описание", descInput,
      isF ? "Одной строкой: из чего начинка. Например: шоколадный бисквит, карамель, арахис."
        : "Коротко: что это, вес или размер. Например: маленький торт, около 500 г.", "f-desc");

    const saveBtn = el("button", { type: "button", class: "btn btn--primary btn--big btn--block", text: isNew ? "Добавить на сайт" : "Сохранить" });
    const saveMsg = el("p", { class: "form-msg", role: "alert" });

    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const price = parseNum(priceInput.value);
      setFieldError(nameField, name ? "" : MSG.name_required);
      const priceBad = isF ? !(price > 0) : price !== null && !(price > 0);
      setFieldError(priceField, priceBad ? (isF ? MSG.price_required : "Напишите цену цифрами или оставьте поле пустым.") : "");
      const minQty = isF || minField.hidden ? null : parseNum(minInput.value);
      const minBad = minQty !== null && !(minQty >= 1 && minQty <= 1000 && Number.isInteger(minQty));
      if (!isF) setFieldError(minField, minBad ? "Напишите целое число, например 4, или оставьте поле пустым." : "");
      if (!name || priceBad || minBad) {
        (!name ? nameInput : priceBad ? priceInput : minInput).focus();
        return;
      }
      const payload = {
        kind,
        item: { id: item ? item.id : "", name, price: price || "", desc: descInput.value.trim(), category: isF ? category : undefined,
          unit: isF ? undefined : unit, minQty: isF ? undefined : (minQty || ""),
          options: isF ? undefined : optionsInput.value.split("\n").map((s) => s.trim()).filter(Boolean) },
        photo: photoData || undefined,
      };
      const ok = await runSave(saveBtn, saveMsg, async () => {
        const res = await api("saveItem", payload, photoData ? 90000 : 30000);
        const list = state.data[kind];
        const i = list.findIndex((x) => x.id === res.item.id);
        if (i >= 0) list[i] = res.item;
        else list.push(res.item);
        item = res.item;
        dirty = false;
        photoData = null;
      }, photoData ? "Загружаю фото…" : "Сохраняю…");
      if (ok) {
        setTimeout(() => {
          closeEditor(true);
          toast(isNew ? "Добавлено на сайт ✓" : "Сохранено ✓");
          renderItems(kind);
        }, 900);
      }
    });

    // Скрыть / вернуть / удалить
    const manage = el("div", { class: "manage" });
    function renderManage() {
      if (isNew) return;
      const msg = el("p", { class: "form-msg", role: "alert" });
      const toggle = el("button", { type: "button", class: "btn btn--ghost btn--block",
        text: item.visible ? "Скрыть с сайта" : "Вернуть на сайт" });
      toggle.addEventListener("click", async () => {
        const visible = !item.visible;
        const ok = await runSave(toggle, msg, async () => {
          const res = await api("setVisible", { kind, id: item.id, visible });
          const list = state.data[kind];
          list[list.findIndex((x) => x.id === item.id)] = res.item;
          item = res.item;
        });
        if (ok) {
          toast(visible ? "Снова на сайте ✓" : "Скрыто с сайта ✓");
          renderManage();
        }
      });
      const parts = [
        el("h3", { class: "manage__title", text: item.visible ? "Убрать с сайта" : "Товар скрыт с сайта" }),
        el("p", { class: "field__hint", text: item.visible
          ? "Товар пропадёт с сайта, но останется здесь — его можно будет вернуть."
          : "Покупатели его не видят. Можно вернуть на сайт или удалить совсем." }),
        toggle,
      ];
      if (!item.visible) {
        const del = el("button", { type: "button", class: "btn btn--danger-ghost btn--block", text: "Удалить навсегда" });
        del.addEventListener("click", async () => {
          if (!(await ask(`Удалить «${item.name}» навсегда? Вернуть будет нельзя.`, "Да, удалить", "Отмена", true))) return;
          del.disabled = true;
          del.textContent = "Удаляю…";
          try {
            await api("deleteItem", { kind, id: item.id });
            state.data[kind] = state.data[kind].filter((x) => x.id !== item.id);
            closeEditor(true);
            toast("Удалено");
            renderItems(kind);
          } catch (e) {
            del.disabled = false;
            del.textContent = "Удалить навсегда";
            msg.textContent = errorText(e);
            msg.className = "form-msg is-error";
          }
        });
        parts.push(del);
      }
      parts.push(msg);
      manage.replaceChildren(...parts);
    }
    renderManage();

    async function tryClose() {
      if (dirty && !(await ask("Закрыть без сохранения? Изменения пропадут.", "Закрыть", "Остаться"))) return;
      closeEditor(true);
    }

    editor.replaceChildren(
      el("div", { class: "editor__head" }, [
        el("h2", { class: "editor__title", id: "editor-title", text: isNew ? KIND[kind].newTitle : item.name }),
        el("button", { type: "button", class: "editor__close", "aria-label": "Закрыть", text: "×", onclick: tryClose }),
      ]),
      el("div", { class: "editor__body" }, [
        el("div", { class: "photo-edit" }, [
          photoBox,
          el("div", { class: "photo-edit__side" }, [
            photoBtn,
            el("p", { class: "field__hint", text: isF
              ? "Фото разреза. На сайте оно показывается в круге, поэтому лучше квадратное."
              : "Фото десерта, лучше квадратное и при дневном свете." }),
          ]),
          fileInput,
        ]),
        photoMsg,
        nameField,
        isF ? el("div", { class: "field" }, [
          el("span", { class: "field__label", id: "cat-label", text: "Категория" }),
          catGroup,
          el("p", { class: "field__hint", text: "В какой группе начинка стоит на сайте." }),
        ]) : null,
        priceField,
        isF ? null : unitField,
        isF ? null : minField,
        descField,
        isF ? null : optionsField,
        manage,
      ]),
      el("div", { class: "editor__foot" }, [saveBtn, saveMsg])
    );
    editor.oncancel = (e) => { e.preventDefault(); tryClose(); };
    editor.showModal();
    editor.scrollTop = 0;
    if (isNew && !("ontouchstart" in window)) nameInput.focus();
  }

  function closeEditor() {
    if (editor.open) editor.close();
    document.body.append(toastEl);
  }

  /* ================= Отзывы ================= */

  const REVIEW_NAME = "Покупательница";
  const fillingName = (id) => {
    const f = id && state.data.fillings.find((x) => x.id === id);
    return f ? f.name : id || "";
  };

  function renderReviews() {
    setTitle("Отзывы");
    withData(() => {
      const items = state.data.reviews || [];
      view.replaceChildren(
        el("button", { type: "button", class: "btn btn--primary btn--big btn--block", text: "+ Добавить отзыв",
          onclick: () => openReviewEditor(null) }),
        el("p", { class: "hint", text: "Нажмите на отзыв, чтобы поправить текст, имя или начинку. На сайте они идут в том же порядке." }),
        items.length
          ? el("div", { class: "items" }, items.map((it) =>
            el("button", { type: "button", class: "item" + (it.visible ? "" : " is-hidden"), onclick: () => openReviewEditor(it) }, [
              el("div", { class: "thumb" }, [el("span", { class: "thumb__letter", text: "💬" })]),
              el("span", { class: "item__body" }, [
                el("strong", { class: "item__name", text: it.name }),
                el("span", { class: "item__sub", text: it.text.length > 70 ? it.text.slice(0, 68).trim() + "…" : it.text }),
                it.filling ? el("span", { class: "item__sub", text: "Начинка: " + fillingName(it.filling) }) : null,
                it.visible ? null : el("span", { class: "badge", text: "Скрыто с сайта" }),
              ]),
              el("span", { class: "item__arrow", "aria-hidden": "true", text: "›" }),
            ])))
          : el("p", { class: "empty", text: "Пока пусто. Нажмите «Добавить отзыв»." })
      );
    });
  }

  function openReviewEditor(item) {
    const isNew = !item;
    let dirty = false;
    const markDirty = () => (dirty = true);
    if (!state.data.reviews) state.data.reviews = [];

    const nameInput = el("input", { class: "input", value: item ? item.name : "", maxlength: "40", autocapitalize: "words",
      placeholder: REVIEW_NAME, oninput: markDirty });
    const textInput = el("textarea", { class: "input", rows: "6", maxlength: "1000", oninput: markDirty });
    textInput.value = item ? item.text : "";
    const fillingSelect = el("select", { class: "input", onchange: markDirty }, [
      el("option", { value: "", text: "Не указана" }),
      ...state.data.fillings.map((f) => el("option", { value: f.id, text: f.name + (f.visible ? "" : " (скрыта)") })),
    ]);
    if (item && item.filling && !state.data.fillings.some((f) => f.id === item.filling)) {
      fillingSelect.append(el("option", { value: item.filling, text: item.filling + " (нет на сайте)" }));
    }
    fillingSelect.value = item ? item.filling || "" : "";

    const nameField = field("Имя", nameInput, `Например: Ирина. Оставите пустым — будет «${REVIEW_NAME}».`, "r-name");
    const textField = field("Текст отзыва", textInput, "Как написал клиент, без изменений.", "r-text");
    const fillingField = field("Начинка", fillingSelect,
      "Если в отзыве хвалят начинку — выберите её: под отзывом будет кнопка, которая покажет эту начинку на сайте.", "r-filling");

    const saveBtn = el("button", { type: "button", class: "btn btn--primary btn--big btn--block", text: isNew ? "Добавить на сайт" : "Сохранить" });
    const saveMsg = el("p", { class: "form-msg", role: "alert" });
    saveBtn.addEventListener("click", async () => {
      const text = textInput.value.trim();
      setFieldError(textField, text ? "" : MSG.text_required);
      if (!text) { textInput.focus(); return; }
      const payload = { kind: "reviews",
        item: { id: item ? item.id : "", name: nameInput.value.trim(), text, filling: fillingSelect.value } };
      const ok = await runSave(saveBtn, saveMsg, async () => {
        const res = await api("saveItem", payload);
        const list = state.data.reviews;
        const i = list.findIndex((x) => x.id === res.item.id);
        if (i >= 0) list[i] = res.item;
        else list.push(res.item);
        item = res.item;
        dirty = false;
      });
      if (ok) {
        setTimeout(() => {
          closeEditor(true);
          toast(isNew ? "Добавлено на сайт ✓" : "Сохранено ✓");
          renderReviews();
        }, 900);
      }
    });

    // Скрыть / вернуть / удалить
    const manage = el("div", { class: "manage" });
    function renderManage() {
      if (isNew) return;
      const msg = el("p", { class: "form-msg", role: "alert" });
      const toggle = el("button", { type: "button", class: "btn btn--ghost btn--block",
        text: item.visible ? "Скрыть с сайта" : "Вернуть на сайт" });
      toggle.addEventListener("click", async () => {
        const visible = !item.visible;
        const ok = await runSave(toggle, msg, async () => {
          const res = await api("setVisible", { kind: "reviews", id: item.id, visible });
          const list = state.data.reviews;
          list[list.findIndex((x) => x.id === item.id)] = res.item;
          item = res.item;
        });
        if (ok) {
          toast(visible ? "Снова на сайте ✓" : "Скрыто с сайта ✓");
          renderManage();
        }
      });
      const parts = [
        el("h3", { class: "manage__title", text: item.visible ? "Убрать с сайта" : "Отзыв скрыт с сайта" }),
        el("p", { class: "field__hint", text: item.visible
          ? "Отзыв пропадёт с сайта, но останется здесь — его можно будет вернуть."
          : "Покупатели его не видят. Можно вернуть на сайт или удалить совсем." }),
        toggle,
      ];
      if (!item.visible) {
        const del = el("button", { type: "button", class: "btn btn--danger-ghost btn--block", text: "Удалить навсегда" });
        del.addEventListener("click", async () => {
          if (!(await ask(`Удалить отзыв «${item.name}» навсегда? Вернуть будет нельзя.`, "Да, удалить", "Отмена", true))) return;
          del.disabled = true;
          del.textContent = "Удаляю…";
          try {
            await api("deleteItem", { kind: "reviews", id: item.id });
            state.data.reviews = state.data.reviews.filter((x) => x.id !== item.id);
            closeEditor(true);
            toast("Удалено");
            renderReviews();
          } catch (e) {
            del.disabled = false;
            del.textContent = "Удалить навсегда";
            msg.textContent = errorText(e);
            msg.className = "form-msg is-error";
          }
        });
        parts.push(del);
      }
      parts.push(msg);
      manage.replaceChildren(...parts);
    }
    renderManage();

    async function tryClose() {
      if (dirty && !(await ask("Закрыть без сохранения? Изменения пропадут.", "Закрыть", "Остаться"))) return;
      closeEditor(true);
      renderReviews();  // скрыли или вернули отзыв — обновить список
    }

    editor.replaceChildren(
      el("div", { class: "editor__head" }, [
        el("h2", { class: "editor__title", id: "editor-title", text: isNew ? "Новый отзыв" : "Отзыв: " + item.name }),
        el("button", { type: "button", class: "editor__close", "aria-label": "Закрыть", text: "×", onclick: tryClose }),
      ]),
      el("div", { class: "editor__body" }, [nameField, textField, fillingField, manage]),
      el("div", { class: "editor__foot" }, [saveBtn, saveMsg])
    );
    editor.oncancel = (e) => { e.preventDefault(); tryClose(); };
    editor.showModal();
    editor.scrollTop = 0;
    if (isNew && !("ontouchstart" in window)) textInput.focus();
  }

  // Сжимаем фото в браузере до ~1200px — быстрее загружается и не забивает Диск
  function compressImage(file, max = 1200, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (file.size > 40 * 1024 * 1024) return reject(new Error("too big"));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const w0 = img.naturalWidth, h0 = img.naturalHeight;
          if (!w0 || !h0) throw new Error("empty");
          const scale = Math.min(1, max / Math.max(w0, h0));
          const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (e) {
          reject(e);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("decode"));
      };
      img.src = url;
    });
  }

  /* ================= Занятые даты ================= */

  function eachDay(from, to, fn) {
    for (let d = from, i = 0; d <= to && i < 800; d = Cal.addDays(d, 1), i++) fn(d);
  }

  function toRanges(days) {
    const sorted = [...days].sort();
    const out = [];
    sorted.forEach((d) => {
      const last = out[out.length - 1];
      if (last && Cal.addDays(last.to, 1) === d) last.to = d;
      else out.push({ from: d, to: d });
    });
    return out;
  }

  function renderDates() {
    setTitle("Занятые даты");
    withData(() => {
      const today = Cal.today();
      const days = new Set();
      state.data.busy.forEach((r) => eachDay(r.from, r.to, (d) => days.add(d)));
      let saved = [...days].sort().join(",");
      let mode = "day";
      let start = "";

      const calBox = el("div", { class: "cal-box" });
      const modeHint = el("p", { class: "field__hint mode-hint", "aria-live": "polite" });
      const list = el("div", { class: "ranges" });
      const saveBtn = el("button", { type: "button", class: "btn btn--primary btn--big btn--block", text: "Сохранить" });
      const saveMsg = el("p", { class: "form-msg", role: "alert" });
      const saveBar = el("div", { class: "savebar" }, [saveBtn, saveMsg]);

      const cal = Cal.create(calBox, {
        month: today,
        minMonth: today,
        maxMonth: Cal.addDays(today, 730),
        day: (iso) => ({
          disabled: iso < today,
          busy: days.has(iso),
          mark: iso === start,
          note: days.has(iso) ? "занято" : "свободно",
        }),
        onPick: (iso) => {
          if (mode === "day") {
            if (days.has(iso)) days.delete(iso);
            else days.add(iso);
          } else if (!start) {
            start = iso;
          } else {
            const from = start < iso ? start : iso;
            const to = start < iso ? iso : start;
            const makeBusy = !days.has(start);
            eachDay(from, to, (d) => (makeBusy ? days.add(d) : days.delete(d)));
            start = "";
          }
          update();
        },
      });

      const modeBtns = [["day", "По одному дню"], ["range", "Несколько дней подряд"]].map(([m, label]) =>
        el("button", { type: "button", class: "segmented__btn", "aria-pressed": String(m === mode), text: label,
          onclick: () => {
            mode = m;
            start = "";
            modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
            update();
          }, "data-mode": m }));

      const isDirty = () => [...days].sort().join(",") !== saved;
      dirtyCheck = isDirty;

      function update() {
        cal.render();
        modeHint.textContent = mode === "day"
          ? "Нажмите на день — он станет занятым. Нажмите ещё раз — снова свободен."
          : start
            ? `Первый день: ${Cal.human(start)}. Теперь нажмите последний день.`
            : "Нажмите первый день, потом последний — все дни между ними станут занятыми. Если первый день уже занят — станут свободными.";

        const upcoming = toRanges([...days].filter((d) => d >= today));
        list.replaceChildren(
          el("h3", { class: "ranges__title", text: upcoming.length ? "Закрыто для заказов:" : "Все дни свободны." }),
          ...upcoming.map((r) => el("div", { class: "range" }, [
            el("span", { text: Cal.humanRange(r.from, r.to) }),
            el("button", { type: "button", class: "link-btn", text: "Сделать свободным",
              onclick: () => { eachDay(r.from, r.to, (d) => days.delete(d)); update(); } }),
          ]))
        );
      }

      saveBtn.addEventListener("click", async () => {
        // сохраняем комментарии, которые разработчик мог оставить в таблице
        const ranges = toRanges(days).map((r) => {
          const old = state.data.busy.find((o) => o.comment && !(o.to < r.from || o.from > r.to));
          return Object.assign(r, { comment: old ? old.comment : "" });
        });
        const ok = await runSave(saveBtn, saveMsg, async () => {
          const res = await api("saveBusy", { ranges });
          state.data.busy = res.busy;
          saved = [...days].sort().join(",");
        });
        if (ok) toast("Сохранено ✓");
      });

      view.replaceChildren(
        el("div", { class: "segmented segmented--wide", role: "group", "aria-label": "Как отмечать" }, modeBtns),
        modeHint,
        calBox,
        el("div", { class: "legend" }, [
          el("span", { class: "legend__item" }, [el("i", { class: "legend__busy" }), "занято"]),
          el("span", { class: "legend__item" }, [el("i", { class: "legend__free" }), "свободно"]),
        ]),
        list,
        saveBar
      );
      update();
    });
  }

  /* ================= Акции и контакты ================= */

  const SETTINGS_FORM = [
    { group: "Акции" },
    { key: "promoFirstShort", label: "Подарок за первый заказ — коротко", hint: "Эта строчка видна на самом верху сайта. Если стереть текст, акция пропадёт с первого экрана сайта." },
    { key: "promoFirst", label: "Подарок за первый заказ — подробно", textarea: true, hint: "Показывается в блоке «Условия и бонусы». Если стереть текст, акция пропадёт с сайта." },
    { key: "promoFriend", label: "Акция «Приведи друга»", textarea: true, hint: "Если стереть текст, акция пропадёт с сайта." },
    { group: "Контакты" },
    { key: "telegram", label: "Telegram", hint: "Ваш ник, например @matveevam87. Сюда приходят заявки с сайта.", required: true },
    { key: "phone", label: "Телефон", type: "tel", hint: "Как показывать на сайте, например +7 (916) 501-57-28." },
    { key: "address", label: "Адрес самовывоза", hint: "Откуда забирают торты." },
    { key: "instagram", label: "Instagram", hint: "Ник, например @momdesertmarina." },
    { key: "delivery", label: "Доставка", hint: "Например: Доставка только по Электростали." },
    { group: "Заказы" },
    { key: "minWeight", label: "Минимальный вес торта, кг", number: true, hint: "Меньше этого веса на сайте выбрать нельзя. Например 2 или 1,5." },
    { key: "minDaysAhead", label: "За сколько дней принимать заказ", number: true, whole: true, hint: "0 — можно заказать на сегодня. 3 — ближайшая дата через 3 дня." },
    { key: "prepayment", label: "Предоплата, %", number: true, hint: "Только число, например 50." },
    { key: "cancelDays", label: "Отмена заказа: за сколько дней", number: true, whole: true,
      hint: "Если клиент отказывается позже чем за столько дней до выдачи, предоплата не возвращается. Например 2." },
  ];

  function renderSettings() {
    setTitle("Акции и контакты");
    withData(() => {
      const s = state.data.settings || {};
      const inputs = {};
      const fields = {};
      let saved = "";
      const snapshot = () => JSON.stringify(Object.keys(inputs).map((k) => inputs[k].value));

      const nodes = SETTINGS_FORM.map((d) => {
        if (d.group) return el("h2", { class: "group-title", text: d.group });
        const value = s[d.key] == null ? "" : d.number ? String(s[d.key]).replace(".", ",") : String(s[d.key]);
        const input = d.textarea
          ? el("textarea", { class: "input", rows: "3", maxlength: "500" })
          : el("input", { class: "input", type: d.type || "text", maxlength: "200",
            inputmode: d.number ? "decimal" : null, autocapitalize: d.key === "telegram" || d.key === "instagram" ? "none" : null });
        input.value = value;
        inputs[d.key] = input;
        fields[d.key] = field(d.label, input, d.hint, `s-${d.key}`);
        return fields[d.key];
      });

      const saveBtn = el("button", { type: "button", class: "btn btn--primary btn--big btn--block", text: "Сохранить" });
      const saveMsg = el("p", { class: "form-msg", role: "alert" });
      const saveBar = el("div", { class: "savebar" }, [saveBtn, saveMsg]);
      saved = snapshot();
      dirtyCheck = () => snapshot() !== saved;

      saveBtn.addEventListener("click", async () => {
        const values = {};
        let firstBad = null;
        SETTINGS_FORM.forEach((d) => {
          if (!d.key) return;
          const raw = inputs[d.key].value.trim();
          let err = "";
          if (d.number) {
            const n = parseNum(raw);
            if (n === null || isNaN(n)) err = "Напишите число, например " + (d.key === "minWeight" ? "2" : d.key === "prepayment" ? "50" : "0") + ".";
            else if (d.whole && !Number.isInteger(n)) err = "Напишите целое число дней, например 2.";
            values[d.key] = n;
          } else if (d.key === "telegram") {
            const nick = raw.replace(/^https?:\/\/(www\.)?t\.me\//i, "").replace(/^@/, "");
            if (!/^[A-Za-z0-9_]{3,64}$/.test(nick)) err = "Напишите ник латинскими буквами, например @matveevam87.";
            values[d.key] = "@" + nick;
          } else {
            values[d.key] = raw;
          }
          setFieldError(fields[d.key], err);
          if (err && !firstBad) firstBad = inputs[d.key];
        });
        if (firstBad) {
          firstBad.focus();
          saveMsg.textContent = "Проверьте поля, отмеченные красным.";
          saveMsg.className = "form-msg is-error";
          return;
        }
        const ok = await runSave(saveBtn, saveMsg, async () => {
          const res = await api("saveSettings", { values });
          state.data.settings = res.settings;
          if (values.telegram) inputs.telegram.value = values.telegram;
          saved = snapshot();
        });
        if (ok) toast("Сохранено ✓");
      });

      view.replaceChildren(
        el("p", { class: "hint", text: "Поменяйте нужное и нажмите «Сохранить» внизу." }),
        ...nodes,
        saveBar
      );
    });
  }

  /* ================= Запуск ================= */
  route();
})();
