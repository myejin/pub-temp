// 서울 열린데이터광장 「서울시 공공서비스예약 정보」(yeyak.seoul.go.kr) — 문화체험·교육강좌 중 무료이고 접수 중인 것.
// 체육시설·시설대관·진료는 나들이가 아니라 받지 않는다. 인증키는 문화행사와 같은 SEOUL_API_KEY.
//
// 서비스 이름과 칸 이름은 열린데이터광장 문서를 보고 맞췄고, 실제 응답으로는 아직 확인하지 못했다 — 첫 dry run
// 로그의 「받은 N건」과 분류 분포를 보고 고친다.

import { clip, clipText, dayOf, monthDay, source } from "../lib.mjs";
import { seoulRows } from "./seoul-api.mjs";

export const name = "서울 공공서비스예약";
export const prefix = "yeyak-";
export const keyEnv = "SEOUL_API_KEY";
const CREDIT = "서울시 공공서비스예약";

// [서비스 이름, 시험 응답 파일 이름 앞부분]
const SERVICES = [
  ["ListPublicReservationCulture", "yeyak-culture"],
  ["ListPublicReservationEducation", "yeyak-edu"],
];
// 「안내중」(접수 시작 전)·「접수종료」·「예약마감」은 지금 신청할 수 없어 뺀다.
const OPEN = new Set(["접수중"]);
// 나들이가 아닌 소분류 — 키즈카페 시간 예약, 청년센터 상담·강의, 자격증·어학·컴퓨터 강좌, 봉사. 첫 dry run(2026-11-04)을 보고 정했다.
const SKIP_CLASSES = new Set(["서울형키즈카페", "청년정보", "전문/자격증", "정보통신", "교양/어학", "단체봉사"]);
// 학교·학급 단체만 받는 교육과 참여자·기부자를 뽑는 공고. 문화행사와 달리 여기서는 「참여자 모집」이 대개 청년센터 강의다.
// 청년센터 프로그램(호신술·자격증 등)은 소분류가 「청년정보」가 아닌 것도 있고, 「정비사업 아카데미」는 재개발 설명회다(2026-11-04 두 번째 dry run).
const SKIP_TITLE = /학교\s*단체|학급\s*단체|재능\s*기부자|참여자\s*모집|청년\s*센터|정비\s*사업/;

// "09:00"·"0900"·"9:00" → "09:00". 못 읽으면 undefined.
function hhmm(v) {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return undefined;
  // 시간을 안 적은 서비스는 「00:00」으로 온다 — 자정 행사는 없다고 보고 비운다.
  if (Number(m[1]) === 0 && Number(m[2]) === 0) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min < 60 ? `${String(h).padStart(2, "0")}:${m[2]}` : undefined;
}

export function timeOf(r) {
  const from = hhmm(r.V_MIN);
  const to = hhmm(r.V_MAX);
  if (!from && !to) return undefined;
  if (from && to) return from === to ? from : `${from}~${to}`;
  return from ?? `~${to}`;
}

// 서비스 ID 는 「S241231…」 같은 영문·숫자라 그대로 id 에 쓴다 — 날마다 같아 앱의 목록 키가 흔들리지 않는다.
const SAFE_ID = /^[A-Za-z0-9_-]{1,50}$/;

export function toEvent(r) {
  const title = clip(r.SVCNM, 60);
  if (!title) return { drop: "제목 없음" };
  if (String(r.PAYATNM ?? "").trim() !== "무료") return { drop: "유료", title };
  if (!OPEN.has(String(r.SVCSTATNM ?? "").trim())) return { drop: "접수 중 아님", title };
  if (SKIP_CLASSES.has(String(r.MINCLASSNM ?? "").trim())) return { drop: "나들이 아닌 분류", title };
  if (SKIP_TITLE.test(title)) return { drop: "단체·모집", title };
  const svcId = String(r.SVCID ?? "").trim();
  if (!SAFE_ID.test(svcId)) return { drop: "id 없음", title };

  // 소개 첫 줄에 접수 기간을 적는다. 앱에는 접수 칸이 없고, 「예약」이라는 말이 들어가 앱이 「사전 신청」을 단다.
  const rcptFrom = dayOf(r.RCPTBGNDT);
  const rcptTo = dayOf(r.RCPTENDDT);
  const receipt =
    rcptFrom && rcptTo
      ? `접수 ${monthDay(rcptFrom)}~${monthDay(rcptTo)} (서울시 공공서비스예약)`
      : "서울시 공공서비스예약에서 신청해요";
  return {
    event: {
      id: `yeyak-${svcId}`,
      title,
      region: "서울",
      place: clip(r.PLACENM, 60),
      startDate: dayOf(r.SVCOPNBGNDT),
      endDate: dayOf(r.SVCOPNENDDT),
      time: timeOf(r),
      // 접수 마감일(YYYY-MM-DD). 다음 앱 버전이 「접수 마감」 표시와 주말 줄에서 빼는 데 쓴다. 옛 앱은 모르는 칸이라 무시한다.
      // 소개 첫 줄의 접수 기간은 옛 앱을 위해 남긴다.
      applyEnd: rcptTo,
      fee: "무료",
      target: clip(r.USETGTINFO, 60),
      text: clipText(`${receipt}\n${r.DTLCONT ?? ""}`, 600),
      source: source(r.SVCURL),
      credit: CREDIT,
    },
  };
}

export async function collect({ fetchJson, key }) {
  const events = [];
  const drops = [];
  const classes = new Map();
  let received = 0;
  for (const [service, label] of SERVICES) {
    const rows = await seoulRows(fetchJson, key, service, label);
    received += rows.length;
    for (const r of rows) {
      const cls = `${r.MAXCLASSNM ?? "?"}/${r.MINCLASSNM ?? "?"}`;
      classes.set(cls, (classes.get(cls) ?? 0) + 1);
      const { event, drop, title } = toEvent(r);
      if (event) events.push(event);
      else drops.push({ reason: drop, title });
    }
  }
  const dist = [...classes].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`);
  return { received, events, drops, notes: dist.length ? [`분류: ${dist.join(", ")}`] : [] };
}
