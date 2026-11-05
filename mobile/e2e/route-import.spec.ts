import { test, expect } from '@playwright/test';

const content = JSON.stringify({ format: 'yorun.route', version: 1, name: '로컬 네모', points: [[35, 129], [35.001, 129], [35.001, 129.001], [35, 129.001], [35, 129]], moves: [[1, 2]] });
const file = (buffer: string) => ({ name: 'yorun-course.json', mimeType: 'application/json', buffer: Buffer.from(buffer) });

test('course import persists, draws transfer segments and preserves the previous course on invalid input', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('코스 파일 가져오기').setInputFiles(file(content));
  await expect(page.locator('#route-title')).toHaveText('다음 러닝 목표: 로컬 네모');
  await expect(page.locator('#route-preview .planned')).toHaveCount(2);
  await expect(page.locator('#route-preview .transfer')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#route-title')).toContainText('로컬 네모');
  await page.getByLabel('코스 파일 가져오기').setInputFiles(file('{broken'));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#route-title')).toContainText('로컬 네모');
  await page.getByRole('button', { name: '목표 코스 지우기' }).click();
  await expect(page.locator('#route-title')).toContainText('자유 달리기');
  await page.reload();
  await expect(page.locator('#route-preview')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(errors).toEqual([]);
});

test('storage failure does not claim the imported course was saved', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('코스 파일 가져오기').setInputFiles(file(content));
  await expect(page.locator('#route-title')).toContainText('로컬 네모');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await page.getByLabel('코스 파일 가져오기').setInputFiles(file(content.replace('로컬 네모', '저장 실패 코스')));
  await expect(page.getByRole('alert')).toContainText('저장하지 못했어요');
  await expect(page.locator('#route-title')).toContainText('로컬 네모');
});

// Substitute only the native bridge; exercise the shipped UI and storage code.
// This proves UI association/exports, not Android/iOS background GPS execution.
test('native bridge flow locks the goal during a run and exports only recorded GPS', async ({ page }) => {
  await page.addInitScript(() => {
    const current = () => JSON.parse(localStorage.getItem('test.nativeJournal') || '{"id":null,"events":[]}');
    Object.assign(globalThis, {
      androidBridge: {},
      Capacitor: {
        PluginHeaders: [{ name: 'YorunRecorder', methods: ['snapshot', 'list', 'command', 'exportFile'].map(name => ({ name, rtype: 'promise' })) }],
        nativePromise: async (_plugin: string, method: string, options: { action?: string; id?: string; data?: string; filename?: string } = {}) => {
          if (method === 'snapshot') {
            if (localStorage.getItem('test.slowRead')) await new Promise(resolve => setTimeout(resolve, 200));
            return options.id === 'history-run' ? { id: 'history-run', events: [{ type: 'start', time: 1000 }, { type: 'stop', time: 2000 }] } : current();
          }
          if (method === 'list') return { records: [{ id: 'history-run' }] };
          if (method === 'exportFile') { localStorage.setItem('test.nativeExport', JSON.stringify(options)); return {}; }
          if (method === 'command') {
            const next = options.action === 'start' ? { id: 'current-run', events: [
              { type: 'start', time: 1000 },
              { type: 'point', time: 2000, receivedAt: 2000, lat: 35, lng: 129, accuracy: 5 },
              { type: 'point', time: 5000, receivedAt: 5000, lat: 35.0001, lng: 129, accuracy: 5 },
            ] } : current();
            if (options.action !== 'start') next.events.push({ type: options.action, time: 6000 });
            localStorage.setItem('test.nativeJournal', JSON.stringify(next)); return {};
          }
          throw new Error(`Unexpected native method: ${method}`);
        },
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('코스 파일 가져오기').setInputFiles(file(content));
  await page.evaluate(() => { localStorage.setItem('test.slowRead', '1'); document.dispatchEvent(new Event('visibilitychange')); });
  // File picker selection arrives while the resume-triggered native read is pending.
  await page.getByLabel('코스 파일 가져오기').setInputFiles(file(content.replace('로컬 네모', '파일 선택 복귀')));
  await expect(page.locator('#route-title')).toContainText('파일 선택 복귀');
  await page.evaluate(() => localStorage.removeItem('test.slowRead'));
  await page.getByLabel('코스 파일 가져오기').setInputFiles(file(content));
  await page.getByRole('button', { name: '새 러닝 시작' }).click();
  await expect(page.locator('#route-title')).toHaveText('이 러닝의 목표: 로컬 네모');
  await expect(page.getByLabel('코스 파일 가져오기')).toBeDisabled();
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(page.getByLabel('코스 파일 가져오기')).toBeDisabled();
  await page.reload();
  await expect(page.locator('#track .planned')).toHaveCount(2);
  await page.getByRole('button', { name: '러닝 종료', exact: true }).click();
  await page.getByLabel('코스 파일 가져오기').setInputFiles(file(content.replace('로컬 네모', '다음 코스')));
  await expect(page.locator('#route-title')).toContainText('다음 코스');
  await page.getByLabel('저장된 러닝').selectOption('history-run');
  await expect(page.getByLabel('코스 파일 가져오기')).toBeDisabled();
  await expect(page.locator('#track .planned')).toHaveCount(0);
  await page.getByRole('button', { name: '현재 러닝으로 돌아가기' }).click();
  await page.getByRole('button', { name: 'GPX 공유', exact: true }).click();
  const exported = await page.evaluate(() => JSON.parse(localStorage.getItem('test.nativeExport')!));
  expect((exported.data.match(/<trkpt /g) || []).length).toBe(2);
  expect(exported.data).not.toContain('129.001');
});
