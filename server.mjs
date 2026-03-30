import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3487);
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const STAR_HISTORY_REFRESH_MS = 12 * 60 * 60 * 1000;
const HISTORY_LIMIT = 720;
const STAR_HISTORY_PLOT_WIDTH = 700;
const STAR_HISTORY_PLOT_HEIGHT = 423.333;

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

const REPOS = [
  {
    id: "feishu",
    platform: "Feishu",
    platformLabel: "飞书",
    name: "Feishu CLI",
    slug: "larksuite/cli",
    url: "https://github.com/larksuite/cli",
    accent: "#00C3FF",
    description: "Lark/Feishu Open Platform CLI"
  },
  {
    id: "dingtalk",
    platform: "DingTalk",
    platformLabel: "钉钉",
    name: "DingTalk Workspace CLI",
    slug: "DingTalk-Real-AI/dingtalk-workspace-cli",
    url: "https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli",
    accent: "#1677FF",
    description: "Officially open-sourced DingTalk workspace CLI"
  },
  {
    id: "wecom",
    platform: "WeCom",
    platformLabel: "企微",
    name: "WeCom CLI",
    slug: "WecomTeam/wecom-cli",
    url: "https://github.com/WecomTeam/wecom-cli",
    accent: "#07C160",
    description: "Enterprise WeChat command line interface"
  }
];

let cache = null;
let refreshPromise = null;
let starHistoryCache = null;
let starHistoryPromise = null;

function json(response, statusCode = 200) {
  return new Response(JSON.stringify(response), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function text(response, statusCode = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(response, {
    status: statusCode,
    headers: {
      "Content-Type": contentType
    }
  });
}

function normalizeCounter(rawValue) {
  if (!rawValue) {
    return 0;
  }

  const value = rawValue.trim().toLowerCase().replace(/,/g, "");

  if (value.endsWith("k")) {
    return Math.round(Number.parseFloat(value) * 1000);
  }

  if (value.endsWith("m")) {
    return Math.round(Number.parseFloat(value) * 1000000);
  }

  return Number.parseInt(value, 10);
}

function extractCount(html, id) {
  const titlePattern = new RegExp(`id="${id}"[^>]*title="([^"]+)"`, "i");
  const titleMatch = html.match(titlePattern);

  if (titleMatch) {
    return normalizeCounter(titleMatch[1]);
  }

  const textPattern = new RegExp(`id="${id}"[^>]*>([^<]+)<`, "i");
  const textMatch = html.match(textPattern);

  if (textMatch) {
    return normalizeCounter(textMatch[1]);
  }

  throw new Error(`Unable to parse ${id}`);
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);
}

function computeHeat(repo) {
  return repo.issues * 2 + repo.prs * 3 + repo.stars / 250;
}

async function fetchRepo(repo) {
  const response = await fetch(repo.url, {
    headers: {
      "User-Agent": "open-cli-dashboard/1.0",
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub responded with ${response.status} for ${repo.slug}`);
  }

  const html = await response.text();
  const stars = extractCount(html, "repo-stars-counter-star");
  const issues = extractCount(html, "issues-repo-tab-count");
  const prs = extractCount(html, "pull-requests-repo-tab-count");

  return {
    ...repo,
    stars,
    issues,
    prs,
    openConversations: issues + prs,
    heat: Number(computeHeat({ stars, issues, prs }).toFixed(1)),
    starsLabel: formatCompactNumber(stars)
  };
}

function getStarHistoryUrl() {
  const slugList = REPOS.map((repo) => repo.slug.toLowerCase()).join(",");
  return `https://api.star-history.com/svg?repos=${encodeURIComponent(slugList)}&type=Date`;
}

function extractMatches(input, pattern) {
  return [...input.matchAll(pattern)];
}

function parseStarHistory(svg) {
  const pathMatches = extractMatches(
    svg,
    /<path fill="none" stroke="(#[0-9a-fA-F]+)" d="([^"]+)" class="xkcd-chart-xyline"/g
  );
  const xTickMatches = extractMatches(
    svg,
    /<text[^>]*class="tick"[^>]*transform="translate\(([-\d.]+) 423\.333\)"[^>]*>([^<]*)<\/text>/g
  );
  const yTickMatches = extractMatches(
    svg,
    /<text x="-7"[^>]*transform="translate\(0 ([-\d.]+)\)"[^>]*>([^<]*)<\/text>/g
  );

  if (pathMatches.length < REPOS.length) {
    throw new Error("Unable to parse star history series");
  }

  const xTicks = xTickMatches.map((match) => ({
    x: Number(match[1]),
    label: match[2].trim()
  }));

  const yTicks = yTickMatches
    .map((match) => ({
      y: Number(match[1]),
      label: match[2].trim()
    }))
    .filter((tick) => tick.label.length > 0);

  const series = REPOS.map((repo, index) => ({
    id: repo.id,
    slug: repo.slug,
    label: repo.platformLabel,
    name: repo.name,
    color: pathMatches[index][1],
    d: pathMatches[index][2]
  }));

  return {
    fetchedAt: new Date().toISOString(),
    source: "star-history.com",
    sourceUrl: getStarHistoryUrl(),
    plot: {
      width: STAR_HISTORY_PLOT_WIDTH,
      height: STAR_HISTORY_PLOT_HEIGHT
    },
    xTicks,
    yTicks,
    series
  };
}

async function fetchStarHistory() {
  const response = await fetch(getStarHistoryUrl(), {
    headers: {
      "User-Agent": "open-cli-dashboard/1.0",
      Accept: "image/svg+xml,text/plain;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`Star History responded with ${response.status}`);
  }

  const svg = await response.text();
  return parseStarHistory(svg);
}

async function getStarHistory() {
  if (starHistoryPromise) {
    return starHistoryPromise;
  }

  const isExpired =
    !starHistoryCache ||
    Date.now() - new Date(starHistoryCache.fetchedAt).getTime() > STAR_HISTORY_REFRESH_MS;

  if (!isExpired) {
    return starHistoryCache;
  }

  starHistoryPromise = (async () => {
    starHistoryCache = await fetchStarHistory();
    return starHistoryCache;
  })();

  try {
    return await starHistoryPromise;
  } finally {
    starHistoryPromise = null;
  }
}

async function readHistory() {
  try {
    const content = await fs.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    return [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeHistory(history) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function summarize(repos) {
  const totalStars = repos.reduce((sum, repo) => sum + repo.stars, 0);
  const totalIssues = repos.reduce((sum, repo) => sum + repo.issues, 0);
  const totalPrs = repos.reduce((sum, repo) => sum + repo.prs, 0);
  const sortedByStars = [...repos].sort((a, b) => b.stars - a.stars);
  const sortedByHeat = [...repos].sort((a, b) => b.heat - a.heat);

  return {
    totalStars,
    totalIssues,
    totalPrs,
    totalRepos: repos.length,
    starLeader: sortedByStars[0]?.slug ?? null,
    hottestRepo: sortedByHeat[0]?.slug ?? null
  };
}

async function refresh(force = false) {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const startedAt = new Date().toISOString();
    const repos = await Promise.all(REPOS.map((repo) => fetchRepo(repo)));
    const summary = summarize(repos);
    const history = await readHistory();

    history.push({
      timestamp: startedAt,
      repos: repos.map((repo) => ({
        id: repo.id,
        label: repo.platformLabel,
        stars: repo.stars,
        issues: repo.issues,
        prs: repo.prs
      }))
    });

    const trimmedHistory = history.slice(-HISTORY_LIMIT);
    await writeHistory(trimmedHistory);

    cache = {
      fetchedAt: startedAt,
      refreshIntervalMs: REFRESH_INTERVAL_MS,
      source: "GitHub repository pages",
      repos,
      summary,
      history: trimmedHistory.slice(-40)
    };

    return cache;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function getData(force = false) {
  let payload;

  if (!cache || force) {
    payload = await refresh(force);
  } else {
    const age = Date.now() - new Date(cache.fetchedAt).getTime();

    if (age > REFRESH_INTERVAL_MS) {
      try {
        payload = await refresh();
      } catch (error) {
        console.error("Refresh failed, serving stale cache:", error);
        payload = {
          ...cache,
          stale: true,
          refreshError: error.message
        };
      }
    } else {
      payload = cache;
    }
  }

  try {
    const starHistory = await getStarHistory();
    return {
      ...payload,
      starHistory
    };
  } catch (error) {
    console.error("Star history refresh failed:", error);
    return {
      ...payload,
      starHistory: starHistoryCache,
      starHistoryError: error.message
    };
  }
}

function lookupContentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }

  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
}

async function serveFile(urlPath) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  const relativePath = path.relative(PUBLIC_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return text("Forbidden", 403);
  }

  try {
    const content = await fs.readFile(filePath);
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": lookupContentType(filePath)
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return text("Not found", 404);
    }

    throw error;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/repos") {
      const force = url.searchParams.get("force") === "1";
      const data = await getData(force);
      const response = json(data);

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
      return;
    }

    if (url.pathname === "/healthz") {
      const response = json({
        ok: true,
        service: "open-cli-dashboard",
        fetchedAt: cache?.fetchedAt ?? null
      });

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
      return;
    }

    const response = await serveFile(url.pathname);
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(body);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});

refresh(true).catch((error) => {
  console.error("Initial refresh failed:", error);
});

setInterval(() => {
  refresh(true).catch((error) => {
    console.error("Scheduled refresh failed:", error);
  });
}, REFRESH_INTERVAL_MS);
