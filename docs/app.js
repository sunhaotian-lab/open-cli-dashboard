const SVG_NS = "http://www.w3.org/2000/svg";

const cardsGrid = document.querySelector("#cardsGrid");
const tableBody = document.querySelector("#tableBody");
const historyList = document.querySelector("#historyList");
const refreshButton = document.querySelector("#refreshButton");
const autoRefreshCheckbox = document.querySelector("#autoRefresh");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector("#statusDot");
const sourceText = document.querySelector("#sourceText");
const updatedAtText = document.querySelector("#updatedAtText");
const curveLegend = document.querySelector("#curveLegend");
const curveMeta = document.querySelector("#curveMeta");
const curveChart = document.querySelector("#curveChart");

const AUTO_REFRESH_MS = 60 * 60 * 1000;
const CHART_MARGIN = {
  top: 18,
  right: 18,
  bottom: 40,
  left: 56
};
const CHART_PLOT_WIDTH = 940;
const CHART_PLOT_HEIGHT = 236;

const chartSampler = document.createElementNS(SVG_NS, "svg");
chartSampler.setAttribute("width", "0");
chartSampler.setAttribute("height", "0");
chartSampler.setAttribute("aria-hidden", "true");
chartSampler.style.position = "absolute";
chartSampler.style.width = "0";
chartSampler.style.height = "0";
chartSampler.style.opacity = "0";
chartSampler.style.pointerEvents = "none";
document.body.append(chartSampler);

let autoRefreshTimer = null;
let latestPayload = null;

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(isoString) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(isoString));
}

function setStatus(message, type = "loading") {
  statusText.textContent = message;
  statusDot.dataset.state = type;
}

function renderCards(repos) {
  const maxStars = Math.max(...repos.map((repo) => repo.stars), 1);
  const maxHeat = Math.max(...repos.map((repo) => repo.heat), 1);

  cardsGrid.innerHTML = repos
    .map((repo) => {
      const starRatio = Math.max((repo.stars / maxStars) * 100, 8);
      const heatRatio = Math.max((repo.heat / maxHeat) * 100, 8);

      return `
        <article class="repo-card" style="--accent:${repo.accent}">
          <div class="repo-head">
            <div>
              <p class="platform-badge">${repo.platformLabel}</p>
              <h3>${repo.name}</h3>
            </div>
            <a href="${repo.url}" target="_blank" rel="noreferrer">${repo.slug}</a>
          </div>

          <p class="repo-description">${repo.description}</p>

          <div class="metric-grid">
            <div class="metric-tile">
              <span>Stars</span>
              <strong>${formatNumber(repo.stars)}</strong>
            </div>
            <div class="metric-tile">
              <span>Open Issues</span>
              <strong>${formatNumber(repo.issues)}</strong>
            </div>
            <div class="metric-tile">
              <span>Open PRs</span>
              <strong>${formatNumber(repo.prs)}</strong>
            </div>
          </div>

          <div class="bar-group">
            <div class="bar-row">
              <span>Star share</span>
              <div class="bar-track"><div class="bar-fill" style="width:${starRatio}%"></div></div>
            </div>
            <div class="bar-row">
              <span>Heat</span>
              <div class="bar-track muted"><div class="bar-fill" style="width:${heatRatio}%"></div></div>
            </div>
          </div>

          <div class="repo-foot">
            <span class="mono">Heat ${repo.heat.toFixed(1)}</span>
            <span class="mono">${repo.openConversations} open conversations</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTable(repos) {
  const sorted = [...repos].sort((a, b) => b.stars - a.stars);

  tableBody.innerHTML = sorted
    .map(
      (repo) => `
        <tr>
          <td>${repo.platformLabel}</td>
          <td><a href="${repo.url}" target="_blank" rel="noreferrer">${repo.slug}</a></td>
          <td>${formatNumber(repo.stars)}</td>
          <td>${formatNumber(repo.issues)}</td>
          <td>${formatNumber(repo.prs)}</td>
          <td>${repo.heat.toFixed(1)}</td>
        </tr>
      `
    )
    .join("");
}

function renderHistory(history) {
  const recent = [...history].reverse().slice(0, 8);

  historyList.innerHTML = recent
    .map((snapshot) => {
      const lines = snapshot.repos
        .map((repo) => `${repo.label ?? repo.id}: ★${repo.stars} / I${repo.issues} / PR${repo.prs}`)
        .join("  ·  ");

      return `
        <article class="history-item">
          <div class="history-time mono">${formatDate(snapshot.timestamp)}</div>
          <div class="history-body mono">${lines}</div>
        </article>
      `;
    })
    .join("");
}

function samplePathPoints(d, segments = 120) {
  chartSampler.replaceChildren();
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  chartSampler.append(path);

  const totalLength = path.getTotalLength();
  const points = [];

  for (let index = 0; index <= segments; index += 1) {
    const point = path.getPointAtLength((totalLength * index) / segments);
    points.push({ x: point.x, y: point.y });
  }

  return points;
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildPathFromPoints(points) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function alignSeriesTail(points, targetX, tailSize = 8) {
  if (points.length === 0) {
    return points;
  }

  const lastIndex = points.length - 1;
  const delta = targetX - points[lastIndex].x;

  if (Math.abs(delta) < 0.1) {
    return points;
  }

  const startIndex = Math.max(0, lastIndex - tailSize + 1);

  return points.map((point, index) => {
    if (index < startIndex) {
      return point;
    }

    const weight = (index - startIndex + 1) / (lastIndex - startIndex + 1);

    return {
      ...point,
      x: point.x + delta * weight
    };
  });
}

function niceNumber(value, round) {
  const exponent = Math.floor(Math.log10(value || 1));
  const fraction = value / 10 ** exponent;
  let niceFraction;

  if (round) {
    if (fraction < 1.5) {
      niceFraction = 1;
    } else if (fraction < 3) {
      niceFraction = 2;
    } else if (fraction < 7) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }
  } else if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  return niceFraction * 10 ** exponent;
}

function createYAxis(maxValue, tickCount = 6) {
  const safeMax = Math.max(maxValue, 1);
  const step = niceNumber(safeMax / Math.max(tickCount - 1, 1), true);
  const max = Math.ceil(safeMax / step) * step;
  const ticks = [];

  for (let value = 0; value <= max + step / 2; value += step) {
    ticks.push(value);
  }

  return { max, ticks };
}

function formatAxisValue(value) {
  if (value === 0) {
    return "0";
  }

  if (value >= 1000) {
    const compact = value / 1000;
    return Number.isInteger(compact) ? `${compact}K` : `${compact.toFixed(1)}K`;
  }

  return String(value);
}

function transformStarHistorySeries(starHistory, repos) {
  const liveRepoMap = new Map(repos.map((repo) => [repo.id, repo]));
  const rawWidth = starHistory.plot.width;
  const rawHeight = starHistory.plot.height;

  const sampledSeries = starHistory.series.map((series) => {
    const samples = samplePathPoints(series.d, 180);
    const tail = samples.slice(-6);
    const endPoint = {
      x: average(tail.map((point) => point.x)),
      y: average(tail.map((point) => point.y))
    };

    return {
      ...series,
      samples,
      endPoint
    };
  });

  const calibrationPairs = sampledSeries
    .map((series) => {
      const repo = liveRepoMap.get(series.id);

      if (!repo) {
        return null;
      }

      return {
        raw: Math.max(rawHeight - series.endPoint.y, 1),
        stars: repo.stars
      };
    })
    .filter(Boolean);

  const scale =
    calibrationPairs.reduce((sum, pair) => sum + pair.raw * pair.stars, 0) /
    Math.max(
      calibrationPairs.reduce((sum, pair) => sum + pair.raw ** 2, 0),
      1
    );

  const estimateStars = (rawY) => Math.max(0, (rawHeight - rawY) * scale);
  const estimatedMax = Math.max(
    ...sampledSeries.flatMap((series) => series.samples.map((point) => estimateStars(point.y))),
    ...repos.map((repo) => repo.stars)
  );
  const axis = createYAxis(estimatedMax, 6);

  const series = sampledSeries.map((series) => {
    const transformedPoints = series.samples.map((point) => ({
      x: (point.x / rawWidth) * CHART_PLOT_WIDTH,
      y: CHART_PLOT_HEIGHT - (estimateStars(point.y) / axis.max) * CHART_PLOT_HEIGHT
    }));
    const alignedPoints = alignSeriesTail(transformedPoints, CHART_PLOT_WIDTH);

    return {
      ...series,
      d: buildPathFromPoints(alignedPoints),
      endPoint: alignedPoints.at(-1)
    };
  });

  const xTicks = starHistory.xTicks.map((tick) => ({
    ...tick,
    x: (tick.x / rawWidth) * CHART_PLOT_WIDTH
  }));

  const yTicks = axis.ticks.map((value) => ({
    value,
    label: formatAxisValue(value),
    y: CHART_PLOT_HEIGHT - (value / axis.max) * CHART_PLOT_HEIGHT
  }));

  return {
    series,
    xTicks,
    yTicks,
    axisMax: axis.max
  };
}

function createSvgNode(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);

  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });

  return node;
}

function renderCurveLegend(series, repos) {
  const repoMap = new Map(repos.map((repo) => [repo.id, repo]));

  curveLegend.innerHTML = series
    .map((item) => {
      const live = repoMap.get(item.id);

      return `
        <article class="curve-legend-item">
          <span class="curve-swatch" style="--swatch:${live?.accent ?? item.color}"></span>
          <div>
            <strong>${live?.platformLabel ?? item.label}</strong>
            <span>${live?.name ?? item.name}</span>
          </div>
          <span class="mono">${live ? formatNumber(live.stars) : "-"}</span>
        </article>
      `;
    })
    .join("");
}

function renderCurvePlaceholder(message) {
  curveChart.setAttribute("viewBox", "0 0 800 180");
  curveChart.innerHTML = `
    <rect x="0" y="0" width="800" height="180" rx="24" fill="rgba(255,255,255,0.78)"></rect>
    <text x="400" y="96" text-anchor="middle" class="curve-empty">${message}</text>
  `;
}

function renderCurveChart(starHistory, repos, starHistoryError) {
  if (!starHistory) {
    curveLegend.innerHTML = "";
    curveMeta.textContent = starHistoryError
      ? `历史曲线暂不可用: ${starHistoryError}`
      : "历史曲线加载中";
    renderCurvePlaceholder("历史曲线暂时不可用");
    return;
  }

  const transformedChart = transformStarHistorySeries(starHistory, repos);
  const plotWidth = CHART_PLOT_WIDTH;
  const plotHeight = CHART_PLOT_HEIGHT;
  const outerWidth = CHART_MARGIN.left + plotWidth + CHART_MARGIN.right;
  const outerHeight = CHART_MARGIN.top + plotHeight + CHART_MARGIN.bottom;
  const { series, xTicks, yTicks } = transformedChart;

  renderCurveLegend(series, repos);
  curveMeta.textContent = `历史源: ${starHistory.source} · 更新时间 ${formatDate(
    starHistory.fetchedAt
  )}`;

  if (starHistoryError) {
    curveMeta.textContent += ` · 最近一次历史刷新失败，当前展示缓存`;
  }

  curveChart.setAttribute("viewBox", `0 0 ${outerWidth} ${outerHeight}`);
  curveChart.innerHTML = "";

  const defs = createSvgNode("defs");
  const backgroundGradient = createSvgNode("linearGradient", {
    id: "curvePanelGradient",
    x1: "0%",
    y1: "0%",
    x2: "100%",
    y2: "100%"
  });
  backgroundGradient.append(
    createSvgNode("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": "0.94" })
  );
  backgroundGradient.append(
    createSvgNode("stop", { offset: "100%", "stop-color": "#f8efe2", "stop-opacity": "0.86" })
  );
  defs.append(backgroundGradient);
  curveChart.append(defs);

  const plotGroup = createSvgNode("g", {
    transform: `translate(${CHART_MARGIN.left} ${CHART_MARGIN.top})`
  });

  const panel = createSvgNode("rect", {
    x: 0,
    y: 0,
    width: outerWidth,
    height: outerHeight,
    rx: 28,
    fill: "transparent"
  });
  curveChart.append(panel);

  plotGroup.append(
    createSvgNode("rect", {
      x: 0,
      y: 0,
      width: plotWidth,
      height: plotHeight,
      rx: 8,
      fill: "url(#curvePanelGradient)",
      stroke: "rgba(28,42,57,0.09)"
    })
  );

  yTicks.forEach((tick) => {
    plotGroup.append(
      createSvgNode("line", {
        x1: 0,
        y1: tick.y,
        x2: plotWidth,
        y2: tick.y,
        class: "curve-grid-line"
      })
    );

    const label = createSvgNode("text", {
      x: -14,
      y: tick.y + 4,
      "text-anchor": "end",
      class: "curve-axis-label"
    });
    label.textContent = tick.label;
    plotGroup.append(label);
  });

  xTicks.forEach((tick) => {
    plotGroup.append(
      createSvgNode("line", {
        x1: tick.x,
        y1: 0,
        x2: tick.x,
        y2: plotHeight,
        class: "curve-grid-line vertical"
      })
    );

    const label = createSvgNode("text", {
      x: tick.x,
      y: plotHeight + 26,
      "text-anchor": "middle",
      class: "curve-axis-label"
    });
    label.textContent = tick.label;
    plotGroup.append(label);
  });

  const highlightBand = createSvgNode("rect", {
    x: plotWidth - 96,
    y: 0,
    width: 96,
    height: plotHeight,
    fill: "rgba(255, 107, 44, 0.04)"
  });
  plotGroup.append(highlightBand);

  series.forEach((item) => {
    const line = createSvgNode("path", {
      d: item.d,
      fill: "none",
      stroke: repos.find((repo) => repo.id === item.id)?.accent ?? item.color,
      "stroke-width": 4,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "curve-line"
    });

    plotGroup.append(line);

    if (item.endPoint) {
      plotGroup.append(
        createSvgNode("circle", {
          cx: item.endPoint.x,
          cy: item.endPoint.y,
          r: 5.5,
          fill: "#ffffff",
          stroke: repos.find((repo) => repo.id === item.id)?.accent ?? item.color,
          "stroke-width": 3
        })
      );
    }
  });

  const axisLabel = createSvgNode("text", {
    x: 0,
    y: -4,
    class: "curve-axis-title"
  });
  axisLabel.textContent = "Stars";
  plotGroup.append(axisLabel);

  const bottomLabel = createSvgNode("text", {
    x: plotWidth / 2,
    y: plotHeight + 30,
    "text-anchor": "middle",
    class: "curve-axis-title"
  });
  bottomLabel.textContent = "Date";
  plotGroup.append(bottomLabel);

  curveChart.append(plotGroup);
}

function render(payload) {
  latestPayload = payload;
  renderCurveChart(payload.starHistory, payload.repos, payload.starHistoryError);
  renderCards(payload.repos);
  renderTable(payload.repos);
  renderHistory(payload.history ?? []);

  sourceText.textContent = `实时源: ${payload.source} · 轮询周期 ${Math.round(
    payload.refreshIntervalMs / 60000
  )} 分钟`;
  updatedAtText.textContent = `最后更新: ${formatDate(payload.fetchedAt)}`;

  if (payload.stale) {
    setStatus(`抓取失败，当前展示缓存数据: ${payload.refreshError}`, "warning");
  } else {
    setStatus("数据已同步", "ok");
  }
}

async function loadData(force = false) {
  setStatus(force ? "正在强制刷新..." : "正在同步最新数据...", "loading");

  try {
    const apiUrl = new URL(force ? "./api/repos?force=1" : "./api/repos", window.location.href);
    const staticUrl = new URL("./data.json", window.location.href);

    let response = await fetch(apiUrl, { cache: "no-store" });

    if (!response.ok) {
      response = await fetch(staticUrl, { cache: "no-store" });
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    render(payload);
  } catch (error) {
    if (latestPayload) {
      setStatus(`刷新失败，继续展示上次数据: ${error.message}`, "warning");
      return;
    }

    setStatus(`加载失败: ${error.message}`, "error");
    renderCurvePlaceholder("实时数据加载失败");
  }
}

function syncAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  if (autoRefreshCheckbox.checked) {
    autoRefreshTimer = setInterval(() => {
      loadData(false);
    }, AUTO_REFRESH_MS);
  }
}

refreshButton.addEventListener("click", () => {
  loadData(true);
});

autoRefreshCheckbox.addEventListener("change", syncAutoRefresh);
syncAutoRefresh();
loadData(false);
