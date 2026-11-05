// 수집기의 판정 규칙 시험. 네트워크 없이 돈다 — `node --test scripts/guides/*.test.mjs`.
// Action 도 수집 전에 돌린다(규칙이 깨진 채로 main 의 guides.json 을 바꾸지 않게).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clip,
  clipText,
  dateIssue,
  dayOf,
  notOuting,
  paidOnly,
  plain,
  saysFree,
  sortForApp,
  source,
  titleKey,
  urlFrom,
  windowFor,
} from "./lib.mjs";
import * as culture from "./sources/seoul-culture.mjs";
import * as yeyak from "./sources/seoul-yeyak.mjs";
import * as tour from "./sources/tour.mjs";
import { seoulPage } from "./sources/seoul-api.mjs";

const win = windowFor(Date.parse("2026-11-04T12:00:00+09:00"));

test("창: 오늘·30일 안 시작·60일(+7일) 안 끝", () => {
  assert.deepEqual(win, { today: "2026-11-04", lastStart: "2026-12-03", lastEnd: "2027-01-09" });
  const e = (startDate, endDate) => ({ startDate, endDate });
  assert.equal(dateIssue(e("2026-11-01", "2026-11-04"), win), null);
  assert.equal(dateIssue(e("2026-11-01", "2026-11-03"), win), "끝남");
  assert.equal(dateIssue(e("2026-12-04", "2026-12-04"), win), "30일 뒤 시작");
  assert.equal(dateIssue(e("2025-04-23", "2027-04-22"), win), "60일 넘게 이어짐");
  assert.equal(dateIssue(e("2026-11-10", "2027-01-09"), win), null);
  assert.equal(dateIssue(e(undefined, "2026-11-10"), win), "날짜 없음");
});

test("날짜 읽기", () => {
  assert.equal(dayOf("2026-11-04 10:00:00.0"), "2026-11-04");
  assert.equal(dayOf("20261104"), "2026-11-04");
  assert.equal(dayOf("2026-02-30"), undefined);
  assert.equal(dayOf(""), undefined);
});

test("요금: 입장료 따로는 무료, 금액만은 유료", () => {
  assert.equal(paidOnly("무료(입장료 4,000원 별도)"), false);
  assert.equal(paidOnly("*본 공연은 무료공연이나, 1인 10,000원의 예약금이 있습니다."), false);
  assert.equal(paidOnly("0원"), false);
  assert.equal(paidOnly("30,000원"), true);
  assert.equal(paidOnly("R석 30,000원 S석 20,000원"), true);
  assert.equal(paidOnly(undefined), false);
});

test("요금 글로 무료 판정(관광공사)", () => {
  for (const fee of ["무료", "무료 ※ 일부 체험 유료", "전석 무료", "입장 무료", "입장료: 무료", "관람료 무료"]) assert.ok(saysFree(fee), fee);
  for (const fee of ["입장료 10,000원 (체험 무료)", "성인 5,000원", "유료", "", undefined]) assert.ok(!saysFree(fee), String(fee));
});

test("서울 문화행사: 무료 판정", () => {
  assert.ok(culture.isFree({ IS_FREE: "무료", USE_FEE: "" }));
  assert.ok(culture.isFree({ IS_FREE: "유료", USE_FEE: "무료(입장료 4,000원 별도)" }));
  assert.ok(!culture.isFree({ IS_FREE: "무료", USE_FEE: "30,000원" }));
  assert.ok(!culture.isFree({ IS_FREE: "유료", USE_FEE: "10,000원" }));
});

test("서울 문화행사: id 공식은 그대로(blocklist·앱 목록 키)", () => {
  const { event } = culture.toEvent({ TITLE: "[서울기록원] 전시 [어느 도시의 탑승록]", STRTDATE: "2025-10-23 00:00:00.0", END_DATE: "2028-08-31 00:00:00.0", PLACE: "서울기록원 2층 제1전시실", IS_FREE: "무료" });
  assert.equal(event.id, "seoul-fcd5bf67d17a"); // 2026-11-04 의 guides.json 에 있던 id
});

test("나들이가 아닌 것", () => {
  const e = (o) => ({ title: "행사", ...o });
  assert.equal(notOuting(e({ target: "초등학교 3~4학년 학급단체" })), "단체 전용");
  assert.equal(notOuting(e({ target: "유치원 및 어린이집 등 단체 5~7세" })), "단체 전용");
  assert.equal(notOuting(e({ target: "개인 및 단체" })), null);
  assert.equal(notOuting(e({ target: "누구나(단체 관람 가능)" })), null);
  assert.equal(notOuting(e({ place: "온라인 전시" })), "온라인");
  assert.equal(notOuting(e({ place: "서강도서관 3층 / 온라인(zoom)" })), null);
  assert.equal(notOuting(e({ title: "[청계천박물관] 하반기 온라인 교육 [톡톡톡]" })), "온라인");
  assert.equal(notOuting(e({ title: "[서울시] 2026년 서울청년문화패스 신청자 모집" })), "모집 공고");
  assert.equal(notOuting(e({ title: "장애예술인 강사 양성과정" })), "모집 공고");
  assert.equal(notOuting(e({ title: "가족 숲체험 참가자 모집" })), null);
});

test("글자 다듬기: 태그·엔티티, 앱의 글자 수(UTF-16)", () => {
  assert.equal(plain("<p>숲 &amp; 가을</p><br>준비물:&nbsp;신발"), "숲 & 가을\n준비물: 신발");
  assert.equal(plain("&lt;br&gt;둘째 줄"), "둘째 줄");
  assert.equal(clip("  가  나\n다 ", 60), "가 나 다");
  assert.equal(clip("가".repeat(61), 60), "가".repeat(59) + "…");
  const emoji = clip("😀".repeat(40), 60); // 이모지는 2자로 센다
  assert.ok(emoji.length <= 60, `${emoji.length}`);
  assert.equal(clipText("첫 줄<br>둘째 줄", 600), "첫 줄\n둘째 줄");
  assert.equal(clip("", 10), undefined);
});

test("주소: 앱과 같은 조건, 관광공사 홈페이지 칸", () => {
  assert.deepEqual(source("https://news.seoul.go.kr/culture/1"), { url: "https://news.seoul.go.kr/culture/1" });
  assert.equal(source("https://user@evil.example/"), undefined);
  assert.equal(source("https://example.com:8080/"), undefined);
  assert.equal(source("https://예시.kr/"), undefined);
  assert.equal(urlFrom('<a href="https://www.seoullantern.kr" target="_blank">www.seoullantern.kr</a>'), "https://www.seoullantern.kr");
  assert.equal(urlFrom("www.jarasum.kr"), "http://www.jarasum.kr");
  assert.equal(urlFrom('<a href="https://a.kr/?x=1&amp;y=2">a</a>'), "https://a.kr/?x=1&y=2");
  assert.equal(urlFrom(undefined), undefined);
});

test("겹침 열쇠: 기관 머리·연도·띄어쓰기를 뗀다", () => {
  assert.equal(titleKey("[서울숲공원] 가을 숲 해설"), titleKey("가을 숲해설"));
  assert.equal(titleKey("[서울시] 2026 서울빛초롱축제"), titleKey("서울 빛초롱 축제"));
  assert.notEqual(titleKey("[서울시] 공공미술 [선유담담]"), titleKey("[서울시] 공공미술 [다른전시]"));
});

test("순서: 앱의 sortEvents 와 같다", () => {
  const e = (title, startDate, endDate) => ({ title, startDate, endDate });
  const sorted = sortForApp(
    [
      e("다음주", "2026-11-10", "2026-11-10"),
      e("긴 진행", "2026-10-01", "2026-12-20"),
      e("오늘 하루", "2026-11-04", "2026-11-04"),
      e("오늘까지", "2026-10-20", "2026-11-04"),
      e("내일", "2026-11-05", "2026-11-07"),
    ],
    "2026-11-04",
  );
  assert.deepEqual(sorted.map((x) => x.title), ["오늘 하루", "오늘까지", "긴 진행", "내일", "다음주"]);
});

test("서울 API 쪽 읽기: 데이터 없음(INFO-200)은 빈 쪽, 오류는 실패", () => {
  assert.deepEqual(seoulPage({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } }, "X"), { rows: [], total: 0 });
  assert.throws(() => seoulPage({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다." } }, "X"), /INFO-100/);
  assert.deepEqual(seoulPage({ X: { list_total_count: 1, RESULT: { CODE: "INFO-000" }, row: [{ a: 1 }] } }, "X"), { rows: [{ a: 1 }], total: 1 });
});

test("공공서비스예약: 무료·접수중만, 시간·접수 기간", () => {
  const base = { SVCID: "S1", SVCNM: "숲해설", PAYATNM: "무료", SVCSTATNM: "접수중", SVCOPNBGNDT: "2026-11-01 00:00:00.0", SVCOPNENDDT: "2026-11-30 00:00:00.0", RCPTBGNDT: "2026-10-20 09:00:00.0", RCPTENDDT: "2026-11-28 18:00:00.0", V_MIN: "10:00", V_MAX: "12:00" };
  const { event } = yeyak.toEvent(base);
  assert.equal(event.id, "yeyak-S1");
  assert.equal(event.time, "10:00~12:00");
  assert.match(event.text, /^접수 10\.20~11\.28 \(서울시 공공서비스예약\)/);
  assert.equal(yeyak.toEvent({ ...base, PAYATNM: "유료" }).drop, "유료");
  assert.equal(yeyak.toEvent({ ...base, SVCSTATNM: "안내중" }).drop, "접수 중 아님");
  assert.equal(yeyak.toEvent({ ...base, SVCID: "../x" }).drop, "id 없음");
  assert.equal(yeyak.timeOf({ V_MIN: "0900", V_MAX: "" }), "09:00");
  assert.equal(yeyak.timeOf({ V_MIN: "", V_MAX: "" }), undefined);
  assert.equal(yeyak.timeOf({ V_MIN: "00:00", V_MAX: "00:00" }), undefined);
  assert.equal(yeyak.toEvent({ ...base, MINCLASSNM: "서울형키즈카페" }).drop, "나들이 아닌 분류");
  assert.equal(yeyak.toEvent({ ...base, MINCLASSNM: "청년정보" }).drop, "나들이 아닌 분류");
  assert.ok(yeyak.toEvent({ ...base, MINCLASSNM: "공원탐방" }).event);
  for (const t of ["리앤업사이클플라자 학교단체 교육", "[은평구] 2026년 목공재능기부자 모집안내", "서울청년센터 은평 11월 티톡 참여자 모집", "[서울청년센터 마포] 청년을 위한 호신술 교육 참가자 모집(11/11)", "[11월] 2026 대시민 정비사업 아카데미 2차 (11/7 서초구)"])
    assert.equal(yeyak.toEvent({ ...base, SVCNM: t }).drop, "단체·모집", t);
});

test("관광공사: 항목 모양, 시·군, 반려동물 줄", () => {
  const wrap = (items) => ({ response: { header: { resultCode: "0000" }, body: { items, totalCount: 1 } } });
  assert.deepEqual(tour.tourItems(wrap("")).items, []);
  assert.deepEqual(tour.tourItems(wrap({ item: { a: 1 } })).items, [{ a: 1 }]);
  assert.throws(() => tour.tourItems({ response: { header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR." } } }), /30/);
  assert.equal(tour.cityOf("경기도 가평군 가평읍 달전리 1"), "가평");
  assert.equal(tour.cityOf("경기도 수원시 팔달구 정조로 825"), "수원");
  assert.equal(tour.cityOf(""), undefined);
  assert.equal(tour.petLine(undefined), undefined);
  assert.equal(tour.petLine({ acmpyTypeCd: "", acmpyPsblCpam: "" }), undefined);
  assert.match(tour.petLine({ acmpyTypeCd: "일부구역 동반가능", acmpyPsblCpam: "소형견" }), /^반려동물: 일부구역 동반가능 · 소형견 \(/);
});
