window.BV = window.BV || {};
var BV = window.BV;

BV.mulberry32 = function (seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

BV.gaussian = function (rng) {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

BV.mean = function (arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
};

BV.variance = function (arr) {
  if (arr.length < 2) return 0;
  const m = BV.mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    s += d * d;
  }
  return s / arr.length;
};

BV.linspace = function (a, b, n) {
  const out = new Array(n);
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = a + i * step;
  return out;
};

BV.clamp = function (x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
};

BV.format = function (x) {
  if (!Number.isFinite(x)) return "—";
  const ax = Math.abs(x);
  if (ax >= 100) return x.toFixed(1);
  if (ax >= 10) return x.toFixed(2);
  if (ax >= 1) return x.toFixed(3);
  return x.toFixed(4);
};

BV.scaleX = function (x) {
  return 2 * x - 1;
};

BV.chebyshev = function (x, degree) {
  const t = BV.scaleX(x);
  const row = new Array(degree + 1);
  row[0] = 1;
  if (degree >= 1) row[1] = t;
  for (let k = 2; k <= degree; k++) {
    row[k] = 2 * t * row[k - 1] - row[k - 2];
  }
  return row;
};

BV.solve = function (A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.slice().concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    const tmp = M[col];
    M[col] = M[pivot];
    M[pivot] = tmp;
    const diag = M[col][col];
    if (Math.abs(diag) < 1e-12) {
      M[col][col] = 1e-12;
    }
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
};

BV.FUNCTIONS = {
  linear: {
    name: "прямая линия",
    f: (x) => 1.6 * x - 0.8,
  },
  sigmoid: {
    name: "плавная ступенька",
    f: (x) => Math.tanh(9 * (x - 0.5)),
  },
  fast: {
    name: "быстрые колебания",
    f: (x) => Math.sin(6 * Math.PI * x),
  },
  chirp: {
    name: "ускоряющиеся колебания",
    f: (x) => Math.sin(2 * Math.PI * (0.5 * x + 2.5 * x * x)),
  },
  damped: {
    name: "затухающие колебания",
    f: (x) => 1.4 * Math.exp(-3 * x) * Math.sin(5 * Math.PI * x),
  },
  kink: {
    name: "излом",
    f: (x) => 3 * Math.abs(x - 0.5) - 0.7,
  },
  bump: {
    name: "узкий пик",
    f: (x) => 1.8 * Math.exp(-((x - 0.5) * (x - 0.5)) / (2 * 0.05 * 0.05)) - 0.5,
  },
  sine: {
    name: "синусоида",
    f: (x) => Math.sin(2 * Math.PI * x),
  },
  poly: {
    name: "кубический изгиб",
    f: (x) => 1.6 * (x - 0.15) * (x - 0.55) * (x - 1.05) * 6 + 0.15,
  },
  wiggle: {
    name: "две частоты",
    f: (x) => Math.sin(2 * Math.PI * x) + 0.35 * Math.sin(8 * Math.PI * x),
  },
  step: {
    name: "скачок",
    f: (x) => (x < 0.45 ? -0.55 : 0.7) + 0.15 * Math.sin(3 * Math.PI * x),
  },
};


// Шум нормирован так, что E[ε²] = σ² для любого типа: разложение остаётся честным.
BV.NOISE = {
  gauss: { name: "обычный", eps: (rng, x) => BV.gaussian(rng) },
  hetero: { name: "растущий", eps: (rng, x) => ((0.3 + 1.4 * x) / Math.sqrt(1.16333)) * BV.gaussian(rng) },
  outliers: { name: "с выбросами", eps: (rng, x) => (rng() < 0.1 ? 4 : 1) * BV.gaussian(rng) / Math.sqrt(2.5) },
};
