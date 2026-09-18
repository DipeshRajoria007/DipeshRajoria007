// Renders a 31-day contribution line graph as a static SVG.
// Replaces the hosted github-readme-activity-graph service, whose public
// deployment was disabled. Run by .github/workflows/activity-graph.yml.
//
// Usage: GITHUB_TOKEN=... GH_LOGIN=<user> node activity-graph.mjs <out.svg>

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const token = process.env.GITHUB_TOKEN;
const login = process.env.GH_LOGIN;
const outFile = process.argv[2] ?? "activity-graph.svg";
const DAYS = 31;

if (!token || !login) {
  console.error("GITHUB_TOKEN and GH_LOGIN are required");
  process.exit(1);
}

const theme = {
  bg: "#0D1117",
  text: "#00E5FF",
  line: "#FFEA00",
  point: "#E0E0E0",
  grid: "#21262D",
  muted: "#8B949E",
};

async function fetchDays() {
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - (DAYS - 1)));
  const query = `query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar { weeks { contributionDays { date contributionCount } } }
      }
    }
  }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login, from: from.toISOString(), to: to.toISOString() } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data?.user) {
    throw new Error(`GitHub API error (${res.status}): ${JSON.stringify(json.errors ?? json)}`);
  }
  const fromDate = from.toISOString().slice(0, 10);
  return json.data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .filter((d) => d.date >= fromDate)
    .slice(-DAYS);
}

function niceStep(max) {
  const raw = max / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return Math.max(1, Math.round(step));
}

// Monotone cubic interpolation (Fritsch–Carlson): smooth, but never
// overshoots the data, so the curve can't dip below zero.
function monotonePath(pts) {
  const n = pts.length;
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const m = [];
  for (let i = 0; i < n - 1; i++) m.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  const t = pts.map((_, i) =>
    i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2,
  );
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  const f = (v) => +v.toFixed(2);
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (pts[i + 1].x - pts[i].x) / 3;
    d += ` C${f(pts[i].x + h)},${f(pts[i].y + t[i] * h)} ${f(pts[i + 1].x - h)},${f(pts[i + 1].y - t[i + 1] * h)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

function render(days) {
  const W = 1200;
  const H = 420;
  const pad = { top: 80, right: 40, bottom: 64, left: 72 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const font = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;

  const max = Math.max(0, ...days.map((d) => d.contributionCount));
  const step = niceStep(Math.max(max, 4));
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const total = days.reduce((s, d) => s + d.contributionCount, 0);

  const x = (i) => pad.left + (days.length === 1 ? plotW / 2 : (i * plotW) / (days.length - 1));
  const y = (v) => pad.top + plotH - (v / yMax) * plotH;
  const pts = days.map((d, i) => ({ x: x(i), y: y(d.contributionCount) }));
  const line = monotonePath(pts);
  const baseline = pad.top + plotH;
  const area = `${line} L${pts.at(-1).x},${baseline} L${pts[0].x},${baseline} Z`;

  const grid = [];
  for (let v = 0; v <= yMax; v += step) {
    grid.push(
      `<line x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="${theme.grid}" stroke-width="1"/>`,
      `<text x="${pad.left - 14}" y="${y(v) + 4}" text-anchor="end" class="tick">${v}</text>`,
    );
  }
  const xLabels = days.map(
    (d, i) => `<text x="${x(i)}" y="${baseline + 22}" text-anchor="middle" class="tick">${Number(d.date.slice(8))}</text>`,
  );
  const points = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${theme.point}"/>`);

  const range = `${days[0].date} → ${days.at(-1).date}`;
  const title = `${login}'s Contribution Graph`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t">
<title id="t">${title}: ${total} contributions from ${range}</title>
<style>
  text { font-family: ${font}; fill: ${theme.muted}; }
  .title { fill: ${theme.text}; font-size: 22px; font-weight: 600; }
  .sub { font-size: 13px; }
  .tick { font-size: 12px; }
  .axis { fill: ${theme.text}; font-size: 13px; }
</style>
<defs>
  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${theme.line}" stop-opacity="0.28"/>
    <stop offset="100%" stop-color="${theme.line}" stop-opacity="0"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="6" fill="${theme.bg}"/>
<text x="${W / 2}" y="38" text-anchor="middle" class="title">${title}</text>
<text x="${W / 2}" y="60" text-anchor="middle" class="sub">${total} contributions · ${range}</text>
${grid.join("\n")}
<path d="${area}" fill="url(#fill)"/>
<path d="${line}" fill="none" stroke="${theme.line}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
${points.join("\n")}
${xLabels.join("\n")}
<text x="${pad.left + plotW / 2}" y="${H - 12}" text-anchor="middle" class="axis">Days</text>
<text transform="translate(22 ${pad.top + plotH / 2}) rotate(-90)" text-anchor="middle" class="axis">Contributions</text>
</svg>
`;
}

const days = await fetchDays();
if (days.length === 0) throw new Error("No contribution days returned");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, render(days));
console.log(`Wrote ${outFile} (${days.length} days, ${days.reduce((s, d) => s + d.contributionCount, 0)} contributions)`);
