// 한국관광공사 「국문 관광정보 서비스_GW」(TourAPI, KorService2)의 행사정보 — 서울·경기 축제.
// 공공데이터포털 일반 인증키를 TOURAPI_KEY 로 받는다. 키는 2028-11-04 까지라 그 전에 연장 신청해야 한다(README).
//
// 무료 표시 칸이 없어 요금 글(usetimefestival)로 거른다(saysFree). 축제마다 상세를 더 부르므로(소개·공통·반려동물)
// 날짜로 먼저 거른 뒤 무료인 것만 공통·반려동물을 부른다. 하루 한도는 기능마다 1,000건이다.
// 지역은 법정동 시도코드(lDongRegnCd)로 고른다 — 옛 지역코드(areaCode)는 삭제 예정이다.
//
// 칸 이름은 활용 매뉴얼을 보고 맞췄고 실제 응답으로는 아직 확인하지 못했다 — 첫 dry run 로그로 고친다.

import { clip, clipNote, clipText, dateIssue, dayOf, mapLimit, saysFree, seoulDate, source, urlFrom } from "../lib.mjs";

export const name = "한국관광공사 축제";
export const prefix = "tour-";
export const keyEnv = "TOURAPI_KEY";
const CREDIT = "한국관광공사";
const BASE = "https://apis.data.go.kr/B551011/KorService2";
// [법정동 시도코드, 지역, 주소 앞머리]. 경기로 물었는데 경주 행사가 섞여 와서(2026-11-04) 주소로 한 번 더 본다.
const AREAS = [
  ["11", "서울", /^서울/],
  ["41", "경기", /^경기/],
];
// 이미 하고 있는 축제도 잡으려고 시작일을 이만큼 앞으로 당겨 묻는다. 끝나는 날은 우리가 거른다.
const LOOKBACK_DAYS = 180;
const ROWS = 100;
const MAX_PAGES = 20;
const CONCURRENCY = 4;

function url(op, params, key) {
  const q = new URLSearchParams({ serviceKey: key ?? "", MobileOS: "ETC", MobileApp: "weekly", _type: "json", ...params });
  return `${BASE}/${op}?${q}`;
}

// 응답의 항목들. 비면 items 가 "" 로, 하나면 배열이 아니라 객체로 온다.
export function tourItems(body) {
  const r = body?.response;
  if (!r) {
    if (body?.resultCode) throw new Error(`${body.resultCode} ${body.resultMsg ?? ""}`.trim());
    throw new Error(`응답 모양이 달라요: ${JSON.stringify(body).slice(0, 200)}`);
  }
  const code = r.header?.resultCode;
  if (code !== "0000") throw new Error(`${code} ${r.header?.resultMsg ?? ""}`.trim());
  const items = r.body?.items;
  const item = items && typeof items === "object" ? items.item : undefined;
  return { items: item === undefined ? [] : Array.isArray(item) ? item : [item], total: Number(r.body?.totalCount ?? 0) };
}

// 「경기도 가평군 가평읍 …」 → 「가평」, 「경기도 수원시 팔달구 …」 → 「수원」. 경기는 넓어서 장소 앞에 붙인다.
export function cityOf(addr) {
  const m = /^\S+\s+(\S+?)(시|군)(\s|$)/.exec(String(addr ?? "").trim());
  return m ? m[1] : undefined;
}

// 반려동물 동반 정보 한 줄. 정보가 없다고 동반이 안 되는 건 아니라서, 있는 일정에만 단다.
export function petLine(pet) {
  if (!pet) return undefined;
  const parts = [pet.acmpyTypeCd, pet.acmpyPsblCpam, pet.acmpyNeedMtr].map((v) => clip(v, 40)).filter(Boolean);
  return parts.length ? `반려동물: ${parts.join(" · ")} (한국관광공사 정보, 가기 전에 확인해 주세요)` : undefined;
}

// 목록 항목과 상세 셋 → 일정. 넣지 않을 것이면 { drop }.
export function toEvent(item, region, intro, common, pet) {
  const title = clip(item.title, 60);
  if (!title) return { drop: "제목 없음" };
  const fee = clipNote(intro?.usetimefestival, 120);
  if (!saysFree(fee)) return { drop: "무료 아님", title, detail: fee ?? "(요금 칸 없음)" };
  const where = clip(intro?.eventplace, 40) ?? clip(String(item.addr1 ?? "").replace(/^\S+\s+/, ""), 40);
  const city = region === "경기" ? cityOf(item.addr1) : undefined;
  const pets = petLine(pet);
  // 소개 글은 자르지 않는 쪽으로 둔다(공공누리 유형을 아직 확인하지 못했다 — 변경금지면 잘라서도 안 된다).
  // 앱은 4000자를 넘으면 소개를 통째로 버리므로 그 안에서만.
  const text = clipText([pets, common?.overview].filter(Boolean).join("\n"), 3500);
  // 안내 페이지(홈페이지)가 없는 축제는 뺀다 — 카드만으로는 어디서 무엇을 하는지 더 알 길이 없다(2026-11-06 결정).
  const link = source(urlFrom(common?.homepage)) ?? source(urlFrom(intro?.eventhomepage));
  if (!link) return { drop: "안내 페이지 없음", title };
  return {
    event: {
      id: `tour-${String(item.contentid).trim()}`,
      title,
      region,
      place: clip(city && where && !where.startsWith(city) ? `${city} · ${where}` : (where ?? city), 60),
      startDate: dayOf(item.eventstartdate),
      endDate: dayOf(item.eventenddate),
      time: clipNote(intro?.playtime, 60),
      fee,
      target: clip(intro?.agelimit, 60),
      text,
      source: link,
      credit: CREDIT,
    },
    pets: pets !== undefined,
  };
}

export async function collect({ fetchJson, key, win }) {
  const drops = [];
  const listed = [];
  let received = 0;
  const since = seoulDate(-LOOKBACK_DAYS, Date.parse(`${win.today}T12:00:00+09:00`)).replaceAll("-", "");
  for (const [code, region, addrHead] of AREAS) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await fetchJson(
        url("searchFestival2", { numOfRows: ROWS, pageNo: page, eventStartDate: since, lDongRegnCd: code }, key),
        `tour-list-${code}-${page}`,
      );
      const { items, total } = tourItems(body);
      received += items.length;
      for (const item of items) {
        const addr = String(item.addr1 ?? "").trim();
        if (addr && !addrHead.test(addr)) drops.push({ reason: "다른 지역", title: item.title, detail: addr });
        else listed.push({ item, region });
      }
      if (items.length < ROWS || page * ROWS >= total) break;
    }
  }

  // 날짜로 먼저 거른다 — 상세를 부를 축제를 줄여 하루 한도를 아낀다.
  const inWindow = [];
  for (const { item, region } of listed) {
    if (!/^\d+$/.test(String(item.contentid ?? "").trim())) {
      drops.push({ reason: "id 없음", title: item.title });
      continue;
    }
    const issue = dateIssue({ startDate: dayOf(item.eventstartdate), endDate: dayOf(item.eventenddate) }, win);
    if (issue) drops.push({ reason: issue, title: item.title });
    else inWindow.push({ item, region });
  }

  let failed = 0;
  let withPets = 0;
  const results = await mapLimit(inWindow, CONCURRENCY, async ({ item, region }) => {
    const id = String(item.contentid).trim();
    try {
      const intro = tourItems(
        await fetchJson(url("detailIntro2", { contentId: id, contentTypeId: 15 }, key), `tour-intro-${id}`),
      ).items[0];
      if (!saysFree(clip(intro?.usetimefestival, 120))) return toEvent(item, region, intro);
      const common = tourItems(await fetchJson(url("detailCommon2", { contentId: id }, key), `tour-common-${id}`)).items[0];
      // 반려동물 정보는 없거나 못 받아도 일정은 넣는다.
      let pet;
      try {
        pet = tourItems(await fetchJson(url("detailPetTour2", { contentId: id }, key), `tour-pet-${id}`)).items[0];
      } catch {
        pet = undefined;
      }
      return toEvent(item, region, intro, common, pet);
    } catch (e) {
      failed++;
      return { drop: "상세 못 받음", title: item.title, detail: e.message };
    }
  });
  // 상세를 절반 넘게 못 받았으면 키나 API 문제다 — 소스째 실패로 돌려 어제 것을 쓰고 빨간불을 켠다.
  if (inWindow.length > 0 && failed * 2 > inWindow.length) {
    throw new Error(`상세 ${inWindow.length}건 중 ${failed}건을 못 받았어요 (${results.find((r) => r.detail)?.detail ?? ""})`);
  }

  const events = [];
  for (const r of results) {
    if (r.event) {
      events.push(r.event);
      if (r.pets) withPets++;
    } else drops.push({ reason: r.drop, title: r.title, detail: r.detail });
  }
  return {
    received,
    events,
    drops,
    notes: [`날짜 안 ${inWindow.length}건 상세 조회, 반려동물 정보 ${withPets}/${events.length}건`],
  };
}
