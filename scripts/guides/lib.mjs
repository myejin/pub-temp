// 수집기 공통 — 날짜, 글자 다듬기, 주소 검사, 무료·나들이 판정, 앱과 같은 정렬, API 받기.
// 소스(sources/*.mjs)와 collect.mjs 가 같이 쓴다. 의존성 없이 Node 20 내장만 쓴다.
//
// 상한·검사는 앱(weekly-challenge 의 src/utils/guides.ts)과 맞춘다. 앱이 버릴 것은 여기서 먼저 버려
// 300건 자리를 아끼고, 앱이 받아 줄 모양으로만 내보낸다.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export const WINDOW_DAYS = 30; // EVENT_WINDOW_DAYS — 오늘부터 30일(오늘 포함) 안에 시작하는 것만
export const END_DAYS = 60; // EVENT_END_DAYS — 오늘부터 60일(오늘 포함) 안에 끝나는 것만
// 끝나는 날은 앱보다 며칠 넉넉히 둔다. Action 이 며칠 실패해 피드가 묵으면 앱의 창은 오늘을 따라 앞으로 가는데,
// 피드에는 그만큼 뒤의 일정이 없어 빈틈이 생긴다. 넉넉히 넣은 것은 앱이 그날까지 숨기므로 화면은 같다.
export const END_GRACE_DAYS = 7;
export const MAX_EVENTS = 300; // 앱은 피드의 앞 300건만 읽는다(parseList 가 자르고 나서 거른다)

// ── 날짜 ─────────────────────────────

// 서울 날짜(YYYY-MM-DD). Action 은 UTC 에서 돈다.
export function seoulDate(offsetDays = 0, now = Date.now()) {
  return new Date(now + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// 있는 달력 날짜만 — "2026-02-30" 은 버린다(앱의 isoDate 와 같다).
export function isoDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? v : undefined;
}

// "2026-11-04 10:00:00.0"·"2026-11-04" → "2026-11-04", "20261104" → "2026-11-04".
export function dayOf(v) {
  const s = String(v ?? "").trim();
  if (/^\d{8}$/.test(s)) return isoDate(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
  return isoDate(s.slice(0, 10));
}

// "2026-11-04" → "11.4" — 앱의 날짜 칸과 같은 모양.
export const monthDay = (iso) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}.${d}`;
};

export function windowFor(now = Date.now()) {
  return {
    today: seoulDate(0, now),
    lastStart: seoulDate(WINDOW_DAYS - 1, now),
    lastEnd: seoulDate(END_DAYS - 1 + END_GRACE_DAYS, now),
  };
}

// 날짜 때문에 뺄 까닭. 없으면 null.
export function dateIssue(e, win) {
  if (!e.startDate || !e.endDate || e.endDate < e.startDate) return "날짜 없음";
  if (e.endDate < win.today) return "끝남";
  if (e.startDate > win.lastStart) return "30일 뒤 시작";
  if (e.endDate > win.lastEnd) return "60일 넘게 이어짐";
  return null;
}

// ── 글자 ─────────────────────────────

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", middot: "·", crarr: "\n" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[name.toLowerCase()] ?? m;
  });

// 공공데이터 글은 HTML 이 섞여 온다(<br>, <p>, &lt;…). 태그를 걷고 줄은 살린다. 이스케이프된 태그(&lt;br&gt;)도 있어서
// 한 번 풀고 걷은 뒤 다시 푼다.
export function plain(s) {
  if (typeof s !== "string") return "";
  const once = decode(s)
    .replace(/<\s*(br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decode(once)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\s ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// 앱은 글자 수를 String.length(UTF-16)로 재고 넘치면 칸째 버린다. 그래서 같은 단위로 재서 넘치면 「…」로 줄인다
// (이모지를 코드 포인트로 세면 앱 기준으로 한두 자 넘쳐 칸이 사라진다).
function fit(t, max) {
  if (t.length <= max) return t;
  let out = "";
  for (const ch of t) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return out.trimEnd() + "…";
}

// 한 줄로(제목·장소·요금 같은 칸).
export function clip(s, max) {
  const t = plain(s).replace(/\s+/g, " ").trim();
  return t ? fit(t, max) : undefined;
}

// 시간·요금 칸의 표기를 읽기 좋게 — 「10:00~18:00※ 행사별로 상이함」, 「- 1회차 10:00~12:00- 2회차 14:00~16:00」처럼 기호가 글자에 붙어 오고
// 목록 기호(「-」)가 그대로 보인다. 「10:00 - 12:00」 같은 시각 범위는 먼저 「~」로 맞춘다.
export function tidyNote(s) {
  return String(s)
    .replace(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g, "$1~$2")
    .replace(/^\s*-\s+/, "")
    .replace(/\s*-\s+(?=\S)/g, " · ")
    .replace(/\s*※\s*/g, " ※ ")
    .replace(/\s+/g, " ")
    .trim();
}

// 한 줄 칸 + 표기 정리. 정리하면서 글자가 늘 수 있어 넉넉히 받아 정리한 뒤 줄인다.
// 「※」 뒤는 줄바꿈이 안 되는 공백(U+00A0)으로 — 「10:00~18:00 ※」에서 줄이 꺾여 ※ 만 줄 끝에 남지 않고 「※ 행사별로」가 같이 넘어간다.
// clip 이 공백을 한 칸으로 모으므로(NBSP 포함) 마지막에 바꾼다.
export function clipNote(s, max) {
  const t = clip(s, 400);
  const r = t ? clip(tidyNote(t), max) : undefined;
  return r?.replace(/※ /g, "※\u00a0");
}

// 여러 줄 그대로(소개 글).
export function clipText(s, max) {
  const t = plain(s);
  return t ? fit(t, max) : undefined;
}

// ── 주소 ─────────────────────────────

// 앱의 parseSource 와 같은 조건 — 출력 가능한 ASCII, 300자 이하, 계정·포트 없는 http(s), 호스트는 [a-z0-9.-].
export function source(url) {
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

// 관광공사의 홈페이지 칸은 `<a href="…">…</a>` 이거나 「www.…」로 온다. 주소 하나만 꺼낸다.
export function urlFrom(v) {
  if (typeof v !== "string") return undefined;
  const m = /href\s*=\s*["']([^"']+)["']/i.exec(v);
  let u = decode(m ? m[1] : v).trim();
  if (!m && /\s/.test(u)) u = u.split(/\s+/).find((w) => /^(https?:\/\/|www\.)/i.test(w)) ?? "";
  if (/^www\./i.test(u)) u = `http://${u}`;
  return u || undefined;
}

// ── 무료·나들이 ─────────────────────────────

// 금액(1원 이상)만 적혀 있고 「무료」라는 말이 없으면 유료다. 「무료(입장료 4,000원 별도)」처럼 행사는 무료이고
// 들어가는 값만 따로인 것은 넣기로 했다(앱이 요금 원문을 그대로 보여 준다). 「0원」은 금액이 아니다.
export const paidOnly = (fee) => typeof fee === "string" && /[1-9][\d,]*\s*원/.test(fee) && !/무료/.test(fee);

// 관광공사처럼 무료 표시 칸이 없는 소스는 요금 글로 판정한다. 「무료」로 시작하거나(「무료(일부 체험 유료)」)
// 「입장 무료」·「관람료 무료」처럼 들어가는 값이 무료라고 적힌 것만 — 「입장료 10,000원(체험 무료)」은 유료다.
export const saysFree = (fee) =>
  typeof fee === "string" &&
  (/^\s*(전액|전석)?\s*무료/.test(fee) || /(입장|입장료|관람|관람료|참가|참가비|참여|참여비)\s*(은|는|:)?\s*무료/.test(fee));

const GROUP = /단체|학급/;
const INDIVIDUAL = /개인|누구나/;
// 장소 칸이 「온라인」으로 **시작**할 때만 — 「서강도서관 3층 / 온라인(zoom)」처럼 현장과 같이 하는 강좌는 남긴다.
const ONLINE_PLACE = /^\s*(온라인|비대면)/;
const ONLINE_TITLE = /온라인\s*(전시|교육|강의|강좌)/;
// 참여할 사람이 아니라 지원자·봉사자를 뽑는 공고. 「참가자 모집」은 실제 체험 프로그램이 많아 넣지 않는다.
const RECRUIT = /신청자\s*모집|문화패스|서포터즈|자원\s*봉사자|강사\s*양성/;

// 나들이로 갈 수 없는 일정이면 그 까닭, 아니면 null.
export function notOuting(e) {
  if (e.target && GROUP.test(e.target) && !INDIVIDUAL.test(e.target)) return "단체 전용";
  if ((e.place && ONLINE_PLACE.test(e.place)) || ONLINE_TITLE.test(e.title)) return "온라인";
  if (RECRUIT.test(e.title)) return "모집 공고";
  return null;
}

// 소스끼리 같은 행사를 가리는 열쇠. 앞의 기관 머리(「[서울시] 」)·연도·회차·띄어쓰기·문장부호를 뗀다. 제목 안의
// 괄호(「[선유담담]」)는 행사 이름이라 남긴다.
export function titleKey(title) {
  return title
    .replace(/^\s*(\[[^\]]*\]\s*)+/, "")
    .replace(/20\d\d\s*년?|제\s*\d+\s*회/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
}

// ── 순서 ─────────────────────────────

const spanDays = (e) => Math.round((Date.parse(e.endDate) - Date.parse(e.startDate)) / 86_400_000) + 1;
const byDate = (a, b) =>
  a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.title.localeCompare(b.title, "ko");
const byEndFirst = (a, b) => a.endDate.localeCompare(b.endDate) || spanDays(a) - spanDays(b) || byDate(a, b);

// 앱의 sortEvents 와 같은 순서 — 이미 시작한 것을 끝나는 날 순으로, 그다음 앞으로 할 것을 시작일 순으로.
// 상한으로 자를 때 앱이 먼저 보여 줄 것이 남게 하려고 같은 순서를 쓴다.
export function sortForApp(events, today) {
  const started = (e) => e.startDate <= today;
  return [...events].sort((a, b) => {
    const sa = started(a);
    const sb = started(b);
    if (sa !== sb) return sa ? -1 : 1;
    return sa ? byEndFirst(a, b) : byDate(a, b);
  });
}

// ── 받기 ─────────────────────────────

// JSON 받기. 시험할 때는 `mockDir/<label>.json` 을 읽고, `saveDir` 이 있으면 받은 것을 같은 이름으로 남긴다
// (dry run 아티팩트 — 나중에 그대로 시험 응답으로 쓴다). 오류 글에는 요청 주소를 넣지 않는다 — 키가 들어 있고
// 이 저장소는 공개라 Action 로그도 공개다. 혹시 몰라 키 글자도 지운다.
// 다시 시도하는 간격 — 세 번까지. 2026-11-05 에 관광공사가 2초 간격 두 번을 다 「fetch failed」로 끝나 그날 경기 일정을
// 통째로 놓쳤다(몇 분 뒤에는 됐다). 끊김이 잠깐이면 이 안에 돌아온다.
const RETRY_DELAYS = [5_000, 15_000];

export function makeFetcher({ mockDir, saveDir, secrets = [] }) {
  const scrub = (msg) => secrets.filter(Boolean).reduce((m, k) => m.split(k).join("***"), String(msg));
  return async function fetchJson(url, label) {
    if (mockDir) {
      const file = join(mockDir, `${label}.json`);
      if (!existsSync(file)) throw new Error(`${label}: 시험 응답 파일이 없어요`);
      return JSON.parse(readFileSync(file, "utf8"));
    }
    let last;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        const body = await res.text();
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { retry: res.status >= 500 });
        let json;
        try {
          json = JSON.parse(body);
        } catch {
          throw new Error(`JSON 이 아니에요: ${body.replace(/\s+/g, " ").slice(0, 200)}`);
        }
        if (saveDir) {
          mkdirSync(saveDir, { recursive: true });
          writeFileSync(join(saveDir, `${label}.json`), JSON.stringify(json, null, 2) + "\n");
        }
        return json;
      } catch (e) {
        last = e;
        // 네트워크 오류·시간 초과·5xx 만 다시. 4xx 와 모양이 다른 응답은 다시 해도 같다.
        const retry = e.retry === true || e.name === "TimeoutError" || e.name === "TypeError";
        if (!retry || attempt === RETRY_DELAYS.length) break;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      }
    }
    throw new Error(scrub(`${label}: ${last?.message ?? last}`));
  };
}

// 동시에 `limit` 개까지만 부른다 — 하루 한도가 있는 API 에 한꺼번에 몰리지 않게.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Action ─────────────────────────────

export function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

export function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}
