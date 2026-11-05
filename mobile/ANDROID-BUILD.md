# Windows에서 Android 시험 APK 만들기

저장소 루트에서 실행합니다. Node.js 22 이상과 `mobile/node_modules`가 필요합니다.

```powershell
npm ci --prefix mobile
& ./mobile/scripts/android-debug.ps1 -InstallTools -AcceptAndroidLicenses
```

이 명령은 공식 Temurin JDK 21, Android command-line tools, SDK 36, Build Tools 35/36, platform-tools, Gradle 의존성을 `mobile/.tools/`에 설치하고 앱을 컴파일합니다. 첫 다운로드는 약 0.8–1.5GB이며 압축 해제와 빌드 캐시를 위한 추가 공간이 필요합니다. `-AcceptAndroidLicenses`는 요청한 SDK 빌드 패키지의 라이선스를 수락하는 옵션입니다. 수동 검토하려면 이 옵션 없이 실행해 터미널의 안내를 따릅니다.

JDK·command-line tools·Gradle 배포 ZIP은 공식 SHA-256으로 검증합니다. JDK/SDK 경로와 캐시는 현재 PowerShell 프로세스에서만 지정하고 실행 후 원래 값으로 복원합니다. 시스템 Java, 전역 환경변수, Android Studio 설정은 변경하지 않습니다. `.tools/`, 생성된 `android/` 및 APK는 Git에서 제외됩니다.

이후에는 설치 옵션 없이 다시 실행합니다. 현재 웹 자산을 빌드하고 Capacitor 동기화 후 APK를 만듭니다.

```powershell
& ./mobile/scripts/android-debug.ps1
```

출력: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

이미 동기화한 자산과 네이티브 코드만 컴파일하려면 `-SkipSync`를 사용할 수 있습니다. 화면 코드를 수정했다면 기본 명령을 사용해야 최신 화면이 포함됩니다.

## 실제 Android 휴대폰에 설치

휴대폰에서 개발자 옵션과 USB 디버깅을 켜고 PC 연결 승인을 확인합니다. 다음 명령은 연결된 기기를 조회하고 시험 APK를 설치합니다. 여러 기기가 연결되었다면 `adb -s <serial> install -r ...`로 대상을 지정합니다.

```powershell
& ./mobile/.tools/android-sdk/platform-tools/adb.exe devices
& ./mobile/.tools/android-sdk/platform-tools/adb.exe install -r ./mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

디버그 APK는 로컬 시험용이며 스토어 배포 파일이 아닙니다. 설치/컴파일 성공만으로 화면 잠금 중 GPS가 검증되지는 않습니다. 실제 휴대폰에서 위치를 정확하게 허용한 뒤 디버거를 분리하고 [시험·출시 가이드](../docs/mobile-testing-release.md)의 30분 기록 절차를 진행합니다. 개발용 키는 `.tools/java-user/.android/` 또는 `.tools/android-user/`에 생성됩니다. `.tools`를 지운 후 다른 디버그 키로 재빌드하면 기존 설치 앱과 서명이 달라질 수 있으므로 먼저 GPX로 기록을 보관해야 합니다.

공식 근거: [Capacitor 8 요구 사항](https://capacitorjs.com/docs/updating/8-0), [Android 도구와 체크섬](https://developer.android.com/studio#command-line-tools-only), [Temurin JDK 21](https://adoptium.net/temurin/releases/?arch=x64&os=windows&version=21).
