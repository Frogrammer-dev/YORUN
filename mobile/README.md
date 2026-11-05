# 요런 Android · iPhone 러닝 기록 시제품

기존 Next.js 웹과 별도의 **백그라운드 위치 기록 검증용 앱**입니다. 웹에서 선택한 코스를 파일로 가져오고, 기록한 GPX를 웹의 작품방으로 가져오는 로컬 시험 흐름을 제공합니다. 배경 지도·방향 안내·로그인·서버 자동 동기화는 아직 연결되지 않았습니다. 기존 서비스 전체를 스토어에 배포한 상태가 아닙니다.

Android LocationManager + 위치 foreground service, iOS CoreLocation + background location을 사용합니다. 위치와 시작/정지 이벤트는 **네이티브 코드가 직접 앱 전용 파일에 저장**합니다. WebView의 타이머나 화면이 활성 상태일 필요가 없습니다. 화면은 저장된 이벤트를 읽어 거리·시간·GPX를 계산합니다.

## 설치와 실행

저장소 루트에서 Node.js 24를 사용합니다. 별도 잠금파일이 있으므로 루트 의존성과 별도로 설치합니다.

```powershell
npm ci --prefix mobile
npm run mobile:test
npm run mobile:build
```

Windows에서 APK만 만들려면 [Android 빌드 안내](ANDROID-BUILD.md)의 명령을 사용합니다. JDK 21과 Android SDK 36을 프로젝트 내부에 설치하는 스크립트를 제공합니다. 이미 도구가 설치된 이 작업 환경에서는 다음 명령으로 다시 빌드할 수 있습니다.

```powershell
& ./mobile/scripts/android-debug.ps1
```

출력은 `mobile/android/app/build/outputs/apk/debug/app-debug.apk`입니다. Android Studio에서 디버깅하려면 JDK 21, Android SDK 36을 준비하고 다음 명령으로 프로젝트를 엽니다.

```powershell
npm run mobile:android
npm --prefix mobile run open:android
```

Android Studio에서 실제 휴대폰을 선택해 Run을 누릅니다. 위치는 정확한 위치로 허용합니다. 알림 권한을 거절하면 기록 상태 알림이 알림창에 보이지 않을 수 있습니다. 앱 화면에서 시작한 세션만 기록하며 자동 시작·재부팅 후 자동 재개는 구현하지 않습니다.

iPhone 빌드는 **Mac과 Xcode 26 이상**이 필요합니다.

```bash
npm run mobile:ios
npm --prefix mobile run open:ios
```

Xcode의 Signing & Capabilities에서 개인 개발 팀과 실기기를 선택합니다. 사용 중 위치 권한과 정확한 위치를 허용합니다. 준비 스크립트가 위치 설명과 `UIBackgroundModes=location`을 적용합니다. Always 위치 권한은 요청하지 않습니다.

생성된 `mobile/android/`, `mobile/ios/`는 Git에서 제외합니다. `scripts/prepare-native.mjs`가 Capacitor 프로젝트 생성·플러그인 연결·iOS 설정을 재현합니다. 앱 ID는 시제품용 `kr.yorun.recorder`이며 정식 출시 전 팀의 앱 ID와 서명을 정해야 합니다. 생성 프로젝트에 추가 설정이 필요하면 먼저 준비 스크립트에 반영해 재생성 시 보존하세요.

## HTTPS 서버 없이 코스와 기록 전달하기

1. PC에서 `npm run dev`로 기존 웹을 실행하고 `http://localhost:3000`을 엽니다. 코스를 선택해 달리기 준비 화면으로 이동합니다.
2. **Android·iPhone 설치형 앱에서 달리기 → 설치형 앱용 코스 저장**을 눌러 `yorun-course.json`을 받습니다.
3. USB 또는 직접 선택한 파일 전달 수단으로 휴대폰에 옮긴 뒤, 설치형 앱의 **코스 파일 가져오기**에서 선택합니다. iPhone은 파일 앱에서 선택할 수 있는 위치에 저장합니다.
4. 코스 이름과 파란 목표선을 확인하고 **새 러닝 시작**을 누릅니다. 회색 점선은 획 사이 이동 구간이며, 초록 선은 실제 기록입니다. 기록·일시정지·중단 상태에서는 목표를 바꿀 수 없습니다.
5. 러닝 종료 후 **GPX 공유**로 파일을 PC에 옮깁니다. 기존 웹 시작 화면의 **내 GPX로 시작** 또는 작품방의 **작품 추가 (GPX)**에서 파일을 선택해 작품을 만듭니다.

코스 파일에는 목표 위치가 포함됩니다. 인증 정보·원래 코스 ID·도로 데이터는 넣지 않습니다. 최대 2MB, 좌표 20,000개, 총길이 100km까지 검증하며 잘못된 파일이나 저장 실패는 기존 목표를 덮어쓰지 않습니다. 목표 경로는 GPX에 섞지 않고 실제 수신한 GPS만 내보냅니다.

다음 목표 1개와 최근 러닝의 목표 연결 1개를 WebView 저장소에 보관합니다. 더 오래된 기록에는 목표가 표시되지 않을 수 있습니다. 목표 저장소 오류는 별도 네이티브 GPS 파일을 지우지 않습니다. 웹의 기존 GPX 가져오기 크기·좌표 수 제한은 그대로 적용됩니다. 로컬 웹의 도로 조회·지도 등 외부 서비스가 필요한 기능은 인터넷 연결이 필요합니다.

## 기록과 복구 규칙

- 네이티브가 위치마다 NDJSON 파일에 쓰고 디스크 동기화한 뒤 성공으로 처리합니다. 앱을 다시 열면 마지막 저장 기록을 읽습니다.
- 프로세스가 종료된 세션은 마지막 저장 시각에 중단된 것으로 복원합니다. 사용자가 재개하기 전에는 기록하지 않습니다. 강제 종료·운영체제 중단 후 연속 수집을 보장하지 않습니다.
- GPS 시각 기준 30초 초과 공백과 일시정지 전후는 다른 구간으로 내보냅니다. 누락된 이동을 직선 거리로 더하지 않습니다.
- 정확도 35m 초과, 8.5m/s 초과 이동, 잘못된 좌표·시각은 거리 계산에서 제외합니다. 3m 미만 움직임은 정지 중 오차 누적을 줄이기 위해 거리에서 제외합니다. 이 임계값은 실기기 검증이 필요합니다.
- 이전 러닝은 선택 목록에서 다시 볼 수 있습니다. GPX로 내보내 기존 웹의 GPX 가져오기에 사용할 수 있습니다. 자동 동기화는 없습니다.
- 저장 공간이 부족하면 기록을 중단하고 오류를 표시합니다. 이미 디스크에 저장된 지점은 유지합니다. 일부 쓰기 실패는 앱을 다시 열어 복구해야 합니다.
- 앱 삭제 시 기록이 사라집니다. 파일은 앱 내부에 두며 자동 서버 전송하지 않습니다. GPX 공유에는 위치가 포함됩니다. 진단 공유는 최근 최대 500개 이벤트의 종류·시각·정확도·수신 간격만 포함하며 좌표·세션 ID·자유 텍스트는 제외합니다.

## 검증 범위

`npm run mobile:test`는 네이티브 저널 입력을 재생해 GPS 공백, 정지 중 오차, 정지 직후 GPS 튐, 재개, 비정상 위치, GPX, 진단 정보 범위를 검사합니다. 코스 파일 검증·저장 실패·러닝별 목표 연결, 늦게 도착한 조회 응답도 검사합니다.

저장소 루트에서 `npm run test:mobile-app`으로 Chromium과 WebKit의 설치형 화면을 시험합니다. 파일 가져오기·재실행·잘못된 파일·저장 용량 부족·기록 중 목표 변경 금지·GPX 내보내기를 검증합니다. 네이티브 호출 경계에는 고정 응답을 주입하므로 OS 위치 서비스의 실제 동작을 검증하는 시험은 아닙니다. 루트 의존성과 Playwright Chromium/WebKit 설치가 필요합니다.

2026-10-20 기준 모바일 단위 시험 27개와 설치형 화면 시험 6개가 통과했습니다. Windows에서 Android debug APK 컴파일·서명 검증을 완료했고 최신 화면이 APK에 포함된 것도 확인했습니다. iOS 프로젝트 동기화는 완료했지만 Mac/Xcode 컴파일과 양쪽 실기기 GPS 시험은 미실행입니다.

`mobile:build`는 앱에 포함할 HTML/JS를 만듭니다. `mobile:android`와 `mobile:ios`는 프로젝트를 준비하며 **이 명령 자체는 앱 컴파일 또는 실기기 검증을 뜻하지 않습니다.**

`.github/workflows/mobile-native.yml`은 PR 또는 수동 실행에서 Android debug APK와 iOS simulator 빌드를 검사합니다. 워크플로 파일을 추가한 것만으로 원격 CI가 통과한 것은 아닙니다. 배포·업로드·서명 키 등록은 수행하지 않습니다.

Mac에서 iOS 서명 없이 컴파일하려면 `mobile` 폴더에서 실행합니다.

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

첫 실기기 합격 기준은 **30분 동안 화면 잠금·다른 앱 전환·데이터 통신 끊김 후 저장 기록과 GPX를 확인**하는 것입니다. 디버거를 분리하고 Android 배터리 제한, iPhone 저전력 모드, 권한 변경, 강제 종료 후 명시적 재개를 따로 시험합니다. 배터리 소모와 최대 GPS 수신 공백을 기록하세요. 자세한 절차와 서버 준비는 [모바일 시험·출시 가이드](../docs/mobile-testing-release.md)를 참고합니다.

참고: [Capacitor 개발 환경](https://capacitorjs.com/docs/getting-started/environment-setup), [Android 위치 권한과 foreground service](https://developer.android.com/develop/sensors-and-location/location/permissions), [Apple 백그라운드 위치](https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates).
