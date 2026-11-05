# 모바일 시험과 출시 순서

Android와 iPhone 모두 화면 잠금·다른 앱 사용 중 GPS 기록이 필요한 프로젝트다. 웹의 기록 안정화와 네이티브 기록 시제품을 분리해 검증한 뒤 전체 앱을 연결한다.

## 지금 코드에 포함된 범위

| 구성 | 현재 역할 | 아직 별도로 검증·구현할 것 |
|---|---|---|
| 기존 Next.js 웹 `/run` | GPS 필터, 30초 초과 수신 공백 분리, 일시정지·완료 복원, 화면 숨김 시 저장 시도, 저장 실패 표시, 진단 내보내기 | 실기기 브라우저 화면·권한·공유 시험. 웹 자체는 백그라운드 기록을 보장하지 않음 |
| `mobile/` 설치형 시제품 | Android/iOS 네이티브 위치 수집과 파일 기록, 시작·정지·복원, 코스 파일 가져오기·목표 표시·GPX 공유 | iOS 컴파일·서명, 양쪽 기기 백그라운드 실행·배터리 시험. Android debug APK 빌드 완료 |
| 설치형 전체 제품 | 웹 코스 → 설치형 기록 → 웹 작품방을 파일로 전달해 로컬 시험 가능 | 앱 내부 지도·코스 탐색·로그인·작품방, 서버 인증·자동 동기화·실패 재시도 |

설치형 시제품의 웹 화면은 로컬 파일로 앱에 포함한다. `Next.js` 서버 API·Python·도로 SQLite를 앱에 복사해서 실행하는 구조가 아니다. 시제품 설치 명령과 플랫폼별 구성은 [mobile/README.md](../mobile/README.md)를 따른다.

**자동 시험 통과는 실기기 백그라운드 기록 성공을 뜻하지 않는다.** 아래 실기기 결과표를 실제로 채우고 설치형 전체 기능을 연결하기 전까지는 개발 시제품이다.

### 최근 검증 결과 (2026-10-20)

- 웹 프로덕션 빌드·타입 검사 및 변경한 웹/모바일 코드의 ESLint 통과.
- 모바일 기록 모델·비동기 조회·코스 계약·목표 저장소 단위 테스트 27개 통과.
- 웹 러닝 E2E 21개(데스크톱·Android Chromium·iPhone WebKit)와 모바일 화면 너비 검사 6개, 총 27개 통과.
- 설치형 화면 E2E 6개 통과: 코스 가져오기·재실행·저장 실패·기록 중 목표 잠금·파일 선택 복귀 경합·GPX. 네이티브 호출은 고정 응답이다.
- Windows의 JDK 21·SDK 36으로 Android debug APK 컴파일 성공. APK 서명, 위치 foreground service와 권한 선언, 최신 화면 번들 포함을 확인했다.
- iOS 프로젝트와 최신 화면 자산 동기화 완료. **Mac/Xcode 컴파일·기기 설치·양쪽 실기기 GPS/배터리 시험·서버 배포·스토어 제출은 미실행**이다.

### 이전 검증 결과 (2026-10-19)

- 웹 프로덕션 빌드와 타입 검사, 변경한 웹 코드·테스트의 ESLint 통과.
- 기록·브라우저 수명주기·보상·저장 관련 단위 테스트 51개 통과.
- 설치형 화면의 기록 재생·GPS 튐·진단 정보 범위·비동기 조회 경합 테스트 13개와 모바일 화면 번들 빌드 통과.
- 데스크톱·Android Chromium·iPhone WebKit의 러닝 E2E 18개, 두 모바일의 화면 너비 검사 6개 통과. 실제 GPS 대신 고정 입력을 사용했다.
- Android/iOS 프로젝트 생성과 Capacitor 플러그인 연결 확인. 이는 APK/IPA 컴파일 성공을 의미하지 않는다.
- 당시 네이티브 컴파일·실기기 GPS/배터리 시험은 미실행이었다. Android 컴파일은 위 2026-10-20 결과로 갱신한다.

## 1. PC에서 먼저 확인

저장소 루트에서 실행한다. 프로젝트는 Node.js 24 환경을 기준으로 확인한다. 모바일 의존성은 `mobile/package-lock.json`으로 별도 관리한다.

```powershell
npm ci
npm --prefix mobile ci
npm run typecheck
npx eslint src/components/run/RunApp.tsx src/lib/run tests/run.test.ts tests/run-browser.test.tsx
npx vitest run tests/run.test.ts tests/run-browser.test.tsx
npm run mobile:test
npm run mobile:build
npx playwright install chromium webkit
npm run test:e2e -- --grep '@run|@mobile' --project=desktop --project=mobile --project=mobile-webkit
npm run test:mobile-app
```

- 단위 시험: GPS 값·시각·공백·거리, Wake Lock 요청과 해제의 경합, 늦게 도착한 위치 콜백, 화면 이탈 저장, 진단에서 개인 데이터 제외를 검사한다.
- Playwright: 실제 GPS 대신 같은 좌표·시각을 주입해 시작 → 일시정지 → 재개 → 종료 → 복원·GPX·작품방 흐름을 검사한다. 저장 실패·권한 거절·화면 숨김도 재현한다.
- `mobile`은 Chromium 기반 Android 화면, `mobile-webkit`은 iPhone 화면이다. OS 위치 서비스나 배터리 절약 동작을 재현하지 않는다.
- E2E가 기존 3123 포트 서버를 재사용하면 최신 코드의 서버인지 먼저 확인한다. 다른 작업의 서버를 임의로 종료하지 않는다.
- 실패 trace는 `npx playwright show-trace <trace.zip 경로>`로 연다. 전체 검증과 CI 설명은 [testing.md](testing.md)를 참고한다.

설치된 Edge로 Chromium 시험을 실행하려면 PowerShell에서 다음처럼 지정한다. WebKit 시험은 여전히 Playwright의 WebKit 설치가 필요하다.

```powershell
$env:PW_CHANNEL = 'msedge'
npm run test:e2e -- --grep '@run' --project=desktop --project=mobile --project=mobile-webkit
Remove-Item Env:PW_CHANNEL
```

### 서버가 없는 현재의 파일 전달 시험

PC의 `npm run dev`로 웹을 띄운 뒤 코스를 선택한다. 달리기 준비 화면에서 **Android·iPhone 설치형 앱에서 달리기 → 설치형 앱용 코스 저장**을 눌러 JSON 파일을 받는다. 휴대폰으로 파일을 옮겨 설치형 앱의 **코스 파일 가져오기**에서 선택하고 새 러닝을 시작한다.

종료 후 **GPX 공유**로 파일을 PC에 옮긴다. 웹 시작 화면의 **내 GPX로 시작** 또는 작품방의 **작품 추가 (GPX)**에서 작품을 만든다. 이 전달에는 공개 HTTPS 서버나 앱 로그인이 필요하지 않다. PC 웹의 도로 조회·지도는 해당 외부 서비스 연결이 필요할 수 있다. [자세한 전달 규칙](../mobile/README.md#https-서버-없이-코스와-기록-전달하기)

목표 경로는 실제 GPS와 구별해 표시하고 GPX에는 넣지 않는다. 코스 파일에는 위치가 담기므로 전달 대상을 직접 선택한다. 목표 저장소에는 다음 목표와 최근 러닝의 연결만 남기며, 네이티브 GPS 저널은 별도로 유지한다. 배경 지도·방향 안내·서버 자동 동기화는 후속 작업이다.

## 2. 휴대폰에서 웹 화면 디버깅

휴대폰의 `localhost`는 휴대폰 자신이다. PC의 `http://192.168.x.x:3000`에 접속하는 방식은 화면 확인에 쓸 수 있지만 GPS가 요구하는 보안 연결이 아니다. 가장 단순한 방법은 신뢰할 수 있는 인증서가 있는 HTTPS 시험 서버다. 브라우저 Console에서 `window.isSecureContext`와 위치 권한 상태를 확인한다. [MDN 보안 컨텍스트](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)

같은 Wi-Fi에서 로컬 개발 서버에 접속할 수도 있다.

```powershell
npm run dev -- --hostname 0.0.0.0 --experimental-https
```

이 명령은 개발용 자체 서명 인증서를 만든다. PC에서 신뢰한 인증서가 휴대폰에서도 자동으로 신뢰되지는 않는다. 접속 주소가 인증서에 포함되어 있고 휴대폰에서도 발급자를 신뢰해야 한다. 인증서 오류를 단순히 넘기는 방식으로 GPS 동작을 판단하지 않는다. 필요하면 `--experimental-https-key`, `--experimental-https-cert`, `--experimental-https-ca`로 준비한 인증서를 지정한다. 이 옵션은 저장소에 설치된 `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`에서 확인할 수 있다.

| 대상 | 연결 및 확인 방법 |
|---|---|
| Android + Windows | 휴대폰 개발자 옵션의 USB 디버깅을 켜고 케이블로 연결한다. PC Chrome의 `chrome://inspect/#devices`에서 해당 탭의 Console·Network를 연다. 위치 권한 거절·재허용, 화면 회전, 지도 터치, 파일 공유를 확인한다. [Chrome 안내](https://developer.chrome.com/docs/devtools/remote-debugging/) |
| iPhone + Mac | iPhone Safari의 고급 설정에서 Web Inspector를 켜고 Mac Safari의 개발자 기능을 활성화한다. Mac Safari의 개발자 메뉴에서 연결된 iPhone 페이지를 검사한다. [WebKit 안내](https://webkit.org/web-inspector/enabling-web-inspector/) |

## 3. 설치형 앱 빌드와 디버깅

Android는 Windows에서 프로젝트 내부의 JDK·SDK를 쓰는 [APK 빌드 스크립트](../mobile/ANDROID-BUILD.md)로 컴파일할 수 있다. 로컬 도구가 준비된 현재 환경에서는 `& ./mobile/scripts/android-debug.ps1`을 실행한다. 결과는 `mobile/android/app/build/outputs/apk/debug/app-debug.apk`이며 로컬 설치 시험용이다.

Android Studio는 프로젝트를 열어 Logcat·중단점으로 디버깅할 때 사용할 수 있다. iOS 빌드·서명·기기 디버깅은 Mac의 Xcode와 Command Line Tools가 필요하다. 이 프로젝트의 Capacitor 버전에 맞는 도구 조건은 [Capacitor 환경 안내](https://capacitorjs.com/docs/getting-started/environment-setup)를 확인한다.

```powershell
# 저장소 루트: 의존성 설치 후 Android 프로젝트 준비
npm run mobile:android
npm --prefix mobile run open:android
```

Mac에서 같은 저장소와 `mobile/` 의존성을 준비한 뒤 실행한다.

```bash
npm run mobile:ios
npm --prefix mobile run open:ios
```

`mobile:android`/`mobile:ios` 준비 명령이 성공했다는 사실은 네이티브 컴파일 성공을 뜻하지 않는다. Android는 위 빌드 스크립트 또는 Android Studio로, iOS는 Xcode로 실제 컴파일·기기 설치까지 확인한다. 서명 계정·프로비저닝·배포용 식별자는 개발자 환경에 맞게 설정하고 저장소에 비밀 키를 넣지 않는다.

Android Studio Logcat과 Xcode Console은 네이티브 위치 서비스·권한·파일 저장 오류를 확인하는 용도다. WebView의 Console만 보면 화면 JavaScript가 멈춘 동안의 위치 수집 오류를 놓칠 수 있다. 마지막 야외 시험은 디버거·USB를 분리한 출시용 빌드로 반복한다.

## 4. 30분 야외 시험표

처음에는 두 플랫폼에서 각각 한 기기씩 실행하고, 이후 Android 제조사·OS 버전을 넓힌다. 시뮬레이터의 이동 경로 시험은 명령 처리와 화면 확인에 쓰고 실제 위치·배터리 검증은 기기에서 한다.

| 순서 | 상황 | 합격 기준 |
|---|---|---|
| 1 | 위치 권한 거절 후 재시도, 정확한 위치 끄기 | 실제 권한 상태와 오류 안내가 일치하며 기록 시작을 허위로 표시하지 않음 |
| 2 | 야외 GPS 확보 후 5분 화면을 켜고 이동 | 수신 시각·거리·경로가 갱신되고 저장된 기록과 일치 |
| 3 | 15분 화면 잠금 | 정상 수신 환경에서 화면 실행 여부 때문에 기록이 사라지지 않음. 복귀 시 전체 저장 기록을 다시 읽음 |
| 4 | 10분 음악 앱 사용·통신 끊김 | GPS 수집·기기 저장이 통신과 독립적으로 유지됨 |
| 5 | 일시정지 중 이동 후 재개 | 일시정지 구간은 거리에 더하지 않고 별도 선으로 기록 |
| 6 | 신호가 약한 구간 통과 | GPS 공백을 임의 직선으로 메우지 않음. 수신 간격과 정확도를 진단으로 설명 가능 |
| 7 | 종료 직후 앱 재실행 | 완료 기록·GPX가 유지되고 시간·거리가 새로 증가하지 않음 |
| 8 | 앱 강제 종료·OS 종료 후 재실행 | 이미 저장된 기록 복원, 중단 상태 표시, 재개 후 새 구간. 강제 종료 이후 지속 기록을 전제로 하지 않음 |
| 9 | 저장 공간 부족·공유 취소 | 성공으로 잘못 표시하거나 기존 저장 기록을 버리지 않음 |

기록 손실·중복·복원 실패·설명되지 않는 거리 증가가 하나라도 있으면 베타를 보류한다. 정상 GPS 환경에서 30초 초과 공백이 발생하면 원인을 확인하고 재시험한다. 건물 사이 GPS 불량은 화면 잠금에 의한 중단과 구분한다. 배터리 소모·발열·거리 오차는 기기별 실측치를 모아 제품의 허용 기준을 결정한다.

시험 결과는 아래 형식으로 남긴다. 공백이 없었다고 추정해서 채우지 않는다.

```text
시험 일시 / 코드 커밋 / 앱 버전·빌드 번호:
기기 / OS / 권한 / 배터리 절약 설정:
출시 빌드 여부 / 디버거 분리 여부:
화면 켬·잠금·다른 앱 사용 시간:
시작·종료 배터리 / 발열:
GPS 수신 수 / 최대 공백 / 제외 수 / 측정 거리:
일시정지·종료·재실행 복원 결과:
GPX 구간 수 / 비정상 연결·중복 여부:
통과·실패 / 재현 순서 / 진단 파일 위치:
```

## 5. 진단과 개인정보

웹 진단은 최근 최대 500개 GPS 판정·저장 결과·Wake Lock 상태를 메모리에만 보관한다. 페이지를 닫으면 진단 이벤트는 사라지므로 문제가 보이면 직접 내보낸다. 좌표·코스 ID·로그인 토큰·GPX를 진단에 포함하지 않는다. 설치형 진단도 좌표를 제외한 수신·상태 정보를 공유하도록 구성한다.

GPX에는 실제 위치와 시각이 담긴다. 사용자가 내보내기를 눌러 선택한 대상에게만 공유한다. 진단과 원시 GPS의 자동 업로드는 추가하지 않는다. 네이티브 기록은 기기 내부에 저장되므로 앱 삭제·기기 분실 전에 필요한 GPX를 보관한다. 앞으로 서버 오류 수집을 연결할 때도 요청 본문·GPS·인증 토큰이 수집되지 않는지 별도로 확인한다.

## 6. 서버와 전체 앱 연결

초기 시험 서버는 Node.js 24와 Python 실행 환경, 영구 파일 저장소를 갖춘 구성으로 준비한다. 서버 의존 기능이 있으므로 Next.js 정적 내보내기만으로 현재 API를 대체할 수 없다. 서버 배포 동작은 설치된 `node_modules/next/dist/docs/01-app/01-getting-started/17-deploying.md`를 참고한다.

- **웹/API:** `npm ci` → `npm run build` → `npm run start`. HTTPS 역방향 프록시와 재시작 정책을 설정하고, `/routes`·`/run`·`/room`과 실제 API를 확인한다.
- **그림 인식:** `CLIP_PYTHON`, `CLIP_MODEL_CACHE`를 서버의 실제 경로로 지정한다. Python 패키지와 모델을 사전 설치하며 요청 중 모델을 다운로드하지 않는다. 모델 파일은 Next.js 빌드에 자동 포함되지 않는다.
- **도로:** `ROAD_DATA_DIR`에 SQLite·manifest를 설치하고 재배포 후에도 유지한다. 데이터가 없으면 공용 Overpass 경로를 사용할 수 있지만 동일한 응답 시간·가용성을 가정하지 않는다. [도로 설치·갱신 안내](local-roads.md)
- **계정·공유:** `.env.example`을 기준으로 Supabase URL·anon key, 서버 전용 service role key를 설정한다. `APP_ORIGIN`을 실제 HTTPS 웹 주소로 바꾸고 Supabase의 로그인 복귀 허용 목록에 해당 `/auth/callback`을 등록한다. 시험·운영 프로젝트를 구분한다.
- **설치형 연결:** 모바일 지도·코스·로그인·작품방은 후속 통합 작업이다. 앱에서 인증 후 복귀할 딥링크와 세션 저장, API 인증, 오프라인 완료 기록의 업로드 재시도를 함께 설계한다. 기존 동일 출처 검사를 `*`로 풀어 앱 연결을 대신하지 않는다.
- **복구:** 배포 전 DB 마이그레이션, 이전 버전으로 되돌리는 절차, 영구 파일·DB 백업에서 복원하는 절차를 시험한다. 러닝 중 네트워크 장애는 기기 기록을 중단시키지 않아야 한다.

## 7. 베타에서 정식 출시까지

1. 네이티브 시제품의 양쪽 플랫폼 빌드와 위 30분 실기기 시험을 완료한다.
2. 현재의 코스·GPX 파일 전달 흐름을 앱 내부의 코스 선택 → 네이티브 기록 → 완료 → 작품방 저장으로 통합하고, 로그인 복귀와 통신 실패·중복 업로드를 시험한다.
3. 별도 HTTPS 시험 서버를 사용해 소수 사용자에게 Google Play 내부 테스트·TestFlight 빌드를 배포한다. 기기·OS별 결과와 오류 재현 자료를 모은다.
4. 알려진 기록 손실·복원 실패를 해결한 출시 후보로 다시 야외 시험한다. 위치 권한 설명, 개인정보 처리·기록 보관·삭제 안내, 스토어 위치 기능 설명을 실제 동작과 맞춘다.
5. 서명된 운영 빌드와 운영 서버를 준비하고 스토어 심사를 진행한다. 정책·도구 버전은 제출 시점의 공식 안내에서 확인한다. 운영 오류·저장 실패를 확인할 담당과 복구 절차를 정한다.

계정 생성·외부 배포·스토어 제출·실기기 실행은 이 문서 작성으로 수행되지 않는다. 완료 여부는 빌드 로그와 실제 시험 결과로 판단한다.
