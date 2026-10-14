import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

/** A DOM simulation, with no browser navigation, network or actual downloads. */
it.skipIf(process.env.ROAD_FIRST_REFERENCE_UI !== '1')('locks unassisted judgments before revealing reference layers and exports only normalized review data', () => {
  const root = path.resolve('eval/recognition/road-first-reference-20261014');
  const htmlPath = path.join(root, 'preview.html'), bytes = readFileSync(htmlPath);
  const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
  const report = JSON.parse(readFileSync(path.join(root, 'preview-validation.json'), 'utf8'));
  expect(hash(bytes)).toBe(report.htmlSha256);
  const dom = new JSDOM(bytes.toString('utf8'), { runScripts: 'outside-only' });
  const { window } = dom, document = window.document;
  let exported: { reviews: Array<{ candidateId: string; beforeAI: { freeName: string; recognizability: string; locked: boolean } | null; afterAI: { nameAcceptability: string | null; referenceHelps: string | null; notes: string } | null }>; firstVerdictCount: number; denominator: number; manualAgentPrototype: boolean } | undefined;
  let downloadedName = '', objectURLs = 0;
  class CapturedBlob {
    constructor(parts: string[]) { exported = JSON.parse(parts.join('')); }
  }
  Object.defineProperty(window, 'Blob', { value: CapturedBlob });
  window.URL.createObjectURL = () => { objectURLs++; return 'blob:simulated-review'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloadedName = this.download; };
  const scripts = Array.from(document.querySelectorAll('script:not([type])'));
  expect(scripts).toHaveLength(1);
  window.eval(scripts[0].textContent ?? '');

  try {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-card]'));
    expect(cards).toHaveLength(6);
    expect(cards.every(card => card.querySelector<HTMLElement>('.after')!.hidden)).toBe(true);
    const first = cards[0], reveal = first.querySelector<HTMLButtonElement>('.reveal')!;
    reveal.click();
    expect(first.querySelector<HTMLElement>('.after')!.hidden).toBe(true);
    expect(first.querySelector('[data-message]')!.textContent).toContain('먼저');

    const clear = first.querySelector<HTMLInputElement>('input[name="before-0"][value="clear"]')!;
    clear.checked = true;
    reveal.click();
    expect(first.querySelector<HTMLElement>('.after')!.hidden).toBe(true);
    expect(first.querySelector('[data-message]')!.textContent).toContain('이름');
    const freeName = first.querySelector<HTMLInputElement>('.free-name')!;
    freeName.value = '화면 동작 시험';
    reveal.click();
    expect(first.querySelector<HTMLElement>('.after')!.hidden).toBe(false);
    expect(freeName.readOnly).toBe(true);
    expect(Array.from(first.querySelectorAll<HTMLInputElement>('.before input[type="radio"]')).every(radio => radio.disabled)).toBe(true);
    expect(reveal.disabled).toBe(true);

    const reference = first.querySelector<HTMLInputElement>('[data-toggle="reference"]')!;
    reference.checked = false; reference.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(Array.from(first.querySelectorAll<SVGElement>('[data-layer="reference"]')).every(group => group.style.display === 'none')).toBe(true);
    reference.checked = true; reference.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(Array.from(first.querySelectorAll<SVGElement>('[data-layer="reference"]')).every(group => group.style.display === '')).toBe(true);
    const imagined = first.querySelector<HTMLInputElement>('[data-toggle="imagined"]')!;
    imagined.checked = false; imagined.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(Array.from(first.querySelectorAll<SVGElement>('[data-layer="imagined"]')).every(group => group.style.display === 'none')).toBe(true);

    for (let index = 1; index < cards.length; index++) {
      const card = cards[index];
      card.querySelector<HTMLInputElement>(`input[name="before-${index}"][value="none"]`)!.checked = true;
      card.querySelector<HTMLButtonElement>('.reveal')!.click();
      expect(card.querySelector<HTMLElement>('.after')!.hidden).toBe(false);
    }
    expect(document.querySelector('#save-status')!.textContent).toBe('첫 판정 6 / 6');
    first.querySelector<HTMLInputElement>('input[name="after-0"][value="yes"]')!.checked = true;
    first.querySelector<HTMLInputElement>('input[name="help-0"][value="yes"]')!.checked = true;
    first.querySelector<HTMLTextAreaElement>('.notes')!.value = '자동 동작 시험이며 사람의 인식 평가가 아닙니다.';
    document.querySelector<HTMLButtonElement>('#save-review')!.click();
    expect(objectURLs).toBe(1); expect(downloadedName).toMatch(/^road-first-review-\d{4}-\d{2}-\d{2}\.json$/);
    expect(exported).toMatchObject({ firstVerdictCount: 6, denominator: 6, manualAgentPrototype: true });
    expect(exported!.reviews).toHaveLength(6);
    expect(exported!.reviews[0].beforeAI).toMatchObject({ freeName: '화면 동작 시험', recognizability: 'clear', locked: true });
    expect(exported!.reviews[0].afterAI).toMatchObject({ nameAcceptability: 'yes', referenceHelps: 'yes' });
    expect(exported!.reviews.slice(1).every(row => row.beforeAI?.recognizability === 'none')).toBe(true);
    const serialized = JSON.stringify(exported);
    for (const privateField of ['latlngs', 'graphOrigin', 'bbox', 'originalNativeNodes', 'privateAudit']) expect(serialized).not.toContain(privateField);
    expect(hash(readFileSync(htmlPath))).toBe(hash(bytes));
    writeFileSync(path.join(root, 'dom-interaction-validation.json'), JSON.stringify({
      htmlSha256: hash(bytes), testSourceSha256: hash(readFileSync('tests/eval/road-first-reference-interactions-20261014.test.ts')),
      domBehaviourValidated: true, firstVerdictLockValidated: true, referenceToggleValidated: true,
      normalizedReviewExportValidated: true, noNetworkOrDownloadPerformed: true,
      browserInteractiveUIValidated: false, realBrowserFileNavigationBlocked: true,
      noHumanReviewCreated: true, semanticVerification: 'not-proven', appApplied: false,
    }, null, 2));
  } finally { window.close(); }
});
