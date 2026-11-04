// collect.mjs 를 시험 응답(fixtures — 가짜, 형식은 API 문서 기준)으로 끝까지 돌려 본다. 네트워크 없이 돈다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "fixtures");

function run(mockDir, { previous } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "guides-"));
  const out = join(dir, "guides.json");
  const ghOut = join(dir, "gh-output");
  writeFileSync(ghOut, "");
  if (previous) writeFileSync(out, JSON.stringify(previous));
  const env = {
    PATH: process.env.PATH,
    GUIDES_MOCK_DIR: mockDir,
    GUIDES_TODAY: "2026-11-04",
    GUIDES_OUT: out,
    TARGET_BRANCH: "main",
    GITHUB_OUTPUT: ghOut,
  };
  const log = execFileSync(process.execPath, [join(here, "collect.mjs")], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const feed = JSON.parse(readFileSync(out, "utf8"));
  const output = readFileSync(ghOut, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { feed, log, output };
}

test("세 소스를 합쳐 거르고 앱 순서로 놓는다", () => {
  const { feed, output } = run(fixtures);
  assert.equal(feed.formatVersion, 1);
  assert.deepEqual(
    feed.events.map((e) => e.id),
    ["yeyak-S261101000001", "seoul-f59ccfd1716a", "seoul-e8007e0a2df6", "tour-3001", "tour-4001"],
  );
  const jara = feed.events.find((e) => e.id === "tour-4001");
  assert.equal(jara.region, "경기");
  assert.equal(jara.place, "가평 · 자라섬");
  assert.match(jara.text, /^반려동물: /);
  assert.deepEqual(jara.source, { url: "http://www.jarasum.kr" });
  // 앱이 모르는 칸이나 undefined 가 없다
  for (const e of feed.events) for (const v of Object.values(e)) assert.notEqual(v, undefined);
  // main 에는 초안 보관법이 없다
  assert.ok(feed.foods.every((f) => !("draft" in f)));
  assert.match(output, /^failed=$/m);
});

test("소스 하나를 못 받으면 어제 것으로 채우고 실패로 알린다", () => {
  const dir = mkdtempSync(join(tmpdir(), "guides-mock-"));
  for (const f of readdirSync(fixtures)) if (!f.startsWith("tour-")) cpSync(join(fixtures, f), join(dir, f));
  const previous = {
    formatVersion: 1,
    events: [
      { id: "tour-9", title: "어제 받은 축제", region: "경기", startDate: "2026-11-20", endDate: "2026-11-22", credit: "한국관광공사" },
      { id: "tour-8", title: "끝난 축제", region: "경기", startDate: "2026-10-01", endDate: "2026-10-03" },
      { id: "seoul-old", title: "어제 서울", region: "서울", startDate: "2026-11-20", endDate: "2026-11-22" },
    ],
  };
  const { feed, output } = run(dir, { previous });
  rmSync(dir, { recursive: true, force: true });
  const ids = feed.events.map((e) => e.id);
  assert.ok(ids.includes("tour-9"), "어제 관광공사 몫을 가져온다");
  assert.ok(!ids.includes("tour-8"), "가져와도 날짜로 다시 거른다");
  assert.ok(!ids.includes("seoul-old"), "받은 소스는 어제 것을 쓰지 않는다");
  assert.match(output, /^failed=한국관광공사 축제$/m);
});

test("모든 소스를 못 받으면 쓰지 않고 실패한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "guides-empty-"));
  assert.throws(() => run(dir), /Command failed/);
  rmSync(dir, { recursive: true, force: true });
});
