/*
 * Маленький календарь на месяц. Общий для сайта (выбор даты в заказе) и админки (занятые даты).
 *
 *   const cal = MiniCalendar.create(container, {
 *     month: "2026-11-01",                 // какой месяц показать
 *     minMonth, maxMonth,                  // границы листания ("yyyy-mm-dd", необязательно)
 *     day: (iso) => ({ disabled, busy, selected, mark, note }),  // состояние дня
 *     onPick: (iso) => {},                 // нажали на день
 *   });
 *   cal.render();  cal.show("2026-12-01");
 */
window.MiniCalendar = (function () {
  "use strict";

  const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const today = () => iso(new Date());
  const monthStart = (s) => s.slice(0, 8) + "01";

  // «15 ноября», с годом — если год не текущий
  function human(s, forceYear) {
    const d = parse(s);
    const y = d.getFullYear() !== new Date().getFullYear() || forceYear ? ` ${d.getFullYear()}` : "";
    return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${y}`;
  }

  // «15–17 ноября», «30 декабря – 2 января»
  function humanRange(from, to) {
    if (from === to) return human(from);
    const a = parse(from), b = parse(to);
    if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
      return `${a.getDate()}–${human(to)}`;
    }
    return `${human(from)} – ${human(to)}`;
  }

  function create(root, opts) {
    let month = monthStart(opts.month || today());

    function shift(n) {
      const d = parse(month);
      d.setMonth(d.getMonth() + n);
      month = iso(d);
      render();
    }

    function render() {
      const first = parse(month);
      const y = first.getFullYear(), m = first.getMonth();
      const canPrev = !opts.minMonth || month > monthStart(opts.minMonth);
      const canNext = !opts.maxMonth || month < monthStart(opts.maxMonth);

      const head = document.createElement("div");
      head.className = "cal__head";
      const prev = navBtn("‹", "Предыдущий месяц", !canPrev, () => shift(-1));
      const next = navBtn("›", "Следующий месяц", !canNext, () => shift(1));
      const title = document.createElement("div");
      title.className = "cal__title";
      title.textContent = `${MONTHS[m]} ${y}`;
      title.setAttribute("aria-live", "polite");
      head.append(prev, title, next);

      const grid = document.createElement("div");
      grid.className = "cal__grid";
      grid.setAttribute("role", "grid");
      WEEKDAYS.forEach((w, i) => {
        const c = document.createElement("div");
        c.className = "cal__wd" + (i > 4 ? " is-weekend" : "");
        c.textContent = w;
        grid.append(c);
      });

      const offset = (first.getDay() + 6) % 7; // понедельник — первый
      for (let i = 0; i < offset; i++) grid.append(document.createElement("span"));

      const days = new Date(y, m + 1, 0).getDate();
      const t = today();
      for (let d = 1; d <= days; d++) {
        const s = `${y}-${pad(m + 1)}-${pad(d)}`;
        const st = (opts.day && opts.day(s)) || {};
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cal__day";
        b.textContent = d;
        b.dataset.date = s;
        if (s === t) b.classList.add("is-today");
        if (st.busy) b.classList.add("is-busy");
        if (st.selected) b.classList.add("is-selected");
        if (st.mark) b.classList.add("is-mark");
        if (st.disabled) b.disabled = true;
        b.setAttribute("aria-pressed", String(!!(st.selected || st.busy)));
        b.setAttribute("aria-label", human(s) + (st.note ? `, ${st.note}` : ""));
        b.addEventListener("click", () => opts.onPick && opts.onPick(s));
        grid.append(b);
      }
      root.classList.add("cal");
      root.replaceChildren(head, grid);
    }

    function navBtn(text, label, disabled, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cal__nav";
      b.textContent = text;
      b.setAttribute("aria-label", label);
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      return b;
    }

    return {
      render,
      show(s) { month = monthStart(s); render(); },
      get month() { return month; },
    };
  }

  return { create, iso, parse, addDays, today, human, humanRange, MONTHS_GEN };
})();
