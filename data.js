/*
 * Данные сайта.
 *
 * Основной источник — Google Таблица (через Apps Script, адрес в api).
 * Всё, что ниже в fallback, — запасной вариант: показывается, если Google недоступен
 * или api ещё не подключён. Формат fallback совпадает с ответом сервера.
 *
 * Фото (если в таблице поле «фото» пустое, берутся отсюда):
 *   images/fillings/<id>.jpg   — разрез начинки, квадрат
 *   images/desserts/<id>.jpg   — десерт
 *   images/gallery/01.jpg …    — работы (список файлов ниже, в gallery)
 *   images/reviews/01.jpg …    — скриншоты отзывов 9:16 (список ниже, в reviews)
 *   images/hero.jpg            — большое фото на первом экране
 *   images/marina.jpg          — фото для блока «Обо мне»
 * Пока файла нет, на его месте показывается заглушка.
 */
window.SITE = {
  // Адрес веб-приложения Apps Script (…/exec). Пусто — сайт работает только на fallback. См. SETUP.md
  api: "https://script.google.com/macros/s/AKfycbwzl_Udcgu94t50_FCEVZ8lAZ_sYS2Ylp_QNjuoxv8V8O-WAtD1uy2WiSw3CQqQGKkS/exec",

  // Порядок категорий на сайте; новые категории из таблицы встанут после этих
  categoryOrder: ["Стандарт", "Лайт", "Премиум"],

  // Цвета слоёв для заглушки начинки, пока нет фото разреза (снизу вверх)
  layers: {
    "red-velvet": ["#a3242f", "#f4ece2", "#a3242f", "#f4ece2", "#a3242f"],
    "carrot": ["#c98a4b", "#f6eedf", "#e8c547", "#c98a4b", "#f6eedf"],
    "milk-slice": ["#4a3027", "#fbf6ec", "#4a3027", "#fbf6ec", "#4a3027"],
    "strawberry-milkshake": ["#f3e3c3", "#e46a7c", "#fbeef0", "#f3e3c3", "#e46a7c"],
    "praga": ["#3b2219", "#6b4030", "#3b2219", "#6b4030", "#3b2219"],
    "snickers": ["#4a2e22", "#c58a3e", "#e9d3b0", "#4a2e22", "#c58a3e"],
    "cherry-chocolate": ["#3e231c", "#8e1f33", "#7a5143", "#3e231c", "#8e1f33"],
    "raspberry-pistachio": ["#a8b56c", "#d23c5a", "#f4ece0", "#a8b56c", "#d23c5a"],
    "mango-passionfruit": ["#f3e2bd", "#f2a531", "#fbf3e2", "#f3e2bd", "#f2a531"],
    "bounty": ["#4a2e22", "#fbfaf4", "#4a2e22", "#fbfaf4", "#4a2e22"],
    "cherry-baileys": ["#3e231c", "#9b2335", "#d9c2a5", "#3e231c", "#9b2335"],
    "bubble-gum": ["#f1dcc0", "#8fd0e8", "#f6a6c8", "#f1dcc0", "#8fd0e8"],
    "mcflurry": ["#fbf8f1", "#5a3a2c", "#fbf8f1", "#e8dccb", "#fbf8f1"],
  },
  // Для новых начинок без своих цветов
  defaultLayers: ["#e9d3b0", "#f6efe6", "#d9a0a6", "#e9d3b0", "#f6efe6"],

  // Файлы в images/gallery/. Добавили фото — допишите имя файла сюда.
  gallery: ["01.jpg", "02.jpg", "03.jpg", "04.jpg", "05.jpg", "06.jpg"],

  // Скриншоты настоящих отзывов в images/reviews/ (вертикальные 9:16).
  reviews: ["01.jpg", "02.jpg", "03.jpg", "04.jpg"],

  fallback: {
    settings: {
      minWeight: 2,           // минимальный вес торта, кг
      prepayment: 50,         // предоплата, %
      cancelDays: 2,          // при отказе позже чем за столько дней до выдачи предоплата не возвращается
      // TODO: уточнить у Марины, за сколько дней принимается заказ (0 = можно с сегодняшнего дня)
      minDaysAhead: 0,
      promoFirst: "Бесплатная доставка по Электростали или, если доставка не нужна, скидка 10% — на ваш выбор.",
      promoFirstShort: "Первый заказ: бесплатная доставка или −10%",
      promoFriend: "Друг делает заказ — вы получаете кешбэк на карту или скидку на следующий заказ.",
      telegram: "@matveevam87",
      phone: "+7 (916) 501-57-28",
      address: "Электросталь, ул. Тевосяна, 21",
      instagram: "@momdesertmarina",
      delivery: "Доставка только по Электростали",
    },

    // Начинки. price — за 1 кг. photo: пусто → images/fillings/<id>.jpg
    fillings: [
      // TODO: уточнить состав у Марины (поле desc у всех начинок ниже, кроме «Молочного ломтика» — он подтверждён)
      { id: "red-velvet", name: "Красный бархат", category: "Стандарт", price: 2500,
        desc: "Бархатные красные коржи и нежный сливочный крем", photo: "" },
      { id: "carrot", name: "Морковный (лимонный курд / карамель)", category: "Стандарт", price: 2500,
        desc: "Пряные морковные коржи, крем и на выбор лимонный курд или карамель", photo: "" },
      { id: "milk-slice", name: "Молочный ломтик", category: "Стандарт", price: 2500,
        desc: "Шоколадно-медовый бисквит и сливочно-молочное суфле", photo: "" },
      { id: "strawberry-milkshake", name: "Клубничный милкшейк", category: "Стандарт", price: 2500,
        desc: "Ванильные коржи, клубничная прослойка и сливочный крем", photo: "" },
      // TODO: уточнить, есть ли в ассортименте
      { id: "praga", name: "Прага", category: "Стандарт", price: 2500,
        desc: "Шоколадные коржи, шоколадный крем и ганаш", photo: "" },

      { id: "snickers", name: "Сникерс", category: "Лайт", price: 2900,
        desc: "Шоколадные коржи, карамель, арахис и крем", photo: "" },
      { id: "cherry-chocolate", name: "Вишня в шоколаде", category: "Лайт", price: 2900,
        desc: "Шоколадные коржи, вишнёвая прослойка и шоколадный крем", photo: "" },
      { id: "raspberry-pistachio", name: "Малина-фисташка", category: "Лайт", price: 2900,
        desc: "Фисташковые коржи, малиновая прослойка и крем", photo: "" },
      { id: "mango-passionfruit", name: "Манго-маракуйя", category: "Лайт", price: 2900,
        desc: "Ванильные коржи, тропическая прослойка манго-маракуйя и крем", photo: "" },
      { id: "bounty", name: "Баунти", category: "Лайт", price: 2900,
        desc: "Шоколадные коржи и кокосовый крем", photo: "" },

      { id: "cherry-baileys", name: "Вишня / Бейлис", category: "Премиум", price: 3100,
        desc: "Шоколадные коржи, вишня и сливочный крем с ликёром «Бейлис»", photo: "" },
      { id: "bubble-gum", name: "Bubble gum", category: "Премиум", price: 3100,
        desc: "Ванильные коржи и яркий крем со вкусом бабл-гам", photo: "" },
      { id: "mcflurry", name: "Мороженое макфлури", category: "Премиум", price: 3100,
        desc: "Нежные коржи и сливочный крем со вкусом пломбира и печеньем", photo: "" },
    ],

    // Другие десерты. price: null → кнопка «Узнать цену». photo: пусто → images/desserts/<id>.jpg
    desserts: [
      // TODO: уточнить цены у Марины
      { id: "bento", name: "Бенто-торт", price: null, photo: "",
        desc: "Порционный тортик 350–500 г. Начинки: банан / шоколад / латте или молочный ломтик" },
      { id: "bento-maxi", name: "Бенто-макси", price: null, photo: "",
        desc: "Бенто побольше — на небольшую компанию" },
      { id: "cupcakes", name: "Капкейки", price: null, photo: "",
        desc: "Наборы капкейков. Начинки: лимон-апельсин, ваниль / карамель" },
      { id: "trifles", name: "Трайфлы", price: null, photo: "",
        desc: "Десерт в стаканчике. Начинки: баунти, вишня в шоколаде, молочный ломтик" },
      { id: "mini-eskimo", name: "Мини-эскимо", price: null, photo: "",
        desc: "Чизкейк на палочке в шоколадной глазури. Начинка: банан / фундук / шоколад" },
      { id: "meringue-roll", name: "Меренговый рулет с ягодами", price: null, photo: "",
        desc: "Суфле-меренга, сливочный крем и свежие ягоды" },
      // TODO: уточнить состав и описание у Марины (4 десерта ниже)
      { id: "soviet-classics", name: "Торты советской классики", price: null, photo: "",
        desc: "Классические торты по знакомым рецептам" },
      { id: "kartoshka", name: "Пирожное «Картошка»", price: null, photo: "",
        desc: "То самое пирожное «Картошка»" },
      { id: "mochi", name: "Моти", price: null, photo: "",
        desc: "Японский десерт" },
      { id: "dubai-chocolate", name: "Дубайский шоколад", price: null, photo: "",
        desc: "Шоколад с начинкой" },
    ],

    // Занятые даты: { from: "2026-12-30", to: "2027-01-02" }
    busy: [],
  },
};
