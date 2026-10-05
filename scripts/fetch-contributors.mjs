import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "../src/generated/contributors.json");

function writeContributors(contributors) {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(contributors, null, 2) + "\n");
}

const REPO = "Nan-WenYuan/personal-notes-dev";
const API_URL = `https://api.github.com/repos/${REPO}/contributors?per_page=100`;

async function fetchContributors() {
  const headers = { "User-Agent": "floral-notepaper-build" };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(API_URL, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  return data
    .filter((u) => u.type !== "Bot")
    .map((u) => ({
      login: u.login,
      avatar_url: u.avatar_url,
      html_url: u.html_url,
    }));
}

try {
  const contributors = await fetchContributors();
  writeContributors(contributors);
  console.log(`[contributors] wrote ${contributors.length} contributors`);
} catch (err) {
  // Never reuse a cache from the upstream project after changing repository.
  writeContributors([
    {
      login: "Nan-WenYuan",
      avatar_url: "https://github.com/Nan-WenYuan.png",
      html_url: "https://github.com/Nan-WenYuan",
    },
  ]);
  console.warn(
    `[contributors] ${REPO} unavailable (${err.message}), using repository owner fallback`,
  );
}
