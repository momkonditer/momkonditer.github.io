/**
 * MOM кондитер — сервер для сайта и админки.
 * Скрипт привязан к Google Таблице (Расширения → Apps Script) и развёрнут как веб-приложение.
 *
 *   GET  …/exec              → данные для сайта (только видимые позиции)
 *   POST …/exec {action,…}   → действия админки (нужен токен, кроме login)
 *
 * Свойства скрипта (Настройки проекта → Свойства скрипта):
 *   ADMIN_PASSWORD — пароль Марины (задаёт разработчик)
 *   SECRET         — ключ подписи входа (создаётся сам при setup)
 *   PHOTO_FOLDER_ID — папка с фото (создаётся сам при setup)
 */

const SHEETS = {
  fillings: {
    name: 'Начинки',
    cols: ['id', 'название', 'категория', 'цена за кг', 'состав', 'фото', 'показывать', 'порядок'],
    fields: { id: 'id', name: 'название', category: 'категория', price: 'цена за кг', desc: 'состав',
              photo: 'фото', visible: 'показывать', order: 'порядок' },
  },
  desserts: {
    name: 'Десерты',
    cols: ['id', 'название', 'описание', 'цена', 'фото', 'показывать', 'порядок'],
    fields: { id: 'id', name: 'название', desc: 'описание', price: 'цена',
              photo: 'фото', visible: 'показывать', order: 'порядок' },
  },
  busy: {
    name: 'Занятые даты',
    cols: ['с', 'по', 'комментарий'],
    fields: { from: 'с', to: 'по', comment: 'комментарий' },
  },
  settings: {
    name: 'Настройки',
    cols: ['ключ', 'что это', 'значение'],
    fields: { key: 'ключ', label: 'что это', value: 'значение' },
  },
};

// Ключи листа «Настройки», которые понимает сайт
const SETTING_KEYS = ['minWeight', 'prepayment', 'cancelDays', 'minDaysAhead', 'promoFirst', 'promoFirstShort', 'promoFriend',
                      'telegram', 'phone', 'address', 'instagram', 'delivery'];
const NUMBER_SETTINGS = ['minWeight', 'prepayment', 'cancelDays', 'minDaysAhead'];

// id элементов страницы — новые товары не должны получить такой же id (ссылки #id)
const RESERVED_IDS = ['top', 'fillings', 'desserts', 'how', 'terms', 'about', 'gallery', 'reviews', 'contacts',
                      'order', 'toast', 'filters', 'admin', 'item'];

const TOKEN_DAYS = 90;
const PUBLIC_CACHE_SEC = 300;
const MAX_LOGIN_FAILS = 20;
const LOGIN_LOCK_SEC = 600;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/* ================= Вход ================= */

function doGet() {
  try {
    return json_(getPublicData_());
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  try {
    if (req.action === 'login') return json_(login_(req.password));

    const action = ACTIONS[req.action];
    if (!action) return json_({ ok: false, error: 'bad_request' });
    if (!checkToken_(req.token)) return json_({ ok: false, error: 'auth' });

    if (!action.write) return json_(Object.assign({ ok: true }, action.run(req)));

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const res = action.run(req);
      CacheService.getScriptCache().remove('public');
      return json_(Object.assign({ ok: true }, res));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    if (err && err.userCode) return json_({ ok: false, error: err.userCode });
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

const ACTIONS = {
  check: { run: () => ({}) },
  adminData: { run: () => getAdminData_() },
  saveItem: { write: true, run: (r) => ({ item: saveItem_(r.kind, r.item || {}, r.photo) }) },
  setVisible: { write: true, run: (r) => ({ item: setVisible_(r.kind, r.id, !!r.visible) }) },
  deleteItem: { write: true, run: (r) => deleteItem_(r.kind, r.id) },
  setCategoryPrice: { write: true, run: (r) => setCategoryPrice_(r.category, r.price) },
  saveBusy: { write: true, run: (r) => ({ busy: saveBusy_(r.ranges) }) },
  saveSettings: { write: true, run: (r) => ({ settings: saveSettings_(r.values || {}) }) },
};

/* ================= Авторизация ================= */

function login_(password) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fails') || 0);
  if (fails >= MAX_LOGIN_FAILS) return { ok: false, error: 'too_many' };

  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) return { ok: false, error: 'no_password' };

  if (String(password || '').trim() !== String(real).trim()) {
    cache.put('login_fails', String(fails + 1), LOGIN_LOCK_SEC);
    Utilities.sleep(800);
    return { ok: false, error: 'wrong_password' };
  }
  const exp = Date.now() + TOKEN_DAYS * 24 * 3600 * 1000;
  return { ok: true, token: exp + '.' + sign_(String(exp)), expires: exp };
}

// Подпись зависит и от пароля: сменили пароль — все старые входы недействительны
function sign_(payload) {
  const props = PropertiesService.getScriptProperties();
  const key = getSecret_() + '|' + (props.getProperty('ADMIN_PASSWORD') || '');
  const sig = Utilities.computeHmacSha256Signature(payload, key);
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

function checkToken_(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^\d+$/.test(parts[0])) return false;
  if (Number(parts[0]) < Date.now()) return false;
  return parts[1] === sign_(parts[0]);
}

function getSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SECRET', secret);
  }
  return secret;
}

/* ================= Таблица ================= */

function sheet_(kind) {
  const name = SHEETS[kind] && SHEETS[kind].name;
  if (!name) throw userError_('bad_request');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Нет листа «' + name + '». Запустите функцию setup.');
  return sh;
}

// Читает лист в массив объектов. Колонки ищутся по заголовку.
function readTable_(kind) {
  const sh = sheet_(kind);
  const values = sh.getDataRange().getValues();
  const header = (values[0] || []).map((h) => String(h).trim().toLowerCase());
  const idx = {};
  const fields = SHEETS[kind].fields;
  Object.keys(fields).forEach((f) => (idx[f] = header.indexOf(fields[f])));
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i];
    if (raw.every((v) => v === '' || v === null)) continue;
    const row = { _row: i + 1, _raw: raw };
    Object.keys(idx).forEach((f) => (row[f] = idx[f] >= 0 ? raw[idx[f]] : ''));
    rows.push(row);
  }
  return { sh, idx, width: Math.max(header.length, 1), rows };
}

function writeRow_(table, rowNum, base, obj) {
  const arr = base ? base.slice() : new Array(table.width).fill('');
  while (arr.length < table.width) arr.push('');
  Object.keys(obj).forEach((f) => {
    if (table.idx[f] >= 0) arr[table.idx[f]] = obj[f];
  });
  if (rowNum) table.sh.getRange(rowNum, 1, 1, arr.length).setValues([arr]);
  else table.sh.appendRow(arr);
}

const text_ = (v) => String(v == null ? '' : v).trim();
const isVisible_ = (v) => v === true || text_(v) === '' || /^(да|yes|true|1|\+)$/i.test(text_(v));

function num_(v) {
  if (typeof v === 'number') return v;
  const s = text_(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function iso_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  const s = text_(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function todayIso_() {
  return Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

// Что отдать сайту в поле фото: ID файла на Диске → ссылка на картинку; ссылка или путь — как есть
function photoUrl_(v) {
  const s = text_(v);
  if (!s) return '';
  const m = /\/d\/([\w-]{20,})/.exec(s) || /[?&]id=([\w-]{20,})/.exec(s);
  if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1200';
  if (/^[\w-]{20,}$/.test(s)) return 'https://drive.google.com/thumbnail?id=' + s + '&sz=w1200';
  return s;
}

function itemOut_(kind, r) {
  const item = {
    id: text_(r.id),
    name: text_(r.name),
    desc: text_(r.desc),
    price: num_(r.price),
    photo: photoUrl_(r.photo),
  };
  if (kind === 'fillings') item.category = text_(r.category) || 'Стандарт';
  return item;
}

function sortByOrder_(rows) {
  return rows.slice().sort((a, b) => {
    const x = num_(a.order), y = num_(b.order);
    return (x == null ? 1e9 : x) - (y == null ? 1e9 : y) || a._row - b._row;
  });
}

function readSettings_() {
  const out = {};
  readTable_('settings').rows.forEach((r) => {
    const key = text_(r.key);
    if (!key) return;
    out[key] = NUMBER_SETTINGS.indexOf(key) >= 0 ? num_(r.value) : text_(r.value);
  });
  return out;
}

function readBusy_() {
  return readTable_('busy').rows
    .map((r) => {
      const from = iso_(r.from);
      const to = iso_(r.to) || from;
      return { from, to: to < from ? from : to, comment: text_(r.comment) };
    })
    .filter((r) => r.from)
    .sort((a, b) => (a.from < b.from ? -1 : 1));
}

/* ================= Данные для сайта ================= */

function getPublicData_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('public');
  if (cached) return JSON.parse(cached);

  const today = todayIso_();
  const pick = (kind) => sortByOrder_(readTable_(kind).rows)
    .filter((r) => text_(r.id) && text_(r.name) && isVisible_(r.visible))
    .map((r) => itemOut_(kind, r));

  const data = {
    ok: true,
    settings: readSettings_(),
    fillings: pick('fillings'),
    desserts: pick('desserts'),
    busy: readBusy_().filter((r) => r.to >= today).map((r) => ({ from: r.from, to: r.to })),
  };
  try { cache.put('public', JSON.stringify(data), PUBLIC_CACHE_SEC); } catch (e) { /* слишком большой — без кэша */ }
  return data;
}

/* ================= Админка ================= */

const SETTING_LABELS = {
  minWeight: 'Минимальный вес торта, кг',
  prepayment: 'Предоплата, %',
  cancelDays: 'Отмена: за сколько дней до выдачи предоплата уже не возвращается',
  minDaysAhead: 'За сколько дней принимать заказ',
  promoFirst: 'Подарок за первый заказ',
  promoFirstShort: 'Подарок коротко (первый экран)',
  promoFriend: 'Акция «Приведи друга»',
  telegram: 'Telegram',
  phone: 'Телефон',
  address: 'Адрес самовывоза',
  instagram: 'Instagram',
  delivery: 'Доставка',
};

function getAdminData_() {
  const items = (kind) => sortByOrder_(readTable_(kind).rows)
    .filter((r) => text_(r.id))
    .map((r) => Object.assign(itemOut_(kind, r), { visible: isVisible_(r.visible) }));
  return {
    fillings: items('fillings'),
    desserts: items('desserts'),
    busy: readBusy_(),
    settings: readSettings_(),
  };
}

function findRow_(table, id) {
  return table.rows.find((r) => text_(r.id) === id) || null;
}

function slug_(name) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
    л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
    ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const s = String(name).toLowerCase().split('').map((c) => (map[c] !== undefined ? map[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s || 'item';
}

function uniqueId_(name) {
  const taken = {};
  RESERVED_IDS.forEach((id) => (taken[id] = true));
  ['fillings', 'desserts'].forEach((k) => readTable_(k).rows.forEach((r) => (taken[text_(r.id)] = true)));
  const base = slug_(name);
  let id = base;
  for (let i = 2; taken[id]; i++) id = base + '-' + i;
  return id;
}

function cleanItem_(kind, item) {
  const name = text_(item.name).slice(0, 80);
  if (!name) throw userError_('name_required');
  const price = num_(item.price);
  if (kind === 'fillings' && !(price > 0)) throw userError_('price_required');
  if (price != null && (price < 0 || price > 1000000)) throw userError_('price_required');
  const out = { name, desc: text_(item.desc).slice(0, 300), price: price == null ? '' : price };
  if (kind === 'fillings') out.category = text_(item.category).slice(0, 30) || 'Стандарт';
  return out;
}

function saveItem_(kind, item, photo) {
  if (kind !== 'fillings' && kind !== 'desserts') throw userError_('bad_request');
  const values = cleanItem_(kind, item);
  const table = readTable_(kind);
  const id = text_(item.id);
  let row = id ? findRow_(table, id) : null;
  if (id && !row) throw userError_('not_found');

  const newId = row ? id : uniqueId_(values.name);
  if (photo) {
    values.photo = savePhoto_(photo, kind + '-' + newId);
    if (row) trashPhoto_(row.photo);
  }

  if (row) {
    writeRow_(table, row._row, row._raw, values);
  } else {
    const maxOrder = table.rows.reduce((m, r) => Math.max(m, num_(r.order) || 0), 0);
    writeRow_(table, null, null, Object.assign({ id: newId, visible: 'да', order: maxOrder + 1 }, values));
  }
  return adminItem_(kind, newId);
}

function adminItem_(kind, id) {
  const r = findRow_(readTable_(kind), id);
  return r ? Object.assign(itemOut_(kind, r), { visible: isVisible_(r.visible) }) : null;
}

function setVisible_(kind, id, visible) {
  const table = readTable_(kind);
  const row = findRow_(table, text_(id));
  if (!row) throw userError_('not_found');
  writeRow_(table, row._row, row._raw, { visible: visible ? 'да' : 'нет' });
  return adminItem_(kind, row.id);
}

function deleteItem_(kind, id) {
  const table = readTable_(kind);
  const row = findRow_(table, text_(id));
  if (!row) return { deleted: true };
  if (isVisible_(row.visible)) throw userError_('hide_first');
  trashPhoto_(row.photo);
  // Таблица не даёт удалить последнюю незакреплённую строку — тогда просто очищаем её
  if (table.sh.getMaxRows() <= table.sh.getFrozenRows() + 1) {
    table.sh.getRange(row._row, 1, 1, table.width).clearContent();
  } else {
    table.sh.deleteRow(row._row);
  }
  return { deleted: true };
}

function setCategoryPrice_(category, price) {
  const cat = text_(category);
  const p = num_(price);
  if (!cat) throw userError_('bad_request');
  if (!(p > 0) || p > 1000000) throw userError_('price_required');
  const table = readTable_('fillings');
  let count = 0;
  table.rows.forEach((r) => {
    if (text_(r.category) === cat) {
      writeRow_(table, r._row, r._raw, { price: p });
      count++;
    }
  });
  return { count };
}

function saveBusy_(ranges) {
  if (!Array.isArray(ranges)) throw userError_('bad_request');
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const clean = ranges
    .filter((r) => r && re.test(r.from) && re.test(r.to || r.from))
    .map((r) => ({ from: r.from, to: r.to < r.from ? r.from : r.to, comment: text_(r.comment).slice(0, 200) }))
    .sort((a, b) => (a.from < b.from ? -1 : 1))
    .slice(0, 500);

  const sh = sheet_('busy');
  const table = readTable_('busy');
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, Math.max(sh.getLastColumn(), 1)).clearContent();
  if (clean.length) {
    const toDate = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
    const rows = clean.map((r) => {
      const arr = new Array(table.width).fill('');
      arr[table.idx.from] = toDate(r.from);
      arr[table.idx.to] = toDate(r.to);
      if (table.idx.comment >= 0) arr[table.idx.comment] = r.comment;
      return arr;
    });
    sh.getRange(2, 1, rows.length, table.width).setValues(rows);
    sh.getRange(2, table.idx.from + 1, rows.length, 1).setNumberFormat('dd.mm.yyyy');
    sh.getRange(2, table.idx.to + 1, rows.length, 1).setNumberFormat('dd.mm.yyyy');
  }
  return readBusy_();
}

function saveSettings_(values) {
  const table = readTable_('settings');
  SETTING_KEYS.forEach((key) => {
    if (!(key in values)) return;
    let v = text_(values[key]).slice(0, 500);
    if (NUMBER_SETTINGS.indexOf(key) >= 0) {
      const n = num_(v);
      if (n == null || n < 0 || n > 1000) throw userError_('number_required');
      v = n;
    }
    const row = table.rows.find((r) => text_(r.key) === key);
    if (row) writeRow_(table, row._row, row._raw, { value: v });
    else writeRow_(table, null, null, { key, label: SETTING_LABELS[key] || key, value: v });
  });
  return readSettings_();
}

/* ================= Фото на Диске ================= */

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* папку удалили — создадим заново */ }
  }
  const folder = DriveApp.createFolder('Фото сайта MOM кондитер');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function savePhoto_(dataUrl, name) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw userError_('photo');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_PHOTO_BYTES) throw userError_('photo_big');
  const ext = m[1] === 'image/png' ? '.png' : m[1] === 'image/webp' ? '.webp' : '.jpg';
  const file = photoFolder_().createFile(Utilities.newBlob(bytes, m[1], name + ext));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

// Удаляем в корзину только файлы из нашей папки
function trashPhoto_(value) {
  const s = text_(value);
  if (!/^[\w-]{20,}$/.test(s)) return;
  try {
    const file = DriveApp.getFileById(s);
    const folderId = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folderId) {
        file.setTrashed(true);
        return;
      }
    }
  } catch (e) { /* файла уже нет */ }
}

/* ================= Утилиты ================= */

function userError_(code) {
  const err = new Error(code);
  err.userCode = code;
  return err;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
