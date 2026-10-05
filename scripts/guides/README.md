# guides.json — 무료 일정·식재료 보관법 피드

위클리 앱 꾹팁 탭의 「이번 주말 나들이」·「무료로 즐기기」·「식재료 보관법」이 읽는 파일입니다. 루트의 `guides.json` 을
GitHub Action(`.github/workflows/guides.yml`)이 매일 새벽 5시(서울)에 **main** 에서 새로 만듭니다. develop 은 필요할 때
**Actions → guides.json → Run workflow** 에서 갈래를 `develop` 으로 골라 돌려요. 스크립트는 늘 main 의 것을 쓰니
develop 에 이 폴더를 올릴 필요는 없어요. develop 에는 초안(`draft`) 보관법도 들어가 시뮬레이터에서 미리 볼 수 있어요.
형식의 정본은 weekly-challenge 저장소의 `src/utils/guides.ts` 입니다.

| 파일 | 누가 | 무엇 |
| --- | --- | --- |
| `guides.json` (루트) | Action | 앱이 받는 파일. 손으로 고치지 마세요 — 다음 날 덮어씁니다 |
| `scripts/guides/collect.mjs` | — | 서울 문화행사 API 를 받아 무료·30일 안의 일정만 거르고 `foods.json` 과 합칩니다 |
| `scripts/guides/foods.json` | 사람 | 식재료 보관법 |
| `scripts/guides/blocklist.json` | 사람 | 빼고 싶은 일정(제목에 들어간 낱말 `titles`, 또는 `ids`) |

## 처음 한 번

1. **서울 열린데이터광장 인증키**를 받아요. data.seoul.go.kr → 로그인 → 인증키 신청(일반 인증키).
2. 이 저장소 **Settings → Secrets and variables → Actions → New repository secret**:
   이름 `SEOUL_API_KEY`, 값은 받은 키.
3. 이 폴더(`scripts/guides/`)와 `.github/workflows/guides.yml` 을 **main** 에 올려요.
4. **Actions → guides.json → Run workflow** 로 한 번 돌려 봐요. main 에 `guides.json` 커밋이 생기면 됩니다.
   - 키가 틀렸거나 응답 모양이 다르면 실패하고, 기존 파일은 그대로 둡니다(로그에 이유가 찍혀요).
   - API 필드 이름(`TITLE`·`STRTDATE`·`END_DATE`·`IS_FREE`·`USE_FEE`·`PLACE`·`ORG_LINK` 등)은 문서를 보고 맞췄지만
     실제 응답으로 확인하지 못했어요. 첫 실행 로그의 「받은 N건 중 M건」을 봐 주세요.

## 보관법(`foods.json`) 올리기

- 지금 들어 있는 7개는 앱 개발용 예시에서 옮긴 **초안**이라 모두 `"draft": true` 예요.
- **main 에는 draft 가 빠지고 나갑니다** — 보관 기간을 확인하기 전에는 실사용자에게 보이지 않아요.
- 기간을 식약처 식품안전나라 같은 출처와 맞춰 본 뒤 `"draft": true` 를 지우고, 출처를 `"credit"` 에 적어요(예: `"식품안전나라"`).
- 칸은 `room`(실온)·`fridge`(냉장)·`freezer`(냉동). `null` 은 「두지 않아요」, 칸을 아예 안 적으면 「정보 없음」입니다.
  `span` 은 10자, `note` 는 20자, 이름은 15자까지. 넘으면 앱이 그 칸(또는 품목)을 버립니다.

## 시험해 보기 (로컬)

```bash
SEOUL_API_KEY=키 TARGET_BRANCH=develop node scripts/guides/collect.mjs   # 실제 API
SEOUL_API_MOCK=sample.json TARGET_BRANCH=main node scripts/guides/collect.mjs   # 저장해 둔 응답으로
```

## 지키는 것

- 무료(`IS_FREE` 「무료」 또는 요금이 「무료」로 시작)만, 오늘부터 30일 안에 시작하고 아직 끝나지 않은 것만. 최대 300건.
- 사진은 넣지 않아요(공공누리 유형 확인 없이 쓸 수 없어요).
- 공식 사이트 주소는 앱과 같은 조건(ASCII, 300자 이하, 계정·포트 없는 http(s), 호스트는 영문 소문자·숫자·점·하이픈)만.
- 0건이면 쓰지 않고 실패해요. 생성 시각만 바뀐 날은 커밋하지 않아요.
