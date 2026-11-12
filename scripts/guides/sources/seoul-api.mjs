// 서울 열린데이터광장 OpenAPI 를 쪽마다 받는다. 문화행사·공공서비스예약이 같이 쓴다(인증키도 같은 SEOUL_API_KEY).
// http 만 된다(openapi.seoul.go.kr:8088).

const PAGE = 1000; // 한 번에 최대 1000건
// 문화행사는 10,000건을 넘는다(2026-11-04 에 10쪽에서 멈췄다) — 넉넉히.
const MAX_PAGES = 30;

// 응답 한 쪽. 데이터가 없으면 서비스 이름 대신 맨 위에 RESULT(INFO-200)만 온다 — 빈 쪽으로 읽는다.
export function seoulPage(body, service) {
  const root = body?.[service];
  if (!root) {
    const code = body?.RESULT?.CODE;
    if (code === "INFO-200") return { rows: [], total: 0 };
    if (code) throw new Error(`${code} ${body.RESULT.MESSAGE ?? ""}`.trim());
    throw new Error(`응답 모양이 달라요: ${JSON.stringify(body).slice(0, 200)}`);
  }
  const code = root.RESULT?.CODE;
  if (code === "INFO-200") return { rows: [], total: 0 };
  if (code && code !== "INFO-000") throw new Error(`${code} ${root.RESULT.MESSAGE ?? ""}`.trim());
  return { rows: Array.isArray(root.row) ? root.row : [], total: Number(root.list_total_count ?? 0) };
}

// `label` 은 시험 응답 파일 이름의 앞부분이다(`<label>-1.json`, `<label>-2.json` …).
export async function seoulRows(fetchJson, key, service, label) {
  const rows = [];
  let start = 1;
  for (let i = 0; i < MAX_PAGES; i++) {
    const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key ?? "")}/json/${service}/${start}/${start + PAGE - 1}/`;
    const { rows: page, total } = seoulPage(await fetchJson(url, `${label}-${i + 1}`), service);
    rows.push(...page);
    start += PAGE;
    if (page.length < PAGE || start > total) break;
  }
  return rows;
}
