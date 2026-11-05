param(
    [switch]$InstallTools,
    [switch]$AcceptAndroidLicenses,
    [switch]$SkipSync
)

$ErrorActionPreference = 'Stop'
$mobileRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsRoot = Join-Path $mobileRoot '.tools'
$downloads = Join-Path $toolsRoot 'downloads'
$sdkRoot = Join-Path $toolsRoot 'android-sdk'
$jdkRoot = Join-Path $toolsRoot 'jdk-21.0.12.1+1'
$sdkManager = Join-Path $sdkRoot 'cmdline-tools/latest/bin/sdkmanager.bat'

function Get-VerifiedArchive([string]$Url, [string]$Name, [string]$Sha256) {
    $archive = Join-Path $downloads $Name
    if (!(Test-Path -LiteralPath $archive)) {
        & curl.exe --fail --location --retry 3 --output $archive $Url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Name" }
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $Sha256) {
        throw "SHA-256 mismatch: $archive. Remove this archive and retry."
    }
    return $archive
}

if ($InstallTools) {
    New-Item -ItemType Directory -Force -Path $downloads | Out-Null
    # Official Adoptium API metadata and Android download page, checked 2026-10-20.
    # https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse
    # https://developer.android.com/studio#command-line-tools-only
    if (!(Test-Path -LiteralPath (Join-Path $jdkRoot 'bin/java.exe'))) {
        $jdkArchive = Get-VerifiedArchive `
            'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip' `
            'OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip' `
            'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e'
        Expand-Archive -LiteralPath $jdkArchive -DestinationPath $toolsRoot -Force
    }
    if (!(Test-Path -LiteralPath $sdkManager)) {
        $sdkArchive = Get-VerifiedArchive `
            'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' `
            'commandlinetools-win-15859902_latest.zip' `
            '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
        $staging = Join-Path $toolsRoot 'sdk-unpack'
        Expand-Archive -LiteralPath $sdkArchive -DestinationPath $staging -Force
        $source = [IO.Path]::GetFullPath((Join-Path $staging 'cmdline-tools'))
        $destination = [IO.Path]::GetFullPath((Join-Path $sdkRoot 'cmdline-tools/latest'))
        $allowedPrefix = $toolsRoot + [IO.Path]::DirectorySeparatorChar
        if (!$source.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            !$destination.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'SDK extraction path is outside mobile/.tools.'
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Move-Item -LiteralPath $source -Destination $destination
    }
}

if (!(Test-Path -LiteralPath (Join-Path $jdkRoot 'bin/java.exe')) -or !(Test-Path -LiteralPath $sdkManager)) {
    throw 'Portable build tools are missing. Run with -InstallTools (about 0.8-1.5 GB download including SDK and Gradle).'
}

# All environment overrides are process-local and restored when this script returns.
$environmentNames = @('JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_USER_HOME', 'GRADLE_USER_HOME', 'JAVA_TOOL_OPTIONS', 'PATH')
$previous = @{}
foreach ($name in $environmentNames) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:JAVA_HOME = $jdkRoot
    $env:ANDROID_HOME = $sdkRoot
    $env:ANDROID_SDK_ROOT = $sdkRoot
    $env:ANDROID_USER_HOME = Join-Path $toolsRoot 'android-user'
    $env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle'
    $javaUserHome = Join-Path $toolsRoot 'java-user'
    New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME, $env:GRADLE_USER_HOME, $javaUserHome | Out-Null
    $env:JAVA_TOOL_OPTIONS = '-Duser.home="' + $javaUserHome + '"'
    $env:PATH = (Join-Path $jdkRoot 'bin') + [IO.Path]::PathSeparator + $env:PATH
    if ($AcceptAndroidLicenses) {
        if (!$InstallTools) { throw '-AcceptAndroidLicenses requires -InstallTools.' }
    }
    if ($InstallTools) {
        # Accept only licenses requested by these build packages, not every optional SDK.
        if ($AcceptAndroidLicenses) {
            1..10 | ForEach-Object { 'y' } | & $sdkManager "--sdk_root=$sdkRoot" 'platforms;android-36' 'build-tools;35.0.0' 'build-tools;36.0.0' 'platform-tools'
        } else {
            & $sdkManager "--sdk_root=$sdkRoot" 'platforms;android-36' 'build-tools;35.0.0' 'build-tools;36.0.0' 'platform-tools'
        }
        if ($LASTEXITCODE -ne 0) { throw 'Android SDK package installation failed. Review SDK licenses with -AcceptAndroidLicenses.' }
    }
    if (!$SkipSync) {
        & npm.cmd --prefix $mobileRoot run android
        if ($LASTEXITCODE -ne 0) { throw 'Capacitor Android preparation failed.' }
    }
    Push-Location (Join-Path $mobileRoot 'android')
    try {
        $wrapperProperties = Join-Path $mobileRoot 'android/gradle/wrapper/gradle-wrapper.properties'
        $wrapperText = Get-Content -LiteralPath $wrapperProperties -Raw
        if ($wrapperText -notmatch 'distributionSha256Sum=') {
            if ($wrapperText -notmatch 'gradle-8\.14\.3-all\.zip') {
                throw 'Gradle version changed; verify its official SHA-256 before updating this script.'
            }
            # https://services.gradle.org/distributions/gradle-8.14.3-all.zip.sha256
            Add-Content -LiteralPath $wrapperProperties -Value 'distributionSha256Sum=ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c'
        }
        & .\gradlew.bat --no-daemon --console=plain --max-workers=2 :app:assembleDebug
        if ($LASTEXITCODE -ne 0) { throw 'Android debug APK compilation failed.' }
    } finally { Pop-Location }
    Get-Item -LiteralPath (Join-Path $mobileRoot 'android/app/build/outputs/apk/debug/app-debug.apk') | Select-Object FullName, Length
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
