/**
 * Первичная настройка. Запускается разработчиком ОДИН раз из редактора Apps Script:
 * выберите функцию setup → «Выполнить».
 *
 * Что делает:
 *  - создаёт листы «Начинки», «Десерты», «Занятые даты», «Настройки» с заголовками;
 *  - заполняет их текущими данными сайта (только пустые листы — повторный запуск ничего не затрёт);
 *  - ставит часовой пояс Москвы, выпадающие списки «да/нет» и категорий;
 *  - создаёт папку для фото на Диске и секретный ключ для входа.
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('Europe/Moscow');

  ensureSheet_(ss, 'fillings', SEED_FILLINGS.map((f, i) =>
    [f[0], f[1], f[2], f[3], f[4], '', 'да', i + 1]));
  ensureSheet_(ss, 'desserts', SEED_DESSERTS.map((d, i) =>
    [d[0], d[1], d[2], '', '', 'да', i + 1]));
  ensureSheet_(ss, 'busy', []);
  ensureSheet_(ss, 'settings', SEED_SETTINGS.map((s) => [s[0], SETTING_LABELS[s[0]], s[1]]));

  // Выпадающие списки
  const yesNo = SpreadsheetApp.newDataValidation().requireValueInList(['да', 'нет'], true).build();
  const cats = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Стандарт', 'Лайт', 'Премиум'], true).setAllowInvalid(true).build();
  ss.getSheetByName('Начинки').getRange('G2:G').setDataValidation(yesNo);
  ss.getSheetByName('Начинки').getRange('C2:C').setDataValidation(cats);
  ss.getSheetByName('Десерты').getRange('F2:F').setDataValidation(yesNo);
  ss.getSheetByName('Занятые даты').getRange('A2:B').setNumberFormat('dd.mm.yyyy');

  // Убираем пустой лист по умолчанию
  ['Лист1', 'Sheet1'].forEach((name) => {
    const sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  getSecret_();
  const folder = photoFolder_();
  CacheService.getScriptCache().remove('public');

  const hasPassword = !!PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  console.log('Готово. Папка для фото: ' + folder.getUrl());
  console.log(hasPassword
    ? 'Пароль админки задан.'
    : 'ВНИМАНИЕ: пароль ещё не задан. Настройки проекта → Свойства скрипта → ADMIN_PASSWORD.');
}

/** Проверка: показывает в журнале, что увидит сайт. */
function testPublicData() {
  CacheService.getScriptCache().remove('public');
  console.log(JSON.stringify(getPublicData_(), null, 2));
}

function ensureSheet_(ss, kind, rows) {
  const def = SHEETS[kind];
  let sh = ss.getSheetByName(def.name);
  if (!sh) sh = ss.insertSheet(def.name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols]).setFontWeight('bold').setBackground('#f6e4e2');
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() <= 1 && rows.length) {
    sh.getRange(2, 1, rows.length, def.cols.length).setValues(rows);
  }
  sh.autoResizeColumns(1, def.cols.length);
}

// Стартовые данные — те же, что в data.js на момент запуска.
// [id, название, категория, цена за кг, состав]
const SEED_FILLINGS = [
  ['red-velvet', 'Красный бархат', 'Стандарт', 2500, 'Бархатные красные коржи и нежный сливочный крем'],
  ['carrot', 'Морковный (лимонный курд / карамель)', 'Стандарт', 2500, 'Пряные морковные коржи, крем и на выбор лимонный курд или карамель'],
  ['milk-slice', 'Молочный ломтик', 'Стандарт', 2500, 'Шоколадно-медовый бисквит и сливочно-молочное суфле'],
  ['strawberry-milkshake', 'Клубничный милкшейк', 'Стандарт', 2500, 'Ванильные коржи, клубничная прослойка и сливочный крем'],
  // TODO: уточнить, есть ли «Прага» в ассортименте (если нет — Марина скроет её в админке)
  ['praga', 'Прага', 'Стандарт', 2500, 'Шоколадные коржи, шоколадный крем и ганаш'],
  ['snickers', 'Сникерс', 'Лайт', 2900, 'Шоколадные коржи, карамель, арахис и крем'],
  ['cherry-chocolate', 'Вишня в шоколаде', 'Лайт', 2900, 'Шоколадные коржи, вишнёвая прослойка и шоколадный крем'],
  ['raspberry-pistachio', 'Малина-фисташка', 'Лайт', 2900, 'Фисташковые коржи, малиновая прослойка и крем'],
  ['mango-passionfruit', 'Манго-маракуйя', 'Лайт', 2900, 'Ванильные коржи, тропическая прослойка манго-маракуйя и крем'],
  ['bounty', 'Баунти', 'Лайт', 2900, 'Шоколадные коржи и кокосовый крем'],
  ['cherry-baileys', 'Вишня / Бейлис', 'Премиум', 3100, 'Шоколадные коржи, вишня и сливочный крем с ликёром «Бейлис»'],
  ['bubble-gum', 'Bubble gum', 'Премиум', 3100, 'Ванильные коржи и яркий крем со вкусом бабл-гам'],
  ['mcflurry', 'Мороженое макфлури', 'Премиум', 3100, 'Нежные коржи и сливочный крем со вкусом пломбира и печеньем'],
];

// [id, название, описание]; цена пустая → «Узнать цену»
const SEED_DESSERTS = [
  ['bento', 'Бенто-торт', 'Порционный тортик 350–500 г. Начинки: банан / шоколад / латте или молочный ломтик'],
  ['bento-maxi', 'Бенто-макси', 'Бенто побольше — на небольшую компанию'],
  ['cupcakes', 'Капкейки', 'Наборы капкейков. Начинки: лимон-апельсин, ваниль / карамель'],
  ['trifles', 'Трайфлы', 'Десерт в стаканчике. Начинки: баунти, вишня в шоколаде, молочный ломтик'],
  ['mini-eskimo', 'Мини-эскимо', 'Чизкейк на палочке в шоколадной глазури. Начинка: банан / фундук / шоколад'],
  ['meringue-roll', 'Меренговый рулет с ягодами', 'Суфле-меренга, сливочный крем и свежие ягоды'],
  ['soviet-classics', 'Торты советской классики', 'Классические торты по знакомым рецептам'],
  ['kartoshka', 'Пирожное «Картошка»', 'То самое пирожное «Картошка»'],
  ['mochi', 'Моти', 'Японский десерт'],
  ['dubai-chocolate', 'Дубайский шоколад', 'Шоколад с начинкой'],
];

const SEED_SETTINGS = [
  ['minWeight', 2],
  ['prepayment', 50],
  ['cancelDays', 2],
  ['minDaysAhead', 0],
  ['promoFirst', 'Бесплатная доставка по Электростали или, если доставка не нужна, скидка 10% — на ваш выбор.'],
  ['promoFirstShort', 'Первый заказ: бесплатная доставка или −10%'],
  ['promoFriend', 'Друг делает заказ — вы получаете кешбэк на карту или скидку на следующий заказ.'],
  ['telegram', '@matveevam87'],
  ['phone', '+7 (916) 501-57-28'],
  ['address', 'Электросталь, ул. Тевосяна, 21'],
  ['instagram', '@momdesertmarina'],
  ['delivery', 'Доставка только по Электростали'],
];
