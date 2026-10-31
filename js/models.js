window.BV = window.BV || {};
var BV = window.BV;

BV.fitPolynomial = function (xs, ys, degree, lambda) {
  const p = degree + 1;
  const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty = new Array(p).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const row = BV.chebyshev(xs[i], degree);
    for (let a = 0; a < p; a++) {
      xty[a] += row[a] * ys[i];
      for (let b = 0; b < p; b++) xtx[a][b] += row[a] * row[b];
    }
  }
  const ridge = lambda || 0;
  for (let a = 0; a < p; a++) xtx[a][a] += ridge;
  const coef = BV.solve(xtx, xty);
  return {
    kind: "poly",
    degree,
    coef,
    predict(x) {
      const row = BV.chebyshev(x, degree);
      let s = 0;
      for (let i = 0; i < row.length; i++) s += coef[i] * row[i];
      return s;
    },
  };
};

BV.makeKnn = function (xs, ys, k) {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const sx = order.map((i) => xs[i]);
  const sy = order.map((i) => ys[i]);
  const n = sx.length;
  const kk = Math.max(1, Math.min(k, n));
  return {
    kind: "knn",
    predict(x) {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (sx[m] < x) lo = m + 1;
        else hi = m;
      }
      let L = lo - 1;
      let R = lo;
      let s = 0;
      for (let c = 0; c < kk; c++) {
        if (L < 0) s += sy[R++];
        else if (R >= n) s += sy[L--];
        else if (x - sx[L] <= sx[R] - x) s += sy[L--];
        else s += sy[R++];
      }
      return s / kk;
    },
  };
};

BV.predictKernel = function (xs, ys, h, x) {
  const bw = Math.max(h, 1e-4);
  let wsum = 0;
  let ysum = 0;
  for (let i = 0; i < xs.length; i++) {
    const u = (x - xs[i]) / bw;
    const w = Math.exp(-0.5 * u * u);
    wsum += w;
    ysum += w * ys[i];
  }
  if (wsum < 1e-12) return BV.mean(ys);
  return ysum / wsum;
};

BV.fitTree = function (xs, ys, maxDepth, minLeaf) {
  const n = xs.length;
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);

  function leaf(idx) {
    let s = 0;
    for (let i = 0; i < idx.length; i++) s += ys[idx[i]];
    return { type: "leaf", value: s / idx.length };
  }

  function sse(idx) {
    if (!idx.length) return 0;
    let s = 0;
    for (let i = 0; i < idx.length; i++) s += ys[idx[i]];
    const m = s / idx.length;
    let e = 0;
    for (let i = 0; i < idx.length; i++) {
      const d = ys[idx[i]] - m;
      e += d * d;
    }
    return e;
  }

  function split(idx, depth) {
    if (depth >= maxDepth || idx.length < minLeaf * 2) return leaf(idx);
    const sorted = idx.slice().sort((a, b) => xs[a] - xs[b]);
    let bestGain = 0;
    let bestT = null;
    let bestL = null;
    let bestR = null;
    const parent = sse(sorted);
    for (let i = minLeaf; i <= sorted.length - minLeaf; i++) {
      const leftX = xs[sorted[i - 1]];
      const rightX = xs[sorted[i]];
      if (rightX === leftX) continue;
      const L = sorted.slice(0, i);
      const R = sorted.slice(i);
      const gain = parent - sse(L) - sse(R);
      if (gain > bestGain) {
        bestGain = gain;
        bestT = 0.5 * (leftX + rightX);
        bestL = L;
        bestR = R;
      }
    }
    if (!bestL || bestGain < 1e-12) return leaf(sorted);
    return {
      type: "node",
      thr: bestT,
      left: split(bestL, depth + 1),
      right: split(bestR, depth + 1),
    };
  }

  const root = split(order, 0);
  return {
    kind: "tree",
    root,
    predict(x) {
      let node = root;
      while (node.type === "node") {
        node = x < node.thr ? node.left : node.right;
      }
      return node.value;
    },
  };
};

BV.fitModel = function (kind, xs, ys, hyper) {
  if (kind === "poly") {
    return BV.fitPolynomial(xs, ys, hyper.degree, 1e-3);
  }
  if (kind === "ridge") {
    return BV.fitPolynomial(xs, ys, hyper.degree, hyper.lambda);
  }
  if (kind === "tree") {
    return BV.fitTree(xs, ys, hyper.depth, hyper.minLeaf);
  }
  if (kind === "knn") {
    return BV.makeKnn(xs, ys, hyper.k);
  }
  if (kind === "kernel") {
    return {
      kind: "kernel",
      predict: (x) => BV.predictKernel(xs, ys, hyper.bandwidth, x),
    };
  }
  throw new Error("unknown model");
};

BV.MODEL_META = {
  poly: {
    complexityUp: true,
    name: "полином",
    main: "degree",
    fields: [
      {
        id: "degree",
        short: "степень",
        label: "Степень полинома",
        min: 0,
        max: 14,
        step: 1,
        value: 3,
      },
    ],
  },
  ridge: {
    complexityUp: false,
    name: "гребневой полином",
    main: "lambda",
    fields: [
      {
        id: "degree",
        short: "степень",
        label: "Степень (гибкость базиса)",
        min: 4,
        max: 14,
        step: 1,
        value: 6,
      },
      {
        id: "lambda",
        short: "λ",
        label: "λ, сила штрафа",
        min: 0,
        max: 40,
        step: 0.5,
        value: 1,
      },
    ],
  },
  knn: {
    complexityUp: false,
    name: "k-NN",
    main: "k",
    fields: [
      {
        id: "k",
        short: "k",
        label: "Число соседей k",
        min: 1,
        max: 40,
        step: 1,
        value: 5,
      },
    ],
  },
  kernel: {
    complexityUp: false,
    name: "ядерное сглаживание",
    main: "bandwidth",
    fields: [
      {
        id: "bandwidth",
        short: "h",
        label: "Ширина ядра h",
        min: 0.03,
        max: 0.45,
        step: 0.01,
        value: 0.06,
      },
    ],
  },
  tree: {
    complexityUp: true,
    name: "решающее дерево",
    main: "depth",
    fields: [
      {
        id: "depth",
        short: "глубина",
        label: "Максимальная глубина",
        min: 1,
        max: 12,
        step: 1,
        value: 4,
      },
      {
        id: "minLeaf",
        short: "мин. точек в листе",
        label: "Минимум точек в листе",
        min: 1,
        max: 12,
        step: 1,
        value: 2,
      },
    ],
  },
};

BV.SWEEP_GRID = {
  degree: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  lambda: [0, 0.5, 1, 2, 4, 8, 16, 24, 32, 40],
  k: [1, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20, 25, 32, 40],
  bandwidth: [0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.19, 0.24, 0.3, 0.37, 0.45],
  depth: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

// Значения главного гиперпараметра, упорядоченные по росту сложности модели.
BV.sweepValues = function (kind, hyper) {
  const meta = BV.MODEL_META[kind];
  const field = meta.fields.find((f) => f.id === meta.main);
  let values = BV.SWEEP_GRID[meta.main].filter((v) => v >= field.min && v <= field.max);
  const cur = hyper[meta.main];
  if (!values.includes(cur)) values.push(cur);
  values.sort((a, b) => a - b);
  if (!meta.complexityUp) values.reverse();
  return values;
};

BV.flexibilityNote = function (kind, hyper) {
  if (kind === "poly") {
    return hyper.degree <= 2
      ? "низкая гибкость (малая степень)"
      : hyper.degree >= 9
        ? "очень высокая гибкость"
        : "средняя гибкость";
  }
  if (kind === "ridge") {
    return hyper.lambda >= 16
      ? "штраф сильный — модель упрощается"
      : hyper.lambda <= 1
        ? "штраф слабый — почти обычный полином"
        : "умеренная регуляризация";
  }
  if (kind === "knn") {
    return hyper.k <= 2
      ? "почти интерполяция (малый k)"
      : hyper.k >= 15
        ? "сильное усреднение (большой k)"
        : "локальное усреднение";
  }
  if (kind === "kernel") {
    return hyper.bandwidth <= 0.06
      ? "узкое ядро — следует за шумом"
      : hyper.bandwidth >= 0.25
        ? "широкое ядро — сглаживает форму"
        : "средняя ширина окна";
  }
  if (kind === "tree") {
    return hyper.depth <= 2
      ? "грубые ступени"
      : hyper.depth >= 8
        ? "глубокое дерево, мелкие листья"
        : "умеренная глубина";
  }
  return "";
};


// Человеческое описание текущей модели для подписи под графиком.
BV.modelPhrase = function (kind, h) {
  if (kind === "poly") return `полином степени ${h.degree}`;
  if (kind === "ridge") return `полином степени ${h.degree} с L2-регуляризацией λ = ${h.lambda}`;
  if (kind === "knn") return `k-NN, усредняющий ${h.k} ${h.k === 1 ? "ближайшую точку" : h.k < 5 ? "ближайшие точки" : "ближайших точек"}`;
  if (kind === "kernel") return `ядерное сглаживание с шириной окна ${h.bandwidth}`;
  if (kind === "tree") return `решающее дерево глубины ${h.depth} (минимум ${h.minLeaf} ${h.minLeaf === 1 ? "точка" : h.minLeaf < 5 ? "точки" : "точек"} в листе)`;
  return "";
};
