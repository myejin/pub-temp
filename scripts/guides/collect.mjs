// guides.json 을 만든다 — 무료 일정(서울 열린데이터광장 「서울시 문화행사 정보」)과 보관법(foods.json, 사람이 씀)을 합친다.
// myejin/pub-temp 저장소 루트에서 GitHub Action(guides.yml)이 매일 돌린다. 의존성 없이 Node 20 내장 fetch 만 쓴다.
//
//   SEOUL_API_KEY=… TARGET_BRANCH=develop node scripts/guides/collect.mjs      (저장소 루트에서, guides.json 을 루트에 쓴다)
//   SEOUL_API_MOCK=sample.json TARGET_BRANCH=develop node scripts/guides/collect.mjs  (API 대신 저장해 둔 응답으로 시험)
//
// 보관법은 같은 폴더의 foods.json(사람이 씀), 뺄 일정은 blocklist.json. 형식의 정본은 weekly-challenge 의 src/utils/guides.ts(parseGuidesFeed)다. 여기서 한 번 거르고, 앱이 또 거른다.
//
// 지키는 것:
//   · 못 받았거나 0건이면 아무것도 쓰지 않고 실패한다 — 어제 파일이 그대로 남는다(앱은 빈 줄보다 낡은 줄이 낫다).
//   · 무료(IS_FREE 「무료」 또는 요금이 「무료」로 시작)만, 오늘(서울)부터 30일 안에 시작하고 아직 끝나지 않은 것만.
//   · blocklist.json 의 낱말이 제목에 들어 있거나 id 가 같으면 뺀다.
//   · 공식 사이트 주소는 앱의 parseSource 와 같은 조건(출력 가능한 ASCII, 300자 이하, https/http, 호스트는 [a-z0-9.-])만 넣는다.
//   · 사진은 넣지 않는다(공공누리 유형 확인 없이 쓸 수 없다).
//   · main 에 쓸 때는 draft: true 인 보관법을 뺀다 — 보관 기간을 사람이 확인하기 전에는 실사용자에게 보이지 않게.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FORMAT_VERSION = 1; // src/utils/guides.ts 의 GUIDES_FORMAT_VERSION
const WINDOW_DAYS = 30; // EVENT_WINDOW_DAYS
const MAX_EVENTS = 300; // MAX_EVENTS
const PAGE = 1000; // 서울 열린데이터광장 한 번에 최대 1000건
const MAX_PAGES = 10;
const CREDIT = "서울문화포털";
const OUT = "guides.json";

const key = process.env.SEOUL_API_KEY;
const mock = process.env.SEOUL_API_MOCK;
const branch = process.env.TARGET_BRANCH ?? "develop";
if (!key && !mock) fail("SEOUL_API_KEY 가 없어요 (저장소 Settings → Secrets and variables → Actions).");
const here = (name) => new URL(name, import.meta.url);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// 서울 날짜(YYYY-MM-DD). Action 은 UTC 에서 돈다.
function seoulDate(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const clip = (s, max) => {
  if (typeof s !== "string") return undefined;
  const t = s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return [...t].length <= max ? t : [...t].slice(0, max - 1).join("") + "…";
};

function source(url) {
  if (typeof url !== "string") return undefined;
  const u = url.trim();
  if (u.length > 300 || !/^[\x21-\x7e]+$/.test(u)) return undefined;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.port) return undefined;
  if (!/^[a-z0-9.-]+$/.test(parsed.hostname)) return undefined;
  return { url: u };
}

async function fetchPage(start) {
  if (mock) return parsePage(JSON.parse(readFileSync(mock, "utf8")));
  const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/culturalEventInfo/${start}/${start + PAGE - 1}/`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsePage(await res.json());
}

function parsePage(body) {
  const root = body.culturalEventInfo;
  if (!root) throw new Error(`응답 모양이 달라요: ${JSON.stringify(body).slice(0, 200)}`);
  if (root.RESULT && root.RESULT.CODE !== "INFO-000") throw new Error(`${root.RESULT.CODE} ${root.RESULT.MESSAGE}`);
  return { rows: root.row ?? [], total: Number(root.list_total_count ?? 0) };
}

const blocklist = existsSync(here("blocklist.json")) ? JSON.parse(readFileSync(here("blocklist.json"), "utf8")) : { titles: [], ids: [] };

function toEvent(r, today, last) {
  const free = r.IS_FREE === "무료" || /^\s*무료/.test(r.USE_FEE ?? "");
  if (!free) return null;
  const startDate = String(r.STRTDATE ?? "").slice(0, 10);
  const endDate = String(r.END_DATE ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return null;
  if (endDate < today || startDate > last) return null;
  const title = clip(r.TITLE, 60);
  if (!title) return null;
  if ((blocklist.titles ?? []).some((w) => title.includes(w))) return null;
  // id 는 제목·시작일·장소로 만든다 — 같은 행사는 날마다 같은 id 라 앱의 목록 키가 흔들리지 않는다.
  const id = "seoul-" + createHash("sha1").update(`${r.TITLE}|${startDate}|${r.PLACE}`).digest("hex").slice(0, 12);
  if ((blocklist.ids ?? []).includes(id)) return null;
  const event = {
    id,
    title,
    region: "서울",
    place: clip(r.PLACE, 60),
    startDate,
    endDate,
    fee: clip(r.USE_FEE, 120) ?? "무료",
    performers: clip(r.PLAYER, 120),
    target: clip(r.USE_TRGT, 60),
    text: clip(r.PROGRAM || r.ETC_DESC, 600),
    source: source(r.ORG_LINK) ?? source(r.HMPG_ADDR),
    credit: CREDIT,
  };
  for (const k of Object.keys(event)) if (event[k] === undefined) delete event[k];
  return event;
}

const today = seoulDate();
const last = seoulDate(WINDOW_DAYS - 1);
const rows = [];
try {
  let start = 1;
  for (let i = 0; i < MAX_PAGES; i++) {
    const { rows: page, total } = await fetchPage(start);
    rows.push(...page);
    start += PAGE;
    if (page.length < PAGE || start > total) break;
  }
} catch (e) {
  fail(`문화행사 정보를 못 받았어요: ${e.message}`);
}

const seen = new Set();
const events = rows
  .map((r) => toEvent(r, today, last))
  .filter((e) => e && !seen.has(e.id) && seen.add(e.id))
  .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, "ko"))
  .slice(0, MAX_EVENTS);
if (events.length === 0) fail(`받은 ${rows.length}건 중 넣을 무료 일정이 0건이에요 — 어제 파일을 그대로 둬요.`);

const foodsAll = JSON.parse(readFileSync(here("foods.json"), "utf8"));
const foods = foodsAll.filter((f) => branch !== "main" || f.draft !== true).map(({ draft, ...f }) => f);

writeFileSync(OUT, JSON.stringify({ formatVersion: FORMAT_VERSION, generatedAt: new Date().toISOString(), events, foods }, null, 2) + "\n");
console.log(`✓ ${OUT}: 무료 일정 ${events.length}건 (받은 ${rows.length}건), 보관법 ${foods.length}개 (${branch}, 초안 ${foodsAll.length - foods.length}개 뺌)`);
