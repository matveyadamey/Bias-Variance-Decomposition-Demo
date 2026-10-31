window.BV = window.BV || {};
var BV = window.BV;

// Палитра серий проверена валидатором (тёмная поверхность #1c1814):
// bias / variance / test различимы в том числе при дейтеранопии и протанопии.
BV.C = {
  bias: "#5b8ff0",
  variance: "#e0567a",
  test: "#c4861a",
  truth: "#3fa86a",
  noise: "#8d867c",
  ink: "#f4ead8",
  muted: "#b7a894",
  grid: "rgba(244,234,216,0.07)",
  axis: "rgba(244,234,216,0.24)",
  surface: "#1c1814",
};

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
BV.rgba = rgba;

// ---------- поверхность ----------

BV.prep = function (canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(280, canvas.clientWidth || canvas.parentElement.clientWidth || 600);
  const narrow = w < 560;
  const aspect = Number((narrow && canvas.dataset.aspectMobile) || canvas.dataset.aspect || 0.5);
  const minH = Number(canvas.dataset.minh || 160);
  const maxH = Number(canvas.dataset.maxh || 560);
  const h = Math.round(BV.clamp(w * aspect, minH, maxH));
  if (canvas._w !== w || canvas._h !== h || canvas._dpr !== dpr) {
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas._w = w;
    canvas._h = h;
    canvas._dpr = dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, narrow };
};

function scale(d0, d1, r0, r1, log) {
  if (log) {
    const l0 = Math.log10(d0);
    const l1 = Math.log10(d1);
    const f = (v) => r0 + ((Math.log10(Math.max(v, 1e-12)) - l0) / (l1 - l0)) * (r1 - r0);
    f.invert = (p) => Math.pow(10, l0 + ((p - r0) / (r1 - r0)) * (l1 - l0));
    return f;
  }
  const f = (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  f.invert = (p) => d0 + ((p - r0) / (r1 - r0)) * (d1 - d0);
  return f;
}

BV.niceTicks = function (min, max, count) {
  const span = max - min || 1;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
};

function logTicks(min, max) {
  const out = [];
  const e0 = Math.floor(Math.log10(min));
  const e1 = Math.ceil(Math.log10(max));
  for (let e = e0; e <= e1; e++) {
    for (const m of e1 - e0 <= 2 ? [1, 2, 5] : [1]) {
      const v = m * Math.pow(10, e);
      if (v >= min * 0.999 && v <= max * 1.001) out.push(v);
    }
  }
  return out;
}

function tickLabel(v) {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1000) return v.toExponential(0).replace("+", "");
  if (a >= 1) return String(Number(v.toFixed(2)));
  if (a >= 0.001) return String(Number(v.toPrecision(2)));
  return v.toExponential(0);
}

const MONO = '11px "IBM Plex Mono", ui-monospace, monospace';
const SANS = '12px "Atkinson Hyperlegible", system-ui, sans-serif';
// Подписи осей — крупнее и светлее, чем цифры делений.
const AXIS = '700 14px "Atkinson Hyperlegible", system-ui, sans-serif';
const AXIS_INK = "rgba(244,234,216,0.88)";

function frame(ctx, area, xs, ys, xTicks, yTicks, opts) {
  ctx.save();
  ctx.font = MONO;
  ctx.fillStyle = BV.C.muted;
  ctx.strokeStyle = BV.C.grid;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of yTicks) {
    const y = Math.round(ys(t)) + 0.5;
    if (y < area.t - 1 || y > area.b + 1) continue;
    ctx.beginPath();
    ctx.moveTo(area.l, y);
    ctx.lineTo(area.r, y);
    ctx.stroke();
    ctx.fillText(tickLabel(t), area.l - 8, y);
  }
  ctx.strokeStyle = BV.C.axis;
  ctx.beginPath();
  ctx.moveTo(area.l, Math.round(area.b) + 0.5);
  ctx.lineTo(area.r, Math.round(area.b) + 0.5);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const t of xTicks) {
    const x = xs(t.v);
    ctx.fillText(t.label, x, area.b + 7);
  }
  if (opts && opts.xLabel) {
    ctx.font = AXIS;
    ctx.fillStyle = AXIS_INK;
    ctx.textAlign = "right";
    ctx.fillText(opts.xLabel, area.r, area.b + 22);
  }
  if (opts && opts.yLabel) {
    // Вертикальная подпись оси y вдоль левого края.
    ctx.font = AXIS;
    ctx.fillStyle = AXIS_INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.translate(2, (area.t + area.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel, 0, 0);
  }
  ctx.restore();
}

function path(ctx, xs, ys, px, py) {
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const X = px(xs[i]);
    const Y = py(ys[i]);
    if (i === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  }
}

function stroke(ctx, xs, ys, px, py, color, width, dash) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width || 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash(dash || []);
  path(ctx, xs, ys, px, py);
  ctx.stroke();
  ctx.restore();
}

function dot(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = BV.C.surface;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function clipArea(ctx, area) {
  ctx.beginPath();
  ctx.rect(area.l, area.t - 2, area.r - area.l, area.b - area.t + 4);
  ctx.clip();
}

function hoverLine(ctx, area, x) {
  ctx.save();
  ctx.strokeStyle = "rgba(244,234,216,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, area.t);
  ctx.lineTo(Math.round(x) + 0.5, area.b);
  ctx.stroke();
  ctx.restore();
}

// Общая горизонталь у графиков, нарисованных по x ∈ [0, 1], чтобы они совпадали по вертикали.
const PAD_L = 66;
const PAD_R = 14;

function xAxis01(area) {
  const xs = scale(0, 1, area.l, area.r);
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => ({ v, label: v.toFixed(1) }));
  return { xs, ticks };
}

// ---------- 1. Подгонка по многим выборкам ----------

BV.fitRange = function (pack) {
  let lo = Infinity;
  let hi = -Infinity;
  const take = (arr) => {
    for (const v of arr) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  };
  take(pack.truth);
  for (const s of pack.samples) take(s.ys);
  const span = Math.max(0.8, hi - lo);
  return [lo - 0.12 * span, hi + 0.12 * span];
};

// opts: { anim: {idx, prev, e}, hover: index | null }
BV.drawFit = function (canvas, pack, opts) {
  opts = opts || {};
  const { ctx, w, h, narrow } = BV.prep(canvas);
  // Верхняя полоса отдана под плашки со значениями Bias²/Variance.
  const area = { l: PAD_L, r: w - PAD_R, t: narrow ? 72 : 50, b: h - 44 };
  const [y0, y1] = BV.fitRange(pack);
  const { xs, ticks } = xAxis01(area);
  const ys = scale(y0, y1, area.b, area.t);
  frame(ctx, area, xs, ys, ticks, BV.niceTicks(y0, y1, 5), { xLabel: "x — признак", yLabel: "y — целевая переменная" });
  const g = pack.grid;
  const anim = opts.anim;

  ctx.save();
  clipArea(ctx, area);

  if (!anim) {
    // Полоса ±1 ст. откл. — та самая variance, только в единицах y.
    const sd = pack.pointVar.map((v) => Math.sqrt(Math.max(v, 0)));
    ctx.fillStyle = rgba(BV.C.variance, 0.16);
    ctx.beginPath();
    for (let i = 0; i < g.length; i++) ctx.lineTo(xs(g[i]), ys(pack.mean[i] + sd[i]));
    for (let i = g.length - 1; i >= 0; i--) ctx.lineTo(xs(g[i]), ys(pack.mean[i] - sd[i]));
    ctx.closePath();
    ctx.fill();
    for (const fit of pack.fits) stroke(ctx, g, fit, xs, ys, "rgba(244,234,216,0.16)", 1);
    stroke(ctx, g, pack.truth, xs, ys, BV.C.truth, 2.2, [7, 5]);
    stroke(ctx, g, pack.mean, xs, ys, BV.C.test, 2.6);
    // Модель, обученная именно на нарисованных точках.
    stroke(ctx, g, pack.fits[0], xs, ys, "rgba(244,234,216,0.9)", 1.8);
    for (let i = 0; i < pack.sampleX.length; i++) {
      dot(ctx, xs(pack.sampleX[i]), ys(pack.sampleY[i]), 3.4, "rgba(244,234,216,0.85)");
    }
  } else {
    const { idx, prev, e } = anim;
    for (let t = 0; t < idx; t++) stroke(ctx, g, pack.fits[t], xs, ys, "rgba(244,234,216,0.09)", 1);
    // Бегущее среднее: E[ŷ] собирается из уже увиденных выборок.
    const runMean = (k) => g.map((_, i) => {
      let s = 0;
      for (let t = 0; t <= k; t++) s += pack.fits[t][i];
      return s / (k + 1);
    });
    const mNow = runMean(idx);
    const mPrev = prev >= 0 ? runMean(prev) : mNow;
    const mean = mNow.map((v, i) => mPrev[i] + (v - mPrev[i]) * e);
    stroke(ctx, g, pack.truth, xs, ys, BV.C.truth, 2.2, [7, 5]);
    if (idx > 0) stroke(ctx, g, mean, xs, ys, BV.C.test, 2.6);
    const from = prev >= 0 ? pack.fits[prev] : pack.fits[idx];
    const cur = pack.fits[idx].map((v, i) => from[i] + (v - from[i]) * e);
    stroke(ctx, g, cur, xs, ys, BV.C.ink, 2.4);
    if (prev >= 0 && e < 1) {
      const s = pack.samples[prev];
      for (let i = 0; i < s.xs.length; i++) dot(ctx, xs(s.xs[i]), ys(s.ys[i]), 3.4, `rgba(244,234,216,${0.85 * (1 - e)})`);
    }
    const s = pack.samples[idx];
    for (let i = 0; i < s.xs.length; i++) dot(ctx, xs(s.xs[i]), ys(s.ys[i]), 3.4, `rgba(244,234,216,${0.95 * e})`);
  }
  ctx.restore();

  if (anim) {
    ctx.save();
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    ctx.fillStyle = BV.C.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`выборка ${anim.idx + 1} из ${pack.fits.length}`, area.l + 10, area.b - 8);
    ctx.restore();
  }

  if (opts.hover != null) {
    const i = opts.hover;
    const X = xs(g[i]);
    hoverLine(ctx, area, X);
    const sd = Math.sqrt(Math.max(pack.pointVar[i], 0));
    ctx.save();
    // Отрезок смещения: от истины до среднего.
    ctx.strokeStyle = BV.C.bias;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(X - 6, ys(pack.truth[i]));
    ctx.lineTo(X - 6, ys(pack.mean[i]));
    ctx.stroke();
    // Скобка разброса: ±1 ст. откл.
    ctx.strokeStyle = BV.C.variance;
    ctx.lineWidth = 2;
    const a = ys(pack.mean[i] + sd);
    const b = ys(pack.mean[i] - sd);
    ctx.beginPath();
    ctx.moveTo(X + 10, a);
    ctx.lineTo(X + 6, a);
    ctx.lineTo(X + 6, b);
    ctx.lineTo(X + 10, b);
    ctx.stroke();
    ctx.restore();
    dot(ctx, X, ys(pack.truth[i]), 4, BV.C.truth);
    dot(ctx, X, ys(pack.mean[i]), 4, BV.C.test);
  }
  return { area, xs, n: g.length, toIndex: (px) => Math.round(BV.clamp(xs.invert(px), 0, 1) * (g.length - 1)), X: (i) => xs(g[i]) };
};

// ---------- 3. Линейный график с наведением (U-кривая, кривая обучения) ----------
// spec: { x:[], xLog, xTicks:[{v,label}], series:[{key,label,color,dash,values}], marks:[{i,label,color}], zones:[{from,to,color,label}], xLabel }

BV.drawLines = function (canvas, spec, hover) {
  const { ctx, w, h } = BV.prep(canvas);
  const area = { l: 72, r: w - 16, t: 30, b: h - 44 };
  const xMin = spec.x[0];
  const xMax = spec.x[spec.x.length - 1];
  const xs = scale(xMin, xMax, area.l, area.r, spec.xLog);

  let lo = Infinity;
  let hi = 0;
  for (const s of spec.series) {
    for (const v of s.values) {
      if (v > 0 && v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const maxAll = hi;
  let ys;
  let yTicks;
  let clipped = false;
  if (spec.yLog) {
  lo = Math.max(lo, 1e-4) / 1.6;
  // Ниже ~1/40 от лучшего теста значения практически нулевые: на лог-шкале они
  // только раздували бы шум оценки. Прижимаем их к нижней границе.
  const anchorMin = Math.min(...spec.series.filter((s) => s.anchor).map((s) => Math.min(...s.values)));
  if (Number.isFinite(anchorMin)) lo = Math.max(lo, anchorMin / 40);
  const floorRef = Math.min(...spec.series.filter((s) => s.anchor).map((s) => Math.min(...s.values)));
  const cap = Number.isFinite(floorRef) ? floorRef * 60 : hi;
  hi = Math.min(hi * 1.6, Math.max(cap, lo * 10));
  ys = scale(lo, hi, area.b, area.t, true);
  yTicks = logTicks(lo, hi);
  } else {
    // Обычная шкала, как в учебниках. Взрывные значения переобучения обрезаем,
    // иначе вся «чаша» U-кривой сплющится у нуля.
    const anchor = spec.series.find((s) => s.anchor) || spec.series[0];
    const sorted = anchor.values.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const noiseS = spec.series.find((s) => s.key === "noise");
    const floorN = noiseS ? noiseS.values[0] : 0;
    lo = 0;
    hi = Math.min(maxAll * 1.08, Math.max(med * 3, floorN * 2.5, sorted[0] * 4));
    clipped = maxAll > hi * 1.02;
    ys = scale(0, hi, area.b, area.t, false);
    yTicks = BV.niceTicks(0, hi, 5);
  }

  // Зоны «недообучение / переобучение»
  ctx.save();
  for (const z of spec.zones || []) {
    const a = xs(z.from);
    const b = xs(z.to);
    ctx.fillStyle = rgba(z.color, 0.07);
    ctx.fillRect(Math.min(a, b), area.t, Math.abs(b - a), area.b - area.t);
    ctx.font = SANS;
    ctx.fillStyle = BV.C.muted;
    ctx.textBaseline = "bottom";
    ctx.textAlign = z.align || "left";
    ctx.fillText(z.label, z.align === "right" ? Math.max(a, b) - 6 : Math.min(a, b) + 6, area.t - 6);
  }
  ctx.restore();

  frame(ctx, area, xs, ys, spec.xTicks, yTicks, { xLabel: spec.xLabel, yLabel: spec.yLabel });

  ctx.save();
  clipArea(ctx, area);
  for (const s of spec.series) stroke(ctx, spec.x, s.values.map((v) => Math.max(v, lo)), xs, ys, s.color, s.width || 2, s.dash);
  ctx.restore();
  if (clipped) {
    ctx.save();
    ctx.font = MONO;
    ctx.fillStyle = BV.C.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("↑ часть значений выше шкалы", area.r - 4, area.t + 22);
    ctx.restore();
  }

  // Вертикальные отметки: «вы здесь», «минимум»
  for (const m of spec.marks || []) {
    const X = xs(spec.x[m.i]);
    ctx.save();
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(m.dash || []);
    ctx.beginPath();
    ctx.moveTo(X, area.t);
    ctx.lineTo(X, area.b);
    ctx.stroke();
    ctx.restore();
    const testS = spec.series.find((s) => s.key === "testMse");
    if (testS) dot(ctx, X, ys(BV.clamp(testS.values[m.i], lo, hi)), m.r || 4.5, m.dotColor || BV.C.test);
    ctx.save();
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    ctx.fillStyle = BV.C.ink;
    ctx.textBaseline = "top";
    const right = X > (area.l + area.r) / 2;
    ctx.textAlign = right ? "right" : "left";
    ctx.fillText(m.label, X + (right ? -6 : 6), area.t + 4 + (m.row || 0) * 15);
    ctx.restore();
  }

  if (hover != null) {
    const X = xs(spec.x[hover]);
    hoverLine(ctx, area, X);
    for (const s of spec.series) {
      const v = Math.max(s.values[hover], lo);
      if (v <= hi) dot(ctx, X, ys(v), 4, s.color);
    }
  }

  const toIndex = (px) => {
    let best = 0;
    for (let i = 1; i < spec.x.length; i++) {
      if (Math.abs(xs(spec.x[i]) - px) < Math.abs(xs(spec.x[best]) - px)) best = i;
    }
    return best;
  };
  return { area, xs, toIndex, X: (i) => xs(spec.x[i]) };
};

// ---------- наведение ----------

BV.attachHover = function (canvas, getGeom, onHover) {
  const handle = (ev) => {
    const geom = getGeom();
    if (!geom) return;
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    if (px < geom.area.l - 10 || px > geom.area.r + 10) {
      onHover(null);
      return;
    }
    onHover(geom.toIndex(px), px, py);
  };
  canvas.addEventListener("pointermove", handle);
  canvas.addEventListener("pointerdown", handle);
  canvas.addEventListener("pointerleave", () => onHover(null));
};

BV.showTip = function (tip, canvas, x, html) {
  if (html == null) {
    tip.hidden = true;
    return;
  }
  tip.innerHTML = html;
  tip.hidden = false;
  const wrapW = canvas.clientWidth;
  const tw = tip.offsetWidth;
  let left = x + 16;
  if (left + tw > wrapW - 4) left = x - tw - 16;
  tip.style.left = Math.max(4, left) + "px";
  tip.style.top = (tip.dataset.top || 10) + "px";
};

BV.tipRow = function (color, label, value, dash) {
  const sw = color
    ? `<i style="background:${dash ? "transparent" : color};${dash ? `border-top:2px dashed ${color};height:0;` : ""}"></i>`
    : "<i></i>";
  return `<div class="tip-row">${sw}<span>${label}</span><b>${value}</b></div>`;
};
