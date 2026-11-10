const tg = window.Telegram?.WebApp;
const IN_TG = !!(tg && tg.initData);
// Демо-режим: открыть страницу с ?demo — без Telegram и без запросов к Google
const DEMO = new URLSearchParams(location.search).has("demo");

if (IN_TG) {
  tg.ready();
  tg.expand();
  if (tg.colorScheme === "dark") document.documentElement.setAttribute("data-dark", "");
} else if (matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.setAttribute("data-dark", "");
}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NUM = new Set(["num", "qty", "sum_with_vat", "vat_sum"]);
const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let photos = [];     // [{data (base64 jpeg), url}]
let current = null;  // распознанные данные

// ------------------------------------------------------------------ общее

function show(id) {
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  window.scrollTo(0, 0);
}
const alertMsg = (t) => new Promise((r) => (IN_TG ? tg.showAlert(t, r) : (alert(t), r())));
const confirmMsg = (t) => new Promise((r) => (IN_TG ? tg.showConfirm(t, r) : r(confirm(t))));
const haptic = (type) => tg?.HapticFeedback?.notificationOccurred(type);

async function api(action, payload) {
  if (DEMO) return demoApi(action, payload);
  if (!window.API_URL) throw new Error("Не указан API_URL в config.js");
  // text/plain — чтобы браузер не делал preflight-запрос (Apps Script его не поддерживает)
  const r = await fetch(window.API_URL, {
    method: "POST",
    body: JSON.stringify({ action, initData: tg?.initData || "", ...payload }),
  });
  const body = await r.json().catch(() => ({ ok: false, error: `Ошибка связи (${r.status})` }));
  if (!body.ok) {
    const e = new Error(body.error || "Ошибка");
    e.code = body.code;
    throw e;
  }
  return body;
}

$$(".btn-sheet").forEach((b) => (b.hidden = !window.SHEET_URL));
$$(".btn-sheet").forEach((b) => (b.onclick = () => (IN_TG ? tg.openLink(window.SHEET_URL) : window.open(window.SHEET_URL))));

// ------------------------------------------------------------------ фото

// Поворот по EXIF делает браузер; уменьшаем до 2400px по длинной стороне.
function compress(file, maxSide = 2400, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      const url = c.toDataURL("image/jpeg", quality);
      resolve({ data: url.split(",")[1], url });
    };
    img.onerror = () => reject(new Error("Не удалось открыть фото"));
    img.src = URL.createObjectURL(file);
  });
}

async function addFiles(files) {
  for (const f of files) {
    if (photos.length >= 6) { await alertMsg("Максимум 6 страниц"); break; }
    try { photos.push(await compress(f)); } catch (e) { await alertMsg(e.message); }
  }
  renderThumbs();
}

function renderThumbs() {
  $("#thumbs").innerHTML = "";
  photos.forEach((p, i) => {
    const d = document.createElement("div");
    d.className = "thumb";
    d.innerHTML = `<img src="${p.url}" alt=""><span class="n">стр. ${i + 1}</span><button aria-label="Удалить">✕</button>`;
    d.querySelector("button").onclick = () => { photos.splice(i, 1); renderThumbs(); };
    $("#thumbs").append(d);
  });
  $("#btn-recognize").disabled = photos.length === 0;
}

for (const id of ["#file-camera", "#file-gallery"]) {
  $(id).addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
}

$("#btn-recognize").onclick = async () => {
  show("screen-loading");
  try {
    const res = await api("recognize", { images: photos.map((p) => p.data) });
    current = { ...res.data, num: res.next_num };
    fillReview(current);
    show("screen-review");
    haptic(current.warnings?.length ? "warning" : "success");
  } catch (e) {
    show("screen-photos");
    haptic("error");
    await alertMsg(e.message);
  }
};

// ------------------------------------------------------------------ проверка

function setVal(el, v) { el.value = v == null ? "" : v; }
function getVal(el, key) {
  const v = el.value.trim();
  if (!v) return null;
  if (NUM.has(key)) { const n = parseFloat(v.replace(",", ".")); return isNaN(n) ? null : n; }
  return v;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fillReview(d) {
  $$("[data-f]").forEach((el) => setVal(el, d[el.dataset.f]));
  const w = d.warnings || [];
  $("#warnings").innerHTML = w.length
    ? `<b>⚠️ Проверьте внимательно:</b><ul>${w.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : "";
  $("#items").innerHTML = "";
  (d.items?.length ? d.items : [{}]).forEach(addItemCard);
  refresh();
}

function addItemCard(it = {}) {
  const node = $("#item-tpl").content.firstElementChild.cloneNode(true);
  $$("[data-i]", node).forEach((el) => setVal(el, it[el.dataset.i]));
  node.querySelector(".item-del").onclick = async () => {
    if (await confirmMsg("Удалить строку?")) { node.remove(); refresh(); }
  };
  $("#items").append(node);
}

$("#btn-add-item").onclick = () => { addItemCard(); refresh(); };
$("#screen-review").addEventListener("input", refresh);

function readItems() {
  return $$("#items .item").map((node) => {
    const it = {};
    $$("[data-i]", node).forEach((el) => (it[el.dataset.i] = getVal(el, el.dataset.i)));
    return it;
  });
}

function readData() {
  const d = {};
  $$("[data-f]").forEach((el) => (d[el.dataset.f] = getVal(el, el.dataset.f)));
  d.items = readItems().filter((it) => it.name || it.qty != null || it.sum_with_vat != null);
  return d;
}

const close = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.001);

function refresh() {
  const items = readItems();
  $$("#items .item .item-no").forEach((el, i) => (el.textContent = `Строка ${i + 1}`));
  $("#items-count").textContent = `(${items.length})`;
  const sum = items.reduce((s, it) => s + (it.sum_with_vat || 0), 0);
  const vat = items.reduce((s, it) => s + (it.vat_sum || 0), 0);
  $("#t-sum").textContent = fmt(sum);
  $("#t-vat").textContent = fmt(vat);
  const chk = [];
  if (current?.total_sum_with_vat != null) {
    chk.push(close(sum, current.total_sum_with_vat)
      ? `<span class="good">✓ сумма совпадает с «Итого» в накладной</span>`
      : `<span class="bad">✗ в накладной «Итого» ${fmt(current.total_sum_with_vat)}</span>`);
  }
  if (current?.total_vat != null) {
    chk.push(close(vat, current.total_vat)
      ? `<span class="good">✓ НДС совпадает с «Итого»</span>`
      : `<span class="bad">✗ в накладной НДС ${fmt(current.total_vat)}</span>`);
  }
  $("#t-check").innerHTML = chk.join("<br>");
  const bin = $('[data-f="bin"]');
  bin.classList.toggle("bad", !!bin.value && !/^\d{12}$/.test(bin.value.trim()));
}

async function save(force = false) {
  const btn = $("#btn-save");
  btn.disabled = true;
  try {
    const res = await api("save", { data: readData(), force });
    haptic("success");
    $("#done-text").textContent = `Записано в таблицу: ${res.rows} стр., начиная со строки ${res.row}`;
    show("screen-done");
  } catch (e) {
    if (e.code === 409) {
      if (await confirmMsg(e.message + "\n\nВсё равно записать?")) return save(true);
    } else { haptic("error"); await alertMsg(e.message); }
  } finally { btn.disabled = false; }
}

$("#btn-save").onclick = async () => {
  const d = readData();
  if (!d.items.length) return alertMsg("Нет ни одной позиции");
  if (!d.date || !d.supplier || !d.bin) {
    if (!(await confirmMsg("Не заполнены дата, поставщик или БИН. Всё равно записать?"))) return;
  }
  save();
};
$("#btn-back").onclick = async () => { if (await confirmMsg("Данные не записаны. Вернуться к фото?")) show("screen-photos"); };
$("#btn-next").onclick = () => { photos = []; current = null; renderThumbs(); show("screen-photos"); };

// ------------------------------------------------------------------ демо

async function demoApi(action) {
  await new Promise((r) => setTimeout(r, 600));
  if (action === "recognize") {
    return { ok: true, next_num: 101, data: {
      date: "2026-10-27", supplier: "ИП ColorEast", bin: "940119300082",
      items: [
        { name: "ПУ изолирующий грунт 25 кг / ID4330KXW", qty: 25, sum_with_vat: 65250, vat_sum: 9000 },
        { name: "Отвердитель для пу грунтов 10 кг/ IGH822", qty: 10, sum_with_vat: 35100, vat_sum: 4841.38 },
        { name: "Растворитель средний 15 кг/ IS-11GF", qty: 15, sum_with_vat: 32400, vat_sum: 4468.97 },
      ],
      total_sum_with_vat: 132750, total_vat: 18310.35, warnings: [],
    } };
  }
  return { ok: true, row: 9, rows: 3 };
}

renderThumbs();
