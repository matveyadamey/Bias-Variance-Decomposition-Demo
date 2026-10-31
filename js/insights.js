window.BV = window.BV || {};
var BV = window.BV;

BV.regimeOf = function (stats) {
  const { bias2, variance, trainMse, testMse, noise } = stats;
  const gap = testMse - trainMse;
  if (variance > bias2 * 1.65 && (gap > 0.35 * testMse || trainMse < 0.7 * noise)) {
    return "overfit";
  }
  if (bias2 > variance * 1.65) return "underfit";
  if (gap > 0.45 * Math.max(testMse, 1e-6) && variance > bias2) return "overfit";
  return "balanced";
};

BV.regimeCopy = {
  underfit: {
    kicker: "недообучение · high bias",
    title: "Модель слишком простая для этой зависимости",
    body:
      "Модель не может повторить форму истинной зависимости, поэтому все выборки ошибаются одинаково: среднее предсказание (жёлтая) систематически проходит мимо истины (зелёная пунктирная). Разброс маленький — модели согласны друг с другом, но согласны в упрощении. Добавление данных тут почти не поможет: нужна более гибкая модель.",
  },
  overfit: {
    kicker: "переобучение · high variance",
    title: "Модель подогналась под шум",
    body:
      "Из-за слишком большой сложности модель подогналась под шум конкретной выборки и переобучилась: на разных выборках получаются заметно разные кривые (веер серых линий), поэтому variance высокий. Ошибка на обучении маленькая, а на новых данных — большая. Помогут упрощение модели, регуляризация или больше данных.",
  },
  balanced: {
    kicker: "рабочий компромисс",
    title: "Сложность модели близка к оптимальной",
    body:
      "Гибкости хватает, чтобы повторить форму зависимости, и не хватает, чтобы выучить каждую случайную точку. Это не «идеал навсегда»: другая зависимость, другое n или другой σ сдвинут оптимум.",
  },
};

BV.buildWhy = function (stats, ctx) {
  const f = BV.format;
  const items = [];
  const total = Math.max(stats.total, 1e-9);
  const pB = Math.round((100 * stats.bias2) / total);
  const pV = Math.round((100 * stats.variance) / total);
  const pN = Math.round((100 * stats.noise) / total);
  const gap = stats.testMse - stats.trainMse;
  const regime = ctx.regime || BV.regimeOf(stats);

  // 1. Состав ошибки и кто в ней главный.
  let lead;
  if (stats.noise > 0.45 * total && stats.bias2 < 0.3 * total && stats.variance < 0.3 * total) {
    lead = "Основная часть — неустранимый шум: дальше крутить модель почти бессмысленно.";
  } else if (stats.bias2 > stats.variance) {
    lead = "Смещение больше разброса: модели с разных выборок похожи и одинаково упрощают форму.";
  } else {
    lead = "Разброс не меньше смещения: ошибка живёт в том, что модели с разных выборок не согласны друг с другом.";
  }
  items.push(`<b>Состав ошибки.</b> Смещение ${pB}%, разброс ${pV}%, шум ${pN}%. ${lead}`);

  // 2. Где именно.
  if (ctx.where) {
    items.push(`<b class="t-var">Где разброс.</b> ${ctx.where.varText}`);
    items.push(`<b class="t-bias">Где смещение.</b> ${ctx.where.biasText}`);
  }

  // 3. Запоминает ли модель шум.
  if (gap > 0.3 * Math.max(stats.testMse, 1e-6) && stats.trainMse < stats.noise * 0.95) {
    items.push(`<b>Модель запомнила шум.</b> Ошибка на обучении ${f(stats.trainMse)} ниже уровня шума σ² = ${f(stats.noise)} — честная модель так не может: она выучила случайные отклонения ε, а не f(x). Поэтому на новых точках ошибка ${f(stats.testMse)}.`);
  } else if (gap > 0.15 * Math.max(stats.testMse, 1e-6)) {
    items.push(`<b>Зазор тест − обучение = ${f(gap)}.</b> Часть шума выборки модель всё же выучила, но ниже уровня σ² обучение не опустилось.`);
  } else {
    items.push(`<b>Шум не запомнен.</b> Обучение ${f(stats.trainMse)} и тест ${f(stats.testMse)} близки: модель описывает форму, а не случайности выборки.`);
  }

  // 4. Куда двигать гибкость.
  if (regime === "overfit") {
    items.push("<b>Гибкость сейчас вредит.</b> Ещё более сложная модель только расширит веер кривых — сначала упростите, добавьте регуляризацию или данные.");
  } else if (regime === "underfit") {
    items.push("<b>Вредит жёсткость, а не гибкость.</b> Больше параметров снизит Bias² сильнее, чем поднимет Variance.");
  } else {
    items.push("<b>Гибкость в балансе.</b> Шаг в сторону сложности поднимет разброс, шаг в сторону простоты — смещение. Это видно на U-кривой ниже.");
  }

  // 5. Особенности модели и данных.
  if (ctx.kind === "poly" && ctx.hyper.degree >= 8 && ctx.n < 40) {
    items.push("Высокая степень при малом n почти интерполирует точки — классический источник разброса.");
  }
  if (ctx.kind === "knn" && ctx.hyper.k === 1) {
    items.push("k = 1 копирует метку ближайшей точки вместе с её шумом: смещение минимально, разброс максимален.");
  }
  if (ctx.kind === "tree" && ctx.hyper.depth >= 8) {
    items.push("Глубокое дерево режет ось на мелкие куски и в каждом листе запоминает локальный шум.");
  }
  if (ctx.kind === "ridge" && ctx.hyper.lambda >= 12) {
    items.push("Большая λ сжимает коэффициенты к нулю: это намеренное смещение ради меньшего разброса.");
  }
  if (ctx.kind === "kernel" && ctx.hyper.bandwidth <= 0.06) {
    items.push("Узкое ядро почти не смешивает соседей — поведение как у k-NN с малым k.");
  }
  if (ctx.truthKey === "step") {
    items.push(
      ctx.kind === "poly" || ctx.kind === "ridge"
        ? "Глобальный гладкий полином «звенит» вокруг разрыва — часть смещения неустранима. Дерево, k-NN или ядро не обязаны быть одной гладкой кривой на всём [0, 1] и ловят скачок лучше."
        : "Скачок хорошо подходит локальным моделям: они не обязаны быть одной гладкой кривой на всём [0, 1]."
    );
  }

  if (ctx.noiseKey === "hetero") {
    items.push("<b>Шум растёт слева направо.</b> Справа точки разбросаны сильнее, поэтому и модели с разных выборок расходятся там больше.");
  }
  if (ctx.noiseKey === "outliers") {
    items.push("<b>В данных есть выбросы.</b> Гибкие модели (малое k, глубокое дерево, высокая степень) тянутся к каждому выбросу — это добавляет разброс. Усреднение по многим точкам гасит их влияние.");
  }

  // 6. Сходится ли разложение.
  if (Math.abs(stats.testMse - stats.total) <= 0.2 * Math.max(stats.total, stats.testMse, 0.05)) {
    items.push(`<b>Разложение сходится.</b> Тест ${f(stats.testMse)} ≈ Bias² + Var + σ² = ${f(stats.total)}.`);
  } else {
    items.push(`<b>Разложение пока неточно:</b> тест ${f(stats.testMse)}, а сумма ${f(stats.total)}. Добавьте выборок — оценка станет надёжнее.`);
  }
  return items;
};

BV.PRESETS = [
  {
    id: "under",
    label: "Недообучение",
    state: { truth: "wiggle", model: "poly", degree: 1, n: 40, sigma: 0.2, trials: 16, seed: 7 },
  },
  {
    id: "sweet",
    label: "Золотая середина",
    state: { truth: "sine", model: "poly", degree: 4, n: 35, sigma: 0.22, trials: 18, seed: 3 },
  },
  {
    id: "over",
    label: "Переобучение",
    // 15 параметров на 15 точек: модель проходит через каждую точку, включая выброс.
    state: { truth: "sine", model: "poly", degree: 14, n: 15, sigma: 0.2, noise: "outliers", trials: 16, seed: 19 },
  },
  {
    id: "data",
    label: "Та же модель, больше данных",
    // Не фиксированный опыт: берёт текущие настройки и меняет только размер выборки.
    apply: (cfg) => ({ n: cfg.n >= 200 ? 240 : 200 }),
  },
  {
    id: "ridge",
    label: "Регуляризация",
    state: { truth: "sine", model: "ridge", degree: 9, lambda: 0.5, n: 22, sigma: 0.22, trials: 16, seed: 11 },
  },
  {
    id: "knn1",
    label: "k-NN, k = 1",
    state: { truth: "sine", model: "knn", k: 1, n: 28, sigma: 0.3, trials: 16, seed: 5 },
  },
  {
    id: "tree",
    label: "Глубокое дерево",
    state: { truth: "poly", model: "tree", depth: 10, minLeaf: 1, n: 24, sigma: 0.25, trials: 14, seed: 9 },
  },
  {
    id: "jump",
    label: "Скачок: полином",
    state: { truth: "step", model: "poly", degree: 5, n: 60, sigma: 0.18, trials: 16, seed: 4 },
  },
  {
    id: "jumptree",
    label: "Скачок: дерево",
    state: { truth: "step", model: "tree", depth: 2, minLeaf: 3, n: 60, sigma: 0.18, trials: 16, seed: 4 },
  },
];
