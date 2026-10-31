window.BV = window.BV || {};
var BV = window.BV;

const $ = (id) => document.getElementById(id);
const els = {
  truth: $("truth"),
  model: $("model"),
  hypers: $("hyper-fields"),
  n: $("n"),
  sigma: $("sigma"),
  trials: $("trials"),
  seed: $("seed"),
  noise: $("noise"),
  fit: $("fit-chart"),
  u: $("u-chart"),
  learn: $("learn-chart"),
  caption: $("chart-caption"),
  presets: $("preset-row"),
};

const S = {
  config: null,
  pack: null,
  where: null,
  swept: null,
  learn: null,
  sugg: null,
  hoverX: null,
  hoverU: null,
  hoverL: null,
  geom: {},
  anim: { idx: -1, prev: -1, t0: 0, playing: false, moving: false, raf: 0 },
  token: 0,
};

const f = (x) => BV.format(x);

// Шкала оси y у кривых: по умолчанию обычная, как в учебниках.
const YLOG = { u: false, learn: false };
const yLabelFor = (log) => (log ? "ошибка, MSE (лог. шкала)" : "ошибка, MSE");

// ---------- параметры ----------

function readHypers(kind) {
  const hyper = {};
  for (const field of BV.MODEL_META[kind].fields) {
    const input = $("hp-" + field.id);
    hyper[field.id] = input ? Number(input.value) : field.value;
  }
  return hyper;
}

function renderHypers() {
  const meta = BV.MODEL_META[els.model.value];
  els.hypers.innerHTML = "";
  for (const field of meta.fields) {
    const label = document.createElement("label");
    label.innerHTML = `${field.label}
      <input id="hp-${field.id}" type="range" min="${field.min}" max="${field.max}" step="${field.step}" value="${field.value}" />
      <span class="value" data-for="hp-${field.id}"></span>`;
    els.hypers.appendChild(label);
  }
  paintValues();
}

function paintValues() {
  document.querySelectorAll("input[type=range]").forEach((input) => {
    const tag = document.querySelector(`[data-for="${input.id}"]`);
    if (tag) tag.textContent = input.value;
  });
}

function currentConfig() {
  const model = els.model.value;
  return {
    truth: els.truth.value,
    model,
    hyper: readHypers(model),
    n: Number(els.n.value),
    sigma: Number(els.sigma.value),
    noise: els.noise.value,
    trials: Number(els.trials.value),
    seed: Number(els.seed.value) || 1,
  };
}

function applyState(state) {
  if (state.truth) els.truth.value = state.truth;
  if (state.model && state.model !== els.model.value) {
    els.model.value = state.model;
    renderHypers();
  }
  if (state.n != null) els.n.value = state.n;
  if (state.sigma != null) els.sigma.value = state.sigma;
  if (state.noise) els.noise.value = state.noise;
  if (state.trials != null) els.trials.value = state.trials;
  if (state.seed != null) els.seed.value = state.seed;
  for (const key of Object.keys(state)) {
    const hp = $("hp-" + key);
    if (hp) hp.value = String(state[key]);
  }
  paintValues();
}

// ---------- график подгонки + карта ----------

function animState() {
  const a = S.anim;
  if (a.idx < 0) return null;
  const MORPH = 420;
  const e = a.moving ? Math.min(1, (performance.now() - a.t0) / MORPH) : 1;
  const ease = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
  return { idx: a.idx, prev: a.moving ? a.prev : -1, e: a.moving ? ease : 1 };
}

function drawTop() {
  if (!S.pack) return;
  S.geom.fit = BV.drawFit(els.fit, S.pack, { anim: animState(), hover: S.hoverX });
}

function tick(now) {
  const a = S.anim;
  const STEP = 950;
  const MORPH = 420;
  if (a.moving && now - a.t0 >= MORPH) a.moving = false;
  if (a.playing && !a.moving && now - a.t0 >= STEP) {
    if (a.idx >= S.pack.fits.length - 1) {
      a.playing = false;
    } else {
      advance();
    }
  }
  drawTop();
  paintAnimReadout();
  if (a.playing || a.moving) a.raf = requestAnimationFrame(tick);
  else a.raf = 0;
  paintAnimButtons();
}

function kick() {
  if (!S.anim.raf) S.anim.raf = requestAnimationFrame(tick);
}

function advance() {
  const a = S.anim;
  a.prev = a.idx;
  a.idx = Math.min(a.idx + 1, S.pack.fits.length - 1);
  a.t0 = performance.now();
  a.moving = a.prev >= 0 && a.prev !== a.idx;
}

function animPlay() {
  const a = S.anim;
  if (a.playing) {
    a.playing = false;
    paintAnimButtons();
    return;
  }
  if (a.idx < 0 || a.idx >= S.pack.fits.length - 1) {
    a.idx = 0;
    a.prev = -1;
    a.moving = false;
    a.t0 = performance.now();
  }
  a.playing = true;
  kick();
}

function animStep() {
  const a = S.anim;
  a.playing = false;
  if (a.idx < 0) {
    a.idx = 0;
    a.prev = -1;
    a.moving = false;
    a.t0 = performance.now();
  } else if (a.idx < S.pack.fits.length - 1) {
    advance();
  }
  kick();
}

function animReset() {
  const a = S.anim;
  a.playing = false;
  a.moving = false;
  a.idx = -1;
  a.prev = -1;
  drawTop();
  paintAnimReadout();
  paintAnimButtons();
}

function paintAnimButtons() {
  const a = S.anim;
  $("anim-play").textContent = a.playing
    ? "❚❚ Пауза"
    : a.idx >= 0 && a.idx < (S.pack ? S.pack.fits.length - 1 : 0)
      ? "▶ Продолжить"
      : "▶ Показать по очереди";
  $("anim-all").disabled = a.idx < 0;
  $("anim-step").disabled = S.pack && a.idx >= S.pack.fits.length - 1;
}

function paintAnimReadout() {
  const box = $("anim-readout");
  const a = S.anim;
  const p = S.pack;
  if (!p) return;
  if (a.idx < 0) {
    const st = p.stats;
    const spread = Math.sqrt(st.variance);
    box.innerHTML = `Розовая полоса — ±1 стандартное отклонение предсказаний (корень из variance): в среднем модели расходятся на <b>±${f(spread)}</b> по y. Нажмите «Показать по очереди» — модели появятся по одной, и будет видно, как каждая новая выборка рисует свою кривую. «Следующая выборка» листает их вручную, «Показать все» возвращает этот общий вид.`;
    return;
  }
  const s = p.samples[a.idx];
  const k = a.idx + 1;
  const ratio = s.testMse / Math.max(s.trainMse, 1e-9);
  const note =
    ratio > 2
      ? "На своих точках модель почти идеальна, на новых — в разы хуже: она выучила шум этой выборки."
      : ratio < 1.25
        ? "Ошибки на своих и на новых точках близки: модель выучила форму, а не шум."
        : "На новых точках ошибка заметно выше, чем на своих.";
  box.innerHTML = `<b>Выборка ${k} из ${p.fits.length}.</b> Ошибка на её собственных точках — <b>${f(s.trainMse)}</b>, на новых — <b>${f(s.testMse)}</b>. ${note} Жёлтая кривая — среднее по ${k} ${k === 1 ? "выборке" : "выборкам"}: она стабилизируется, даже когда отдельные кривые прыгают.`;
}

function fitTip(i) {
  const p = S.pack;
  const x = p.grid[i];
  const sd = Math.sqrt(Math.max(p.pointVar[i], 0));
  return (
    `<div class="tip-h">x = ${x.toFixed(2)}</div>` +
    BV.tipRow(BV.C.truth, "истина f(x)", f(p.truth[i]), true) +
    BV.tipRow(BV.C.test, "среднее E[ŷ]", f(p.mean[i])) +
    BV.tipRow(BV.C.bias, "Bias² — синий отрезок", f(p.pointBias2[i])) +
    BV.tipRow(BV.C.variance, "Variance — розовая скобка", f(p.pointVar[i])) +
    `<div class="tip-note">модели расходятся на ±${f(sd)}</div>`
  );
}

function setHoverX(i) {
  S.hoverX = i;
  drawTop();
  const tip = $("fit-tip");
  if (i == null) BV.showTip(tip, els.fit, 0, null);
  else BV.showTip(tip, els.fit, S.geom.fit.X(i), fitTip(i));
}

function paintChips(st, regime) {
  const label = regime ? { underfit: "недообучение", overfit: "переобучение", balanced: "баланс" }[regime] : "…";
  const chip = (cls, name, v) => `<span class="chip ${cls}"><i></i>${name}<b>${f(v)}</b></span>`;
  $("fit-chips").innerHTML =
    chip("chip-bias", "Bias²", st.bias2) +
    chip("chip-var", "Variance", st.variance) +
    chip("chip-noise", "σ²", st.noise) +
    chip("chip-test", "MSE на тесте", st.testMse) +
    `<span class="chip chip-regime" data-regime="${regime}">${label}</span>`;
}

// ---------- U-кривая и кривая обучения ----------

const SERIES = [
  { key: "testMse", label: "MSE на тестовой", color: () => BV.C.test, width: 2.6, anchor: true },
  { key: "trainMse", label: "MSE на обучающей", color: () => BV.C.test, dash: [5, 4], width: 1.8 },
  { key: "bias2", label: "Bias²", color: () => BV.C.bias },
  { key: "variance", label: "Variance", color: () => BV.C.variance },
  { key: "noise", label: "σ² — пол", color: () => BV.C.noise, dash: [2, 4], width: 1.6 },
];

function seriesOf(points) {
  return SERIES.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color(),
    dash: s.dash,
    width: s.width,
    anchor: s.anchor,
    values: points.map((p) => Math.max(p[s.key], 1e-6)),
  }));
}

function legendHtml() {
  return SERIES.map((s) => {
    const c = s.color();
    const sw = s.dash
      ? `<i style="background:transparent;border-top:2px dashed ${c};height:0"></i>`
      : `<i style="background:${c}"></i>`;
    return `<li>${sw}${s.label}</li>`;
  }).join("");
}

function tipFor(point, head) {
  return (
    `<div class="tip-h">${head}</div>` +
    SERIES.map((s) => BV.tipRow(s.color(), s.label, f(point[s.key]), !!s.dash)).join("")
  );
}

function uSpec() {
  const sw = S.swept;
  const meta = BV.MODEL_META[S.config.model];
  const field = meta.fields.find((x) => x.id === meta.main);
  const x = sw.points.map((_, i) => i);
  const every = sw.points.length > 10 ? 2 : 1;
  const xTicks = sw.points
    .map((p, i) => ({ v: i, label: String(Number(p.value.toFixed(3))) }))
    .filter((t, i) => i === sw.curIdx || (i % every === 0 && Math.abs(i - sw.curIdx) > 1) || (every === 1 && i !== sw.curIdx));
  const marks = [];
  marks.push({ i: sw.curIdx, label: "вы здесь", color: "rgba(244,234,216,0.7)", row: 0 });
  if (sw.bestIdx !== sw.curIdx) {
    marks.push({ i: sw.bestIdx, label: "минимум", color: BV.rgba(BV.C.test, 0.8), dash: [4, 4], row: 1 });
  }
  const last = x.length - 1;
  const zones = [];
  if (sw.bestIdx > 0) zones.push({ from: 0, to: sw.bestIdx, color: BV.C.bias, label: "← недообучение" });
  if (sw.bestIdx < last) zones.push({ from: sw.bestIdx, to: last, color: BV.C.variance, label: "переобучение →", align: "right" });
  const dir = meta.complexityUp ? "больше" : "меньше";
  return {
    x,
    xTicks,
    series: seriesOf(sw.points),
    marks,
    zones,
    xLabel: `${field.short}: ${dir} → сложнее`,
    yLog: YLOG.u,
    yLabel: yLabelFor(YLOG.u),
  };
}

function learnSpec() {
  const lc = S.learn;
  const x = lc.points.map((p) => p.n);
  const show = new Set([10, 20, 40, 80, 160, 240, S.config.n]);
  const xTicks = lc.points.filter((p) => show.has(p.n)).map((p) => ({ v: p.n, label: String(p.n) }));
  return {
    x,
    xLog: true,
    xTicks,
    series: seriesOf(lc.points),
    marks: [{ i: lc.curIdx, label: `вы здесь · n = ${S.config.n}`, color: "rgba(244,234,216,0.7)" }],
    xLabel: "n, точек в выборке (лог. шкала)",
    yLog: YLOG.learn,
    yLabel: yLabelFor(YLOG.learn),
  };
}

function drawCurves() {
  if (S.swept) S.geom.u = BV.drawLines(els.u, uSpec(), S.hoverU);
  if (S.learn) S.geom.learn = BV.drawLines(els.learn, learnSpec(), S.hoverL);
}

function paintUReadout() {
  const sw = S.swept;
  const meta = BV.MODEL_META[S.config.model];
  const field = meta.fields.find((x) => x.id === meta.main);
  const cur = sw.points[sw.curIdx];
  const best = sw.points[sw.bestIdx];
  let rel;
  if (sw.curIdx === sw.bestIdx) {
    rel = "Вы на дне U-кривой: шаг в любую сторону только ухудшит тест.";
  } else if (sw.curIdx > sw.bestIdx) {
    rel = `Вы правее минимума — модель сложнее, чем нужно. Лишняя гибкость уходит в variance (${f(cur.variance)} против ${f(best.variance)} в минимуме).`;
  } else {
    rel = `Вы левее минимума — модель проще, чем нужно. Ошибка держится на смещении (${f(cur.bias2)} против ${f(best.bias2)} в минимуме).`;
  }
  $("u-readout").innerHTML = `Минимум теста — при <b>${field.short} = ${Number(best.value.toFixed(3))}</b> (${f(best.testMse)}), сейчас ${f(cur.testMse)}. ${rel}`;
}

function paintLearnReadout() {
  const lc = S.learn;
  const pts = lc.points;
  const cur = pts[lc.curIdx];
  const target = pts.find((p) => p.n >= cur.n * 4) || pts[pts.length - 1];
  const last = pts[pts.length - 1];
  let html;
  if (target.n === cur.n) {
    html = `Вы уже на правом краю: n = ${cur.n}. Variance здесь ${f(cur.variance)}, Bias² ${f(cur.bias2)}.`;
  } else {
    html = `Если увеличить n с ${cur.n} до ${target.n}: variance <b>${BV.ratio(target.variance, cur.variance)}</b>, Bias² <b>${BV.ratio(target.bias2, cur.bias2)}</b>, тест ${f(cur.testMse)} → ${f(target.testMse)}. `;
    const reducible = last.testMse - last.noise;
    if (last.bias2 > 0.5 * Math.max(reducible, 1e-9) && last.bias2 > 0.15 * last.noise) {
      html += `Даже при n = ${last.n} тест не опустится ниже ≈ ${f(last.testMse)}: пол задают σ² и смещение, а смещение от данных не зависит. Тут нужна более гибкая модель, а не больше точек.`;
    } else if (cur.variance > cur.bias2) {
      html += "Данные — хорошее лекарство: ошибка в основном из разброса, а он убывает примерно как 1/n.";
    } else {
      html += "Кривые теста и обучения сходятся к полу σ²: зазор между ними — это variance, и он закрывается с ростом n.";
    }
  }
  $("learn-readout").innerHTML = html;
}

function hoverCurve(which, i) {
  const tipEl = $(which === "u" ? "u-tip" : "learn-tip");
  const canvas = which === "u" ? els.u : els.learn;
  if (which === "u") S.hoverU = i;
  else S.hoverL = i;
  drawCurves();
  if (i == null) {
    BV.showTip(tipEl, canvas, 0, null);
    return;
  }
  if (which === "u") {
    const meta = BV.MODEL_META[S.config.model];
    const field = meta.fields.find((x) => x.id === meta.main);
    const p = S.swept.points[i];
    BV.showTip(tipEl, canvas, S.geom.u.X(i), tipFor(p, `${field.short} = ${Number(p.value.toFixed(3))}`));
  } else {
    const p = S.learn.points[i];
    BV.showTip(tipEl, canvas, S.geom.learn.X(i), tipFor(p, `n = ${p.n}`));
  }
}

// ---------- метрики, диагноз, подсказки ----------

function stackBar(st, maxTotal, compact) {
  const tot = st.bias2 + st.variance + st.noise;
  const w = (v) => ((100 * v) / maxTotal).toFixed(2) + "%";
  const pct = (v) => Math.round((100 * v) / tot) + "%";
  const seg = (cls, v, label) =>
    `<span class="seg ${cls}" style="width:${w(v)}" title="${label}: ${f(v)}">${!compact && v / tot > 0.18 ? `${label} ${pct(v)}` : ""}</span>`;
  return `<div class="bar">${seg("seg-noise", st.noise, "σ²")}${seg("seg-bias", st.bias2, "Bias²")}${seg("seg-var", st.variance, "Var")}</div>`;
}

// Почему MSE на тесте и ожидаемая ошибка — разные числа, и почему они должны совпасть.
function mseNote(st) {
  const pct = Math.round((100 * Math.abs(st.testMse - st.total)) / Math.max(st.total, 1e-9));
  const tail =
    pct < 1
      ? "Они практически совпадают (расхождение меньше 1%) — разложение подтверждается экспериментом."
      : pct <= 20
      ? `Они расходятся всего на ${pct}% — разложение подтверждается экспериментом.`
      : `Пока они расходятся на ${pct}% — добавьте выборок, и оценки сойдутся.`;
  return `<p class="mse-note">Ожидаемая ошибка ${f(st.total)} собрана из разложения Bias² + Variance + σ², а MSE на тестовой ${f(st.testMse)} измерена напрямую на новых точках. ${tail}</p>`;
}

function ctxFor(config) {
  return {
    kind: config.model,
    modelName: BV.MODEL_META[config.model].name,
    flex: BV.flexibilityNote(config.model, config.hyper),
    truthName: BV.FUNCTIONS[config.truth].name,
    truthKey: config.truth,
    noiseKey: config.noise,
    n: config.n,
    sigma: config.sigma,
    trials: config.trials,
    hyper: config.hyper,
    where: S.where,
    regime: S.regime,
  };
}

function paintJournal(st, config, regime) {
  const copy = BV.regimeCopy[regime];
  document.querySelector(".diagnosis").dataset.regime = regime;
  $("regime-kicker").textContent = copy.kicker;
  $("regime-title").textContent = copy.title;
  $("regime-body").textContent = copy.body;
  $("stackbar").innerHTML =
    `<div class="stack-head"><span>Из чего состоит ожидаемая ошибка ${f(st.total)}</span></div>` +
    stackBar(st, st.total, false) +
    `<div class="stack-key"><span><i class="sw" style="background:var(--c-noise)"></i>σ² ${f(st.noise)}</span><span><i class="sw" style="background:var(--c-bias)"></i>Bias² ${f(st.bias2)}</span><span><i class="sw" style="background:var(--c-var)"></i>Variance ${f(st.variance)}</span></div>` +
    `<div class="mse-line"><span>MSE на тестовой <b>${f(st.testMse)}</b></span><span>на обучающей <b>${f(st.trainMse)}</b></span><span>зазор <b>${f(st.testMse - st.trainMse)}</b></span></div>` +
    mseNote(st);
  $("verdict").innerHTML = '<span class="pending">Проверяю соседние настройки…</span>';
  const ctx = ctxFor(config);
  $("why-list").innerHTML = BV.buildWhy(st, ctx).map((t) => `<li>${t}</li>`).join("");
}

function paintSuggestions() {
  const sg = S.sugg;
  const base = sg.base;
  const grid = $("sugg-grid");
  const cards = sg.items.concat(sg.data ? [sg.data] : []);
  const maxTot = Math.max(base.total, ...cards.map((c) => c.stats.total));
  const card = (c, i) => {
    const pct = Math.round(c.gain * 100);
    const good = c.gain >= 0.03;
    const delta = good ? `−${pct}%` : c.gain <= -0.03 ? `+${-pct}%` : "≈ 0%";
    const tag = c.isData ? "не гиперпараметр, но важно знать" : i === 0 ? "лучший шаг" : "тоже помогает";
    return `<article class="sugg ${c.isData ? "sugg--data" : ""} ${i === 0 && !c.isData ? "sugg--best" : ""}">
      <p class="sugg-tag">${tag}</p>
      <h3>${c.title}</h3>
      <div class="sugg-delta ${good ? "is-good" : "is-flat"}">
        <span class="big">${delta}</span>
        <span>тест ${f(base.testMse)} → <b>${f(c.stats.testMse)}</b></span>
      </div>
      <div class="sugg-bars">
        <div class="row"><span>сейчас</span>${stackBar(base, maxTot, true)}</div>
        <div class="row"><span>после</span>${stackBar(c.stats, maxTot, true)}</div>
      </div>
      <p class="sugg-why">${c.why}${c.note ? ` <span class="muted">(${c.note})</span>` : ""}</p>
      <button type="button" class="apply" data-sugg="${c.id}">Применить и посмотреть</button>
    </article>`;
  };
  let html = sg.items.map(card).join("");
  if (!sg.items.length) {
    html += `<article class="sugg sugg--ok">
      <p class="sugg-tag">оптимум</p>
      <h3>Вы около дна U-кривой</h3>
      <p class="sugg-why">Никакое соседнее значение гиперпараметров этой модели не снижает тестовую ошибку больше чем на 3%. Оставшаяся ошибка — шум σ² = ${f(base.noise)} плюс неизбежная плата за конечную выборку.</p>
    </article>`;
  }
  if (sg.data) html += card(sg.data, 99);
  grid.innerHTML = html;

  const v = $("verdict");
  if (sg.best) {
    v.innerHTML = `<b>${sg.best.title}</b> — снизит тестовую ошибку с ${f(base.testMse)} до <b>${f(sg.best.stats.testMse)}</b> (−${Math.round(sg.best.gain * 100)}%). <a href="#sugg-grid">Подробнее ↓</a>`;
  } else {
    v.innerHTML = `Соседние настройки не дают выигрыша больше 3% — это хороший компромисс для таких данных.`;
  }
}

function applySuggestion(id) {
  const sg = S.sugg;
  const c = sg.items.concat(sg.data ? [sg.data] : []).find((x) => x.id === id);
  if (!c) return;
  applyState(c.patch);
  run();
  document.querySelector(".stage").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- конвейер ----------

function run() {
  const token = ++S.token;
  const config = currentConfig();
  S.config = config;
  S.anim.playing = false;
  S.anim.moving = false;
  S.anim.idx = -1;

  S.pack = BV.evaluate(config);
  S.where = BV.locate(S.pack, config);
  BV.lastPack = S.pack;
  drawTop();
  paintAnimReadout();
  paintAnimButtons();
  paintChips(S.pack.stats, null);
  const main = BV.MODEL_META[config.model].main;
  const field = BV.MODEL_META[config.model].fields.find((x) => x.id === main);
  els.caption.innerHTML = `Мы ${config.trials} раз взяли случайную выборку из ${config.n} точек одного и того же распределения (${BV.FUNCTIONS[config.truth].name}, шум ${BV.NOISE[config.noise].name}) и на каждой обучили модель: <b>${BV.modelPhrase(config.model, config.hyper)}</b>. Тонкие линии — эти ${config.trials} моделей, белая линия — модель, обученная на показанных точках.`;

  // Тяжёлые части — следующими кадрами, чтобы слайдеры не залипали.
  const later = (fn) =>
    setTimeout(() => {
      if (token === S.token) fn();
    }, 0);
  later(() => {
    S.swept = BV.sweep(config);
    S.sugg = BV.suggest(config, S.swept, S.pack.stats);
    S.regime = BV.finalRegime(S.swept, S.sugg);
    paintChips(S.pack.stats, S.regime);
    paintJournal(S.pack.stats, config, S.regime);
    S.hoverU = null;
    drawCurves();
    paintUReadout();
    paintSuggestions();
    later(() => {
      S.learn = BV.learningCurve(config);
      S.hoverL = null;
      drawCurves();
      paintLearnReadout();
    });
  });
}

let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, 140);
}

function applyPreset(id) {
  const p = BV.PRESETS.find((item) => item.id === id);
  if (!p) return;
  if (p.apply) {
    applyState(p.apply(currentConfig()));
    run();
    return;
  }
  els.model.value = p.state.model;
  renderHypers();
  applyState(Object.assign({ noise: "gauss" }, p.state));
  run();
}

function boot() {
  renderHypers();
  BV.PRESETS.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.id = p.id;
    b.textContent = p.label;
    els.presets.appendChild(b);
  });
  els.presets.addEventListener("click", (ev) => {
    const button = ev.target.closest("button[data-id]");
    if (button) applyPreset(button.dataset.id);
  });
  els.model.addEventListener("change", () => {
    renderHypers();
    schedule();
  });
  ["truth", "noise", "n", "sigma", "trials", "seed"].forEach((id) => {
    $(id).addEventListener("input", () => {
      paintValues();
      schedule();
    });
  });
  els.hypers.addEventListener("input", () => {
    paintValues();
    schedule();
  });
  document.querySelectorAll(".seg-toggle").forEach((group) => {
    group.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-scale]");
      if (!b) return;
      YLOG[group.dataset.chart] = b.dataset.scale === "log";
      group.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      drawCurves();
    });
  });
  $("anim-play").addEventListener("click", animPlay);
  $("anim-step").addEventListener("click", animStep);
  $("anim-all").addEventListener("click", animReset);
  $("sugg-grid").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-sugg]");
    if (b) applySuggestion(b.dataset.sugg);
  });

  BV.attachHover(els.fit, () => S.geom.fit, (i) => setHoverX(i));
  BV.attachHover(els.u, () => S.geom.u, (i) => hoverCurve("u", i));
  BV.attachHover(els.learn, () => S.geom.learn, (i) => hoverCurve("learn", i));

  $("fit-legend").innerHTML = `
    <li><i style="background:transparent;border-top:2px dashed ${BV.C.truth};height:0"></i>истинная f(x)</li>
    <li><i style="background:${BV.C.test}"></i>среднее предсказание E[ŷ]</li>
    <li><i style="background:rgba(244,234,216,0.9)"></i>модель, обученная на показанных точках</li>
    <li><i style="background:rgba(244,234,216,0.3)"></i>модели с других выборок</li>
    <li><i style="background:${BV.rgba(BV.C.variance, 0.35)};height:10px"></i>±1 ст. откл. — разброс</li>`;
  $("u-legend").innerHTML = legendHtml();
  $("learn-legend").innerHTML = legendHtml();

  let rz = null;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      drawTop();
      drawCurves();
    }, 60);
  });
  BV.applyPreset = applyPreset;
  run();
}

boot();
