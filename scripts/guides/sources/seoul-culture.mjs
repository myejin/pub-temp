// 서울 열린데이터광장 「서울시 문화행사 정보」(culturalEventInfo). 처음부터 있던 소스다.

import { createHash } from "node:crypto";
import { clip, dayOf, paidOnly, source } from "../lib.mjs";
import { seoulRows } from "./seoul-api.mjs";

export const name = "서울 문화행사";
export const prefix = "seoul-";
export const keyEnv = "SEOUL_API_KEY";
const CREDIT = "서울문화포털";

// 무료 표시(IS_FREE 「무료」)이거나 요금이 「무료」로 시작하고, 요금 칸이 금액만 적힌 유료가 아닌 것.
// IS_FREE 가 「무료」인데 요금이 「30,000원」인 일정이 실제로 온다.
export const isFree = (r) => (r.IS_FREE === "무료" || /^\s*무료/.test(r.USE_FEE ?? "")) && !paidOnly(r.USE_FEE);

// 행 하나 → 일정. 넣지 않을 것이면 { drop: 까닭 }.
export function toEvent(r) {
  const title = clip(r.TITLE, 60);
  if (!title) return { drop: "제목 없음" };
  if (!isFree(r)) return { drop: "유료", title };
  const startDate = dayOf(r.STRTDATE);
  const endDate = dayOf(r.END_DATE);
  // id 는 제목·시작일·장소로 만든다 — 같은 행사는 날마다 같은 id 라 앱의 목록 키가 흔들리지 않는다. 이 공식을 바꾸면
  // blocklist.json 의 ids 와 앱이 기억한 목록 키가 어긋나니 그대로 둔다.
  const id = "seoul-" + createHash("sha1").update(`${r.TITLE}|${String(r.STRTDATE ?? "").slice(0, 10)}|${r.PLACE}`).digest("hex").slice(0, 12);
  return {
    event: {
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
    },
  };
}

export async function collect({ fetchJson, key }) {
  const rows = await seoulRows(fetchJson, key, "culturalEventInfo", "seoul-culture");
  const events = [];
  const drops = [];
  for (const r of rows) {
    const { event, drop, title } = toEvent(r);
    if (event) events.push(event);
    else drops.push({ reason: drop, title });
  }
  return { received: rows.length, events, drops, notes: [] };
}
