import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import plist from 'plist';

const root = fileURLToPath(new URL('../', import.meta.url));
const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) throw new Error('Usage: node scripts/prepare-native.mjs android|ios');
const cli = path.join(root, 'node_modules/@capacitor/cli/bin/capacitor');
function cap(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// Generated projects are disposable. This script re-applies the source-controlled settings.
if (!existsSync(path.join(root, platform))) cap('add', platform, ...(platform === 'ios' ? ['--packagemanager', 'SPM'] : []));
if (platform === 'ios') {
  const infoPath = path.join(root, 'ios/App/App/Info.plist');
  const info = plist.parse(readFileSync(infoPath, 'utf8'));
  info.NSLocationWhenInUseUsageDescription = '달리기를 시작하면 화면을 잠그거나 다른 앱을 사용하는 동안에도 이동 경로를 이 휴대폰에 기록합니다.';
  info.UIBackgroundModes = [...new Set([...(info.UIBackgroundModes ?? []), 'location'])];
  writeFileSync(infoPath, plist.build(info));
}
cap('sync', platform);
console.log(platform === 'ios'
  ? 'iOS project prepared. On a Mac: npm run open:ios; choose your signing team and iPhone. Device recording has not been verified by this command.'
  : 'Android project prepared. npm run open:android; use JDK 21 and an Android SDK. Device recording has not been verified by this command.');
