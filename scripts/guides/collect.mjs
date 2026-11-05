// guides.json 을 만든다 — 무료 일정(소스 여럿)과 보관법(foods.json, 사람이 씀)을 합친다.
// myejin/pub-temp 저장소 루트에서 GitHub Action(guides.yml)이 매일 돌린다. 의존성 없이 Node 20 내장만 쓴다.
//
//   SEOUL_API_KEY=… TOURAPI_KEY=… TARGET_BRANCH=develop node scripts/guides/collect.mjs   (저장소 루트에서, guides.json 을 루트에 쓴다)
//   GUIDES_MOCK_DIR=scripts/guides/fixtures GUIDES_TODAY=2026-11-04 node scripts/guides/collect.mjs   (API 대신 저장해 둔 응답으로)
//
// 소스는 sources/ 에 하나씩 있다 — 서울 문화행사, 서울 공공서비스예약, 한국관광공사 축제(서울·경기). 공통 판정은 lib.mjs.
// 형식의 정본은 weekly-challenge 의 src/utils/guides.ts(parseGuidesFeed)다. 여기서 한 번 거르고, 앱이 또 거른다.
//
// 지키는 것:
//   · 소스 하나를 못 받으면 어제 guides.json 에서 그 소스 몫(id 머리말)을 가져와 오늘 날짜로 다시 거른다. 파일은 쓰되
//     Action 은 빨간불로 끝낸다(출력 failed) — 키가 만료돼도 조용히 지역 하나가 사라지지 않게. 모든 소스를 못 받았거나
//     0건이면 아무것도 쓰지 않고 실패한다 — 어제 파일이 그대로 남는다(앱은 빈 줄보다 낡은 줄이 낫다).
//   · 무료만(소스마다 판정이 다르다 — 입장료만 따로인 것은 넣는다), 오늘(서울)부터 30일 안에 시작하고 아직 안 끝났고
//     60일(+여유) 안에 끝나는 것만, 단체 전용·온라인·모집 공고는 뺀다(lib.mjs 의 notOuting).
//   · blocklist.json 의 낱말이 제목에 들어 있거나 id 가 같으면 뺀다.
//   · 소스끼리 같은 행사(titleKey 가 같고 날짜가 겹침)는 앞 소스 것만 남긴다 — 공공서비스예약(예약 링크·시간이 있다),
//     문화행사, 관광공사 순.
//   · 앱의 순서(sortEvents)로 놓고 소스별 상한, 그다음 전체 300건으로 자른다 — 앱은 앞 300건만 읽는다.
//   · 공식 사이트 주소는 앱의 parseSource 와 같은 조건만, 사진은 넣지 않는다(공공누리 유형 확인 없이 쓸 수 없다).
//   · main 에 쓸 때는 draft: true 인 보관법을 뺀다.
//   · 요청 주소는 로그에 찍지 않는다 — 키가 들어 있고 이 저장소는 공개라 Action 로그도 공개다.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  MAX_EVENTS,
  dateIssue,
  makeFetcher,
  notOuting,
  setOutput,
  sortForApp,
  summary,
  titleKey,
  windowFor,
} from "./lib.mjs";
import * as yeyak from "./sources/seoul-yeyak.mjs";
import * as culture from "./sources/seoul-culture.mjs";
import * as tour from "./sources/tour.mjs";

const FORMAT_VERSION = 1; // src/utils/guides.ts 의 GUIDES_FORMAT_VERSION
// 앞에 있을수록 겹칠 때 남는다. limit 은 소스별 상한 — 첫 실제 실행의 건수를 보고 맞춘다.
const SOURCES = [
  { mod: yeyak, limit: 75 },
  { mod: culture, limit: MAX_EVENTS },
  { mod: tour, limit: 80 },
];
const DATE_REASONS = new Set(["날짜 없음", "끝남", "30일 뒤 시작", "60일 넘게 이어짐"]);

const env = process.env;
const OUT = env.GUIDES_OUT || "guides.json";
const branch = env.TARGET_BRANCH ?? "develop";
const mockDir = env.GUIDES_MOCK_DIR || undefined;
const dryRun = env.DRY_RUN === "1";
const here = (name) => new URL(name, import.meta.url);
const now = env.GUIDES_TODAY ? Date.parse(`${env.GUIDES_TODAY}T12:00:00+09:00`) : Date.now();
if (Number.isNaN(now)) fail(`GUIDES_TODAY 를 못 읽었어요: ${env.GUIDES_TODAY}`);
const win = windowFor(now);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const blocklist = existsSync(here("blocklist.json"))
  ? JSON.parse(readFileSync(here("blocklist.json"), "utf8"))
  : { titles: [], ids: [] };
const blocked = (e) => (blocklist.titles ?? []).some((w) => w && e.title.includes(w)) || (blocklist.ids ?? []).includes(e.id);

// 어제 파일 — 못 받은 소스의 몫을 여기서 가져온다.
let previous = [];
try {
  if (existsSync(OUT)) previous = JSON.parse(readFileSync(OUT, "utf8")).events ?? [];
} catch {
  previous = [];
}

const fetchJson = makeFetcher({
  mockDir,
  saveDir: env.GUIDES_SAVE_RAW || undefined,
  secrets: [env.SEOUL_API_KEY, env.TOURAPI_KEY],
});

// ── 소스마다 받기 ─────────────────────────────

const reports = [];
for (const { mod, limit } of SOURCES) {
  const report = { mod, limit, ok: true, received: 0, events: [], drops: [], notes: [] };
  try {
    const key = env[mod.keyEnv];
    if (!key && !mockDir) throw new Error(`${mod.keyEnv} 가 없어요 (저장소 Settings → Secrets and variables → Actions)`);
    const got = await mod.collect({ fetchJson, key, win });
    Object.assign(report, got);
  } catch (e) {
    report.ok = false;
    report.error = e.message;
    report.events = previous.filter((p) => typeof p.id === "string" && p.id.startsWith(mod.prefix));
    report.notes.push(`어제 파일에서 ${report.events.length}건을 가져왔어요`);
  }
  reports.push(report);
}
if (reports.every((r) => !r.ok)) {
  fail(`모든 소스를 못 받았어요 — 어제 파일을 그대로 둬요.\n${reports.map((r) => `  · ${r.mod.name}: ${r.error}`).join("\n")}`);
}

// ── 공통 판정·겹침·상한 ─────────────────────────────

const seenIds = new Set();
const keys = new Map(); // titleKey → 남긴 일정들
for (const r of reports) {
  const kept = [];
  for (const e of r.events) {
    const reason =
      dateIssue(e, win) ??
      notOuting(e) ??
      (blocked(e) ? "차단 목록" : null) ??
      (seenIds.has(e.id) ? "같은 id" : null) ??
      ((keys.get(titleKey(e.title)) ?? []).some((o) => o.startDate <= e.endDate && e.startDate <= o.endDate) ? "다른 소스와 겹침" : null);
    if (reason) {
      r.drops.push({ reason, title: e.title });
      continue;
    }
    seenIds.add(e.id);
    const k = titleKey(e.title);
    if (k) keys.set(k, [...(keys.get(k) ?? []), e]);
    kept.push(e);
  }
  const sorted = sortForApp(kept, win.today);
  for (const e of sorted.slice(r.limit)) r.drops.push({ reason: "소스 상한", title: e.title });
  r.kept = sorted.slice(0, r.limit);
}

const all = sortForApp(reports.flatMap((r) => r.kept), win.today);
const events = all.slice(0, MAX_EVENTS).map((e) => {
  const out = {};
  for (const [k, v] of Object.entries(e)) if (v !== undefined) out[k] = v;
  return out;
});
if (all.length > MAX_EVENTS) console.log(`  (전체 상한 ${MAX_EVENTS}건 — ${all.length - MAX_EVENTS}건을 뒤에서 뺐어요)`);
const received = reports.reduce((n, r) => n + r.received, 0);
if (events.length === 0) fail(`받은 ${received}건 중 넣을 무료 일정이 0건이에요 — 어제 파일을 그대로 둬요.`);

const foodsAll = JSON.parse(readFileSync(here("foods.json"), "utf8"));
const foods = foodsAll.filter((f) => branch !== "main" || f.draft !== true).map(({ draft, ...f }) => f);

writeFileSync(OUT, JSON.stringify({ formatVersion: FORMAT_VERSION, generatedAt: new Date().toISOString(), events, foods }, null, 2) + "\n");

// ── 로그 ─────────────────────────────

const count = (list, key) => {
  const m = new Map();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
};
const byRegion = [...count(events, (e) => e.region)].map(([r, n]) => `${r} ${n}`).join(" · ");
const lines = [
  `✓ ${OUT}: 무료 일정 ${events.length}건 (${byRegion}), 보관법 ${foods.length}개 (${branch}, 초안 ${foodsAll.length - foods.length}개 뺌)`,
];
const inOut = new Set(events.map((e) => e.id));
for (const r of reports) {
  const mine = r.kept.filter((e) => inOut.has(e.id)).length;
  const reasons = [...count(r.drops, (d) => d.reason)].map(([why, n]) => `${why} ${n}`).join(" · ");
  const head = r.ok ? `받은 ${r.received}건 → 넣은 ${mine}건` : `✗ 못 받음 (${r.error}) → 어제 것 ${mine}건`;
  lines.push(`  · ${r.mod.name}: ${head}${reasons ? ` | ${reasons}` : ""}`);
  for (const note of r.notes) lines.push(`      ${note}`);
}
console.log(lines.join("\n"));
summary(["### guides.json", "", "```", ...lines, "```"]);

// dry run 은 사람이 규칙을 고칠 수 있게 무엇을 왜 뺐는지, 무엇이 들어갔는지 다 찍는다(날짜로 뺀 것은 건수만).
if (dryRun) {
  for (const r of reports) {
    const shown = r.drops.filter((d) => !DATE_REASONS.has(d.reason));
    if (shown.length === 0) continue;
    console.log(`\n── ${r.mod.name}: 뺀 일정 (날짜 밖 제외)`);
    for (const d of shown.slice(0, 80)) console.log(`  [${d.reason}] ${d.title ?? "(제목 없음)"}${d.detail ? ` — ${d.detail}` : ""}`);
    if (shown.length > 80) console.log(`  … 외 ${shown.length - 80}건`);
  }
  const src = (id) => reports.find((r) => id.startsWith(r.mod.prefix))?.mod.name ?? "?";
  console.log(`\n── 넣은 일정 ${events.length}건 (앱 순서)`);
  for (const e of events) {
    const when = e.startDate === e.endDate ? e.startDate : `${e.startDate}~${e.endDate.slice(5)}`;
    console.log(`  ${when} | ${e.region} | ${e.title} | ${e.place ?? "-"} | ${e.time ?? "-"} | ${e.fee ?? "-"} | ${src(e.id)}`);
  }
}

const failed = reports.filter((r) => !r.ok).map((r) => r.mod.name);
setOutput("failed", failed.join(","));
if (failed.length) console.error(`\n✗ 못 받은 소스가 있어요: ${failed.join(", ")} — 어제 것으로 채웠어요. Action 은 실패로 끝나요.`);
