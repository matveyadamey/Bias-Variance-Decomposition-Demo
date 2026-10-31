window.BV = window.BV || {};
var BV = window.BV;

// ---------- Симуляция ----------

BV.sampleSet = function (rng, n, sigma, f, noise) {
  const eps = (BV.NOISE[noise] || BV.NOISE.gauss).eps;
  const xs = new Array(n);
  const ys = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = rng();
    xs[i] = x;
    ys[i] = f(x) + sigma * eps(rng, x);
  }
  return { xs, ys };
};

BV.mseOn = function (predict, xs, ys) {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = ys[i] - predict(xs[i]);
    s += d * d;
  }
  return s / xs.length;
};

BV.GRID = BV.linspace(0, 1, 101);

// Одно и то же зерно + n + число выборок = одни и те же данные для любой модели.
// Поэтому сравнения «до/после» честные: меняется только модель, не шум.
BV.evaluate = function (config) {
  const f = BV.FUNCTIONS[config.truth].f;
  const rng = BV.mulberry32(config.seed);
  const grid = BV.GRID;
  const truth = grid.map(f);
  const fits = [];
  const samples = [];
  let trainSum = 0;
  let testSum = 0;

  for (let t = 0; t < config.trials; t++) {
    const train = BV.sampleSet(rng, config.n, config.sigma, f, config.noise);
    const model = BV.fitModel(config.model, train.xs, train.ys, config.hyper);
    const pred = grid.map((x) => model.predict(x));
    fits.push(pred);
    const trainMse = BV.mseOn(model.predict, train.xs, train.ys);
    const test = BV.sampleSet(rng, 80, config.sigma, f, config.noise);
    const testMse = BV.mseOn(model.predict, test.xs, test.ys);
    trainSum += trainMse;
    testSum += testMse;
    samples.push({ xs: train.xs, ys: train.ys, trainMse, testMse });
  }

  const m = grid.length;
  const mean = new Array(m);
  const pointVar = new Array(m);
  const pointBias2 = new Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let t = 0; t < fits.length; t++) s += fits[t][i];
    const mu = s / fits.length;
    let v = 0;
    for (let t = 0; t < fits.length; t++) {
      const d = fits[t][i] - mu;
      v += d * d;
    }
    const T = fits.length;
    mean[i] = mu;
    pointVar[i] = T > 1 ? v / T : 0;
    // (среднее − истина)² содержит ещё и шум самого среднего ≈ Var/(T−1).
    // Вычитаем его, иначе у нестабильных моделей Bias² завышен и «скачет».
    const raw = (mu - truth[i]) * (mu - truth[i]);
    pointBias2[i] = T > 1 ? Math.max(0, raw - pointVar[i] / (T - 1)) : raw;
  }
  const bias2 = BV.mean(pointBias2);
  const variance = BV.mean(pointVar);
  const noise = config.sigma * config.sigma;
  return {
    grid,
    truth,
    fits,
    mean,
    pointVar,
    pointBias2,
    samples,
    sampleX: samples[0].xs,
    sampleY: samples[0].ys,
    stats: {
      bias2,
      variance,
      noise,
      total: bias2 + variance + noise,
      trainMse: trainSum / config.trials,
      testMse: testSum / config.trials,
    },
  };
};

BV.withHyper = function (config, patch) {
  return Object.assign({}, config, { hyper: Object.assign({}, config.hyper, patch) });
};

// U-кривая по главному рычагу.
BV.sweep = function (config) {
  const meta = BV.MODEL_META[config.model];
  const main = meta.main;
  const trials = Math.max(config.trials, 40);
  const values = BV.sweepValues(config.model, config.hyper);
  const points = values.map((v) => {
    const cfg = BV.withHyper(Object.assign({}, config, { trials }), { [main]: v });
    return Object.assign({ value: v }, BV.evaluate(cfg).stats);
  });
  const curIdx = points.findIndex((p) => p.value === config.hyper[main]);
  let bestIdx = 0;
  points.forEach((p, i) => {
    if (p.testMse < points[bestIdx].testMse) bestIdx = i;
  });
  return { main, trials, points, curIdx, bestIdx, regime: BV.regimeFromSweep(points, curIdx, bestIdx) };
};

// Режим определяется положением на U-кривой, а не соотношением Bias²/Var:
// у хорошей модели смещение почти ноль, и «разброс больше смещения» ещё не значит переобучение.
BV.regimeFromSweep = function (points, curIdx, bestIdx) {
  if (points[curIdx].testMse <= points[bestIdx].testMse * 1.1) return "balanced";
  return curIdx > bestIdx ? "overfit" : "underfit";
};

BV.LEARN_NS = [10, 14, 20, 28, 40, 57, 80, 113, 160, 240];

BV.learningCurve = function (config) {
  const trials = Math.max(config.trials, 30);
  const ns = BV.LEARN_NS.slice();
  if (!ns.includes(config.n)) ns.push(config.n);
  ns.sort((a, b) => a - b);
  const points = ns.map((n) =>
    Object.assign({ n }, BV.evaluate(Object.assign({}, config, { n, trials })).stats)
  );
  const curIdx = points.findIndex((p) => p.n === config.n);
  return { trials, points, curIdx };
};

// ---------- Подсказки, проверенные расчётом ----------

function fieldOf(kind, id) {
  return BV.MODEL_META[kind].fields.find((f) => f.id === id);
}

function fmtVal(v) {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
}

BV.suggest = function (config, swept, baseStats) {
  const kind = config.model;
  const meta = BV.MODEL_META[kind];
  const trials = config.trials;
  const cfgT = config;
  const base = Object.assign({ value: config.hyper[meta.main] }, baseStats);
  const cands = [];
  const mainField = fieldOf(kind, meta.main);

  // 1. Лучшее значение главного рычага.
  const best = swept.bestIdx !== swept.curIdx
    ? Object.assign({ value: swept.points[swept.bestIdx].value },
        BV.evaluate(BV.withHyper(cfgT, { [meta.main]: swept.points[swept.bestIdx].value })).stats)
    : null;
  if (best) {
    const simpler = swept.bestIdx < swept.curIdx;
    cands.push({
      id: "main",
      title: `${simpler ? "Упростить" : "Усложнить"} модель: ${mainField.short} ${fmtVal(base.value)} → ${fmtVal(best.value)}`,
      patch: { model: kind, [meta.main]: best.value },
      stats: best,
      dir: simpler ? "simpler" : "complex",
    });
  }

  // 2. Модельные ходы.
  if (kind === "poly" && config.hyper.degree >= 5) {
    let pick = null;
    for (const lambda of [1, 4, 16]) {
      const cfg = Object.assign({}, cfgT, { model: "ridge", hyper: { degree: config.hyper.degree, lambda } });
      const st = BV.evaluate(cfg).stats;
      if (!pick || st.testMse < pick.stats.testMse) pick = { lambda, stats: st };
    }
    cands.push({
      id: "ridge",
      title: `Добавить регуляризацию: гребневый полином, λ = ${pick.lambda}`,
      patch: { model: "ridge", degree: config.hyper.degree, lambda: pick.lambda },
      stats: pick.stats,
      dir: "simpler",
      note: "степень остаётся той же — меняется только штраф за большие коэффициенты",
    });
  }
  if (kind === "ridge") {
    let pick = null;
    for (const degree of [4, 6, 8, 10, 12, 14]) {
      if (degree === config.hyper.degree) continue;
      const st = BV.evaluate(BV.withHyper(cfgT, { degree })).stats;
      if (!pick || st.testMse < pick.stats.testMse) pick = { degree, stats: st };
    }
    cands.push({
      id: "degree",
      title: `Сменить степень базиса: ${config.hyper.degree} → ${pick.degree}`,
      patch: { model: kind, degree: pick.degree, lambda: config.hyper.lambda },
      stats: pick.stats,
      dir: pick.degree < config.hyper.degree ? "simpler" : "complex",
    });
  }
  if (kind === "tree") {
    let pick = null;
    for (const minLeaf of [1, 3, 5, 8, 12]) {
      if (minLeaf === config.hyper.minLeaf) continue;
      const st = BV.evaluate(BV.withHyper(cfgT, { minLeaf })).stats;
      if (!pick || st.testMse < pick.stats.testMse) pick = { minLeaf, stats: st };
    }
    cands.push({
      id: "leaf",
      title: `Минимум точек в листе: ${config.hyper.minLeaf} → ${pick.minLeaf}`,
      patch: { model: kind, depth: config.hyper.depth, minLeaf: pick.minLeaf },
      stats: pick.stats,
      dir: pick.minLeaf > config.hyper.minLeaf ? "simpler" : "complex",
    });
  }

  const gain = (st) => 1 - st.testMse / base.testMse;
  const useful = cands
    .filter((c) => gain(c.stats) >= 0.03)
    .sort((a, b) => a.stats.testMse - b.stats.testMse)
    .slice(0, 3);

  // 3. Не гиперпараметр, но важный вопрос: помогут ли данные?
  const n2 = Math.min(240, config.n * 2);
  let data = null;
  if (n2 > config.n) {
    const st = BV.evaluate(Object.assign({}, cfgT, { n: n2 })).stats;
    data = {
      id: "data",
      title: `Собрать вдвое больше данных: n ${config.n} → ${n2}`,
      patch: { n: n2 },
      stats: st,
      isData: true,
    };
  }

  for (const c of useful.concat(data ? [data] : [])) {
    c.gain = gain(c.stats);
    c.why = BV.explainDelta(base, c.stats, c);
  }
  return { base, trials, items: useful, data, best: useful[0] || null };
};

// Итоговый режим: положение на U-кривой главного рычага, но если другой рычаг
// даёт большой выигрыш (≥ 15%), «баланс» был бы неправдой — берём его направление.
BV.finalRegime = function (swept, sugg) {
  if (swept.regime === "balanced" && sugg.best && sugg.best.gain >= 0.15 && sugg.best.dir) {
    return sugg.best.dir === "simpler" ? "overfit" : "underfit";
  }
  return swept.regime;
};

BV.ratio = function (a, b) {
  const r = a / Math.max(b, 1e-9);
  if (r >= 10) return `×${r.toFixed(0)}`;
  return `×${r.toFixed(2).replace(/\.?0+$/, "")}`;
};

BV.explainDelta = function (a, b, cand) {
  const dB = b.bias2 - a.bias2;
  const dV = b.variance - a.variance;
  const f = BV.format;
  if (cand.isData) {
    if (1 - b.testMse / a.testMse < 0.05) {
      return `Почти ничего не даст: тест ${f(a.testMse)} → ${f(b.testMse)}. Ошибка упирается в смещение (${f(b.bias2)}) и шум, а они от n не зависят.`;
    }
    return `Variance ${f(a.variance)} → ${f(b.variance)} (${BV.ratio(b.variance, a.variance)}), смещение почти то же. Данные лечат разброс, но не смещение.`;
  }
  if (dV < 0 && -dV >= Math.abs(dB)) {
    const tail = dB > 0 ? ` Bias² чуть вырос (${f(a.bias2)} → ${f(b.bias2)}) — это плата за стабильность, и она того стоит.` : "";
    return `Variance падает ${f(a.variance)} → ${f(b.variance)} (${BV.ratio(b.variance, a.variance)}): модели с разных выборок начинают совпадать.${tail}`;
  }
  if (dB < 0) {
    const tail = dV > 0 ? ` Variance подрастёт (${f(a.variance)} → ${f(b.variance)}), но это дешевле.` : "";
    return `Bias² падает ${f(a.bias2)} → ${f(b.bias2)} (${BV.ratio(b.bias2, a.bias2)}): модель начинает повторять форму f(x).${tail}`;
  }
  return `Bias² ${f(a.bias2)} → ${f(b.bias2)}, variance ${f(a.variance)} → ${f(b.variance)}.`;
};

// ---------- Где живёт ошибка ----------

BV.locate = function (pack, config) {
  const g = pack.grid;
  const v = pack.pointVar;
  const b = pack.pointBias2;
  const st = pack.stats;
  const total = Math.max(st.total, 1e-9);
  const kind = config.model;
  const out = { varText: "", biasText: "" };
  const sum = (arr, pred) => arr.reduce((s, val, i) => (pred(g[i]) ? s + val : s), 0);
  const sumV = sum(v, () => true);

  if (st.variance < 0.12 * total || sumV < 1e-9) {
    out.varText = "Разброс мал по всей оси: модели с разных выборок почти совпадают.";
  } else {
    const edge = sum(v, (x) => x < 0.1 || x > 0.9) / sumV;
    if (edge > 0.45) {
      const why = {
        poly: "Полином высокой степени «раскачивается» у границ: там мало точек и ничто не удерживает хвосты (эффект Рунге).",
        ridge: "Даже со штрафом полином свободнее всего у границ, где точек мало.",
        knn: "У края соседи есть только с одной стороны, поэтому их среднее шумнее и смещается.",
        kernel: "У края окно ядра наполовину пустое, оценка опирается на меньшее число точек.",
        tree: "Крайние листья держатся на нескольких точках и копируют их шум.",
      }[kind];
      out.varText = `${Math.round(edge * 100)}% разброса — на краях оси (x < 0.1 и x > 0.9, это всего 20% области). ${why}`;
    } else {
      const w = 20;
      let bestS = -1;
      let bestI = 0;
      for (let i = 0; i + w < g.length; i++) {
        let s = 0;
        for (let j = i; j <= i + w; j++) s += v[j];
        if (s > bestS) {
          bestS = s;
          bestI = i;
        }
      }
      const a = g[bestI];
      const c = g[bestI + w];
      const share = bestS / sumV;
      if (share < 0.32) {
        out.varText = "Разброс размазан по всей оси: модель везде немного «дрожит» вслед за шумом.";
      } else {
        let why = "Здесь модель опирается на немногие точки, и каждая выборка тянет кривую по-своему.";
        if (config.truth === "step" && a <= 0.47 && c >= 0.43) {
          why = "Это зона скачка: каждая выборка ставит разрыв чуть в другом месте.";
        }
        out.varText = `${Math.round(share * 100)}% разброса сосредоточено на отрезке x ∈ [${a.toFixed(2)}, ${c.toFixed(2)}]. ${why}`;
      }
    }
  }

  if (st.bias2 < 0.12 * total) {
    out.biasText = "Смещение мало: в среднем модель повторяет форму f(x).";
  } else {
    let mi = 0;
    for (let i = 0; i < b.length; i++) if (b[i] > b[mi]) mi = i;
    const xm = g[mi];
    const t = pack.truth;
    const i0 = Math.max(1, Math.min(t.length - 2, mi));
    const curv = Math.abs(t[i0 + 1] - 2 * t[i0] + t[i0 - 1]);
    let maxCurv = 0;
    for (let i = 1; i < t.length - 1; i++) maxCurv = Math.max(maxCurv, Math.abs(t[i + 1] - 2 * t[i] + t[i - 1]));
    let why = "здесь среднее предсказание дальше всего от истины.";
    if (config.truth === "step" && Math.abs(xm - 0.45) < 0.1) {
      why = "это разрыв, а гладкая модель его размазывает.";
    } else if (curv > 0.5 * maxCurv) {
      why = "истинная кривая здесь резко изгибается, а модель срезает пик.";
    }
    out.biasText = `Смещение сильнее всего около x ≈ ${xm.toFixed(2)}: ${why}`;
  }
  return out;
};
