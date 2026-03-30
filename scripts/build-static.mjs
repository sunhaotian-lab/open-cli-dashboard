import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const OUTPUT_FILE = path.join(PUBLIC_DIR, "data.json");

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const STAR_HISTORY_REFRESH_MS = 12 * 60 * 60 * 1000;
const HISTORY_LIMIT = 40;

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

async function fetchRepo(repo) {
  const response = await fetch(repo.url, {
    headers: {
      "User-Agent": "open-cli-dashboard-static-builder/1.0",
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
    color: pathMatches[index]?.[1] ?? repo.accent,
    d: pathMatches[index]?.[2] ?? ""
  }));

  return {
    fetchedAt: new Date().toISOString(),
    refreshIntervalMs: STAR_HISTORY_REFRESH_MS,
    source: "star-history.com",
    sourceUrl: getStarHistoryUrl(),
    plot: {
      width: 700,
      height: 423.333
    },
    xTicks,
    yTicks,
    series
  };
}

async function fetchStarHistory() {
  const response = await fetch(getStarHistoryUrl(), {
    headers: {
      "User-Agent": "open-cli-dashboard-static-builder/1.0",
      Accept: "image/svg+xml,text/plain;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`Star History responded with ${response.status}`);
  }

  const svg = await response.text();
  return parseStarHistory(svg);
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const repos = await Promise.all(REPOS.map((repo) => fetchRepo(repo)));
  const summary = summarize(repos);
  const starHistory = await fetchStarHistory();

  const payload = {
    mode: "static",
    fetchedAt,
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    source: "GitHub repository pages",
    repos,
    summary,
    history: [
      {
        timestamp: fetchedAt,
        repos: repos.map((repo) => ({
          id: repo.id,
          label: repo.platformLabel,
          stars: repo.stars,
          issues: repo.issues,
          prs: repo.prs
        }))
      }
    ].slice(-HISTORY_LIMIT),
    starHistory
  };

  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote static dashboard data to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
