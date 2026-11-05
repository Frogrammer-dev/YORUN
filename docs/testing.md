# 테스트·품질 관리

푸시·PR마다 GitHub Actions(`.github/workflows/ci.yml`)가 아래 1~4를 자동으로 돌린다. 실패하면 Actions 아티팩트에
Playwright 보고서·trace가 남는다.

| 층 | 명령 | 무엇을 보나 | 걸리는 시간 |
|---|---|---|---|
| 1. 타입·규칙 | `npm run typecheck` · `npm run lint` | TypeScript 7 타입, ESLint(next core-web-vitals + typescript) | 수십 초 |
| 2. 단위 | `npm test` | 알고리즘·파서·계약, 외부 서버 주고받기(MSW), 화면 조각(Testing Library), 탐색 결정성 | 약 1분 |
| 3. 코스 품질 기준선 | `npm run test:quality` | 고정한 실제 지도(강남 2곳)에서 코스 품질이 기준선보다 나빠지지 않았는지 | 약 20초 (2에 포함) |
| 4. 브라우저 E2E | `npm run test:e2e -- --project=desktop --project=mobile --project=mobile-webkit` | 작품방·코스 찾기·달리기·화면 이동, Android/iPhone 화면 및 기록 복원 | 환경에 따라 수분 |
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
npm run test:e2e -- --project=desktop --project=mobile --project=mobile-webkit  # 빌드 → 서버 → 브라우저 3종
npm run test:e2e -- --grep '@run' --project=mobile --project=mobile-webkit     # 두 모바일의 러닝 흐름만
PW_CHANNEL=msedge npm run test:e2e -- --project=desktop --project=mobile      # 설치된 Edge로 Chromium 시험
npm run test:e2e:report             # 지난 실행 보고서
npx playwright show-trace test-results/<테스트>/trace.zip   # 실패 trace 보기
```

- 처음 한 번 Playwright 브라우저가 필요하다: `npx playwright install chromium webkit`. `PW_CHANNEL=msedge`는 Chromium 프로젝트만 대체하며 iPhone 시험에는 WebKit 설치가 필요하다.
- 이미 `:3123`에 서버가 떠 있으면 재사용한다. 코드 변경 후에는 해당 서버가 최신 빌드를 사용하는지 확인한다.
- `mobile`은 Pixel 7을 바탕으로 한 360px Chromium, `mobile-webkit`은 iPhone 13을 바탕으로 한 WebKit이다. `@mobile` 화면 시험과 `@run` 러닝 시험을 두 프로젝트에서 모두 실행한다. 데스크톱도 `@run`을 실행한다.
- `@run`은 코스 달리기·이탈 경고·일시정지·재개·종료 확인·완료 화면 복원·포인트 중복 방지·작품방 이동·GPX 내보내기·설치형 앱용 코스 파일 저장을 검증한다. 화면 숨김/`pagehide` 시 즉시 저장, 위치 권한 거절, 저장 용량 초과 경고도 포함한다.
- GPS 좌표와 시각은 `e2e/run-gps.ts`가 브라우저의 Geolocation 경계에 주입한다. Chromium/WebKit의 위치 에뮬레이션 차이와 실제 이동 대기에 기대지 않으며, 앱에 테스트용 분기는 넣지 않는다.
- `@live`는 실제 지도 서버를 쓰므로 별도 명령 `npm run test:e2e:live`로 실행한다. 전체 브라우저 명령에는 위처럼 프로젝트를 지정해 실서버 시험을 제외한다.

### 설치형 시제품의 자동 시험

```bash
npm ci --prefix mobile
npm run mobile:test
npm run test:mobile-app
```

`mobile:test`는 기록 모델·비동기 조회·공용 코스 계약·목표 저장소를 Node.js에서 검사한다. `test:mobile-app`은 별도의 로컬 서버(3191 포트)에서 번들된 화면을 Chromium과 WebKit으로 실행한다. 코스 파일 가져오기·잘못된 파일·저장 용량 부족·재실행·러닝 중 목표 변경 금지·파일 선택 화면에서 복귀 중 조회 경합·실제 기록만 담은 GPX를 검사한다. 루트 Playwright 의존성과 Chromium/WebKit이 필요하다.

네이티브 호출 경계의 고정 응답은 화면 동작 시험용이다. Android 서비스·iOS CoreLocation·실제 파일 선택기·권한 화면·공유 시트가 정상인지까지 증명하지 않는다. CI 브라우저 작업에도 이 시험을 추가했고, 네이티브 컴파일은 별도 `.github/workflows/mobile-native.yml`에서 수행한다. 설정 추가와 원격 CI 실행 성공은 구분한다.

2026-10-20 로컬 검증: 모바일 단위 27개, 설치형 화면 6개, 웹 러닝 및 모바일 너비 E2E 27개 통과. Android debug APK 빌드·서명 검증 완료. 자세한 기기 시험과 빌드 절차는 [모바일 시험·출시 안내](mobile-testing-release.md)를 따른다.

### Android·iPhone 실기기에서 반드시 확인할 항목

브라우저의 모바일 에뮬레이션은 화면 크기와 웹 동작을 검증한다. OS가 화면을 잠그거나 앱을 백그라운드로 보냈을 때 GPS를 계속 기록하는지는 설치형 앱의 출시용 빌드로 따로 확인한다.

| 상황 | 확인할 결과 |
|---|---|
| 위치 권한 거절·재허용, 정확한 위치 끄기 | 안내와 시작 가능 상태가 실제 권한에 맞게 바뀐다 |
| 화면 잠금·음악 앱 전환 후 30분 야외 러닝 | GPS 수신 간격·배터리·발열·거리 오차를 기록하고 복귀 시 전체 경로를 확인한다 |
| 통신 끊김·재연결 | 진행 중 기록이 기기에 남고 연결 복구 후 저장을 재시도할 수 있다 |
| 강제 종료·OS 종료 후 재실행 | 이미 보관한 기록을 복원하고 GPS 공백을 임의의 직선으로 잇지 않는다 |
| 저장 실패·완료 직후 종료 | 저장 실패 안내와 GPX 내보내기를 확인하고, 저장에 성공한 완료 기록은 작품방 이동 전까지 복원한다 |

Android는 USB 디버깅과 Chrome의 `chrome://inspect/#devices`, 네이티브 부분은 Android Studio 로그로 확인한다. iPhone은 Mac의 Safari Web Inspector와 Xcode를 사용한다. 마지막 실기기 시험은 디버거를 분리해 실행하고 기기·OS·앱 버전을 결과와 함께 남긴다.

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
