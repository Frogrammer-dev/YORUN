# 테스트·품질 관리

푸시·PR마다 GitHub Actions(`.github/workflows/ci.yml`)가 아래 1~4를 자동으로 돌린다. 실패하면 Actions 아티팩트에
Playwright 보고서·trace가 남는다.

| 층 | 명령 | 무엇을 보나 | 걸리는 시간 |
|---|---|---|---|
| 1. 타입·규칙 | `npm run typecheck` · `npm run lint` | TypeScript 7 타입, ESLint(next core-web-vitals + typescript) | 수십 초 |
| 2. 단위 | `npm test` | 알고리즘·파서·계약, 외부 서버 주고받기(MSW), 화면 조각(Testing Library), 탐색 결정성 | 약 1분 |
| 3. 코스 품질 기준선 | `npm run test:quality` | 고정한 실제 지도(강남 2곳)에서 코스 품질이 기준선보다 나빠지지 않았는지 | 약 20초 (2에 포함) |
| 4. 브라우저 E2E | `npm run test:e2e` | 작품방·코스 찾기·달리기·화면 이동 흐름, 360px 화면 | 약 5분 |
| 실서버 확인 | `npm run test:e2e:live` | 실제 바탕 지도 서버가 키 없이 뜨는지 (CI 제외) | 1분 |
| 사람 판정 보정 | `npm run eval:make-set` → 판정 → `npm run eval:calibrate` | 점수 등급(또렷함·그럭저럭) 기준선 | 사람 판정 시간 |

## 원칙

- **같은 입력이면 같은 결과.** 코스 탐색은 앱에서는 시간 예산, 테스트에서는 단계 예산(`StepBudget`)을 쓴다
  (`src/lib/route/budget.ts`). 테스트에서 `Date.now()`·실제 시간에 기대지 않는다.
- **외부 서버는 한 곳에서 흉내.** Overpass(길)·Open-Meteo(고도)·바탕 지도는 `tests/mocks/handlers.ts`의 MSW 정의를
  단위 테스트(`msw/node`)와 E2E(`@msw/playwright`)가 함께 쓴다. 실서버 확인은 `@live` 테스트만.
- **E2E는 서로 기대지 않는다.** 테스트마다 새 브라우저 상태에서 시작한다. 달리기 테스트는 코스를 저장소에 직접 넣고 시작한다.
  모든 E2E는 끝날 때 브라우저 오류(페이지 예외·콘솔 오류)가 없었는지 자동 확인한다 (`e2e/fixtures.ts`).
- **성능 예산은 기록.** 동네 추천 45초·10km 영역 60초 예산을 넘으면 테스트 결과에 '성능 예산 초과'로 남긴다
  (CI 기기 편차가 커서 실패로 하지 않는다. 절대 상한은 테스트 시간 제한이 맡는다).

## 코스 품질 기준선

- 데이터: `tests/fixtures/osm/*.json.gz` (OpenStreetMap, ODbL — 같은 폴더 README 참고)
- 기준선: `tests/fixtures/quality-baseline.json`. 유사도가 2점 넘게 떨어지거나 동네 추천 코스 수가 2개 넘게 줄면 실패.
- 알고리즘을 고쳐 **나아졌다면** `npm run test:quality:update`로 기준선을 갱신하고, 바뀐 숫자를 커밋 메시지에 적는다.

## 브라우저 E2E

```bash
npm run test:e2e                    # 빌드 → 서버 → desktop·mobile 프로젝트 (이미 :3123에 서버가 있으면 재사용)
PW_CHANNEL=msedge npm run test:e2e  # Playwright 브라우저를 받지 않고 설치된 Edge로
npm run test:e2e:report             # 지난 실행 보고서
npx playwright show-trace test-results/<테스트>/trace.zip   # 실패 trace 보기
```

- 처음 한 번 Playwright 브라우저가 필요하다: `npx playwright install chromium` (또는 `PW_CHANNEL=msedge`)
- 테스트 이름에 `@mobile`이 있으면 360px 프로젝트, `@live`가 있으면 실서버 프로젝트에서만 돈다.

## 사람 판정으로 점수 등급 보정

모델 확신도·유사도 숫자는 사람이 실제로 알아보는 비율과 어긋나기 쉽다. 그래서 화면에는 숫자 대신 등급을 보여 주고,
등급 기준선(`src/lib/eval/calibration.json`)은 사람 판정으로 정한다. 지금 값은 **보정 전 잠정값**이다.

1. `npm run eval:make-set` → `eval/label-set/index.html` (고정 지도에서 모은 코스 수백 개, 순서는 섞임)
2. 브라우저로 열어 코스마다 "‘양’처럼 보이나요?"에 예/아니요 (점수는 보여 주지 않음). 끝나면 **판정 결과 저장**
3. 저장한 JSON을 `eval/labels/`에 넣고 `npm run eval:calibrate` → 기준선 갱신, 신뢰도 표 출력
   - 목표: 목록에 보여 주는 코스의 40%, '그럭저럭' 60%, '또렷함' 80% 이상을 사람이 알아볼 것 (95% 윌슨 하한)
   - 여러 사람이 판정할수록 정확해진다 (판정자마다 파일 하나)

참고 자료: Fowler, *Eradicating Non-Determinism in Tests* · Google, *The ML Test Score* · Guo et al. 2017, *On Calibration
of Modern Neural Networks* · Hendrycks & Gimpel 2017, *A Baseline for Detecting Misclassified and Out-of-Distribution Examples*
