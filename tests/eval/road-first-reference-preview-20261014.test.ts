import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Script } from 'node:vm';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  commandsToSvgPath,
  parseRoadReferenceProposal,
  ROAD_REFERENCE_COORDINATE_SPACE,
  type ParsedRoadReferenceProposal,
  type ReferencePoint,
  type RoadReferenceInput,
} from '@/lib/art/roadReference';

const root = path.resolve('eval/recognition/road-first-reference-20261014');
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
const jsonForHtml = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const point = z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]);
const packetShape = z.object({ candidateId: z.string().regex(/^road-\d{2}$/), coordinateSpace: z.literal(ROAD_REFERENCE_COORDINATE_SPACE), route: z.array(point).min(4).max(256), fingerprint: z.string() }).strict();
const inputShape = z.object({ protocol: z.record(z.string(), z.unknown()), candidates: z.array(z.object({ packet: packetShape, image: z.string().regex(/^road-\d{2}\.png$/), renderLine: z.array(point).min(4).max(100000) }).strict()).length(6) }).strict();
const generationShape = z.object({ entries: z.array(z.object({ raw: z.unknown(), provenance: z.unknown() }).strict()).length(6) }).strict();
type Card = { packet: RoadReferenceInput; image: string; renderLine: ReferencePoint[]; proposal: ParsedRoadReferenceProposal };

function routePath(line: readonly ReferencePoint[]): string {
  return line.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
}

function illustration(card: Card, referenceOnly = false): string {
  const route = `<path d="${escapeHtml(routePath(card.renderLine))}" fill="none" stroke="#0891b2" stroke-width="0.0065" stroke-linejoin="round" stroke-linecap="round"/>`;
  const reference = card.proposal.decision === 'interpretation' ? `<g data-layer="reference"><path d="${escapeHtml(commandsToSvgPath(card.proposal.reference.commands))}" fill="none" stroke="#d97706" stroke-width="0.005" stroke-dasharray="0.015 0.01" stroke-linejoin="round" stroke-linecap="round"/></g>` : '';
  const imagined = card.proposal.decision === 'interpretation' ? `<g data-layer="imagined">${card.proposal.reference.imaginedParts.map(part => `<path d="${escapeHtml(commandsToSvgPath(part.commands))}" fill="none" stroke="#9333ea" stroke-width="0.004" stroke-dasharray="0.004 0.01" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}</g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1 1" role="img" aria-label="${referenceOnly ? 'AI가 제안한 참고 그림' : '실제 경로와 AI 참고 그림 비교'}"><rect width="1" height="1" fill="white"/>${referenceOnly ? '' : route}${reference}${imagined}</svg>`;
}

function cardHtml(card: Card, index: number): string {
  const name = `경로 ${String(index + 1).padStart(2, '0')}`, proposal = card.proposal;
  const observed = proposal.decision === 'interpretation' ? `<div class="evidence"><h4>실제 길에서 본 부분</h4><ul>${proposal.reference.observedParts.map(part => `<li>${escapeHtml(part.name)}</li>`).join('')}</ul></div>` : '';
  const imagined = proposal.decision === 'interpretation' ? `<div class="evidence"><h4>상상으로 더한 부분</h4>${proposal.reference.imaginedParts.length ? `<ul>${proposal.reference.imaginedParts.map(part => `<li>${escapeHtml(part.name)}</li>`).join('')}</ul>` : '<p>추가한 내부 그림 없음</p>'}</div>` : '';
  const missing = proposal.decision === 'interpretation' && proposal.missingFeatures.length ? `<div class="missing"><h4>경로에 없는 특징</h4><ul>${proposal.missingFeatures.map(feature => `<li>${escapeHtml(feature)}</li>`).join('')}</ul></div>` : '';
  const label = proposal.decision === 'interpretation' ? `${escapeHtml(proposal.label.ko)} <small>${escapeHtml(proposal.label.en)}</small>` : '닮은 대상 제안 없음';
  const diagram = proposal.decision === 'interpretation' ? `<div class="layer-controls"><label><input type="checkbox" data-toggle="reference" checked/> 참고 윤곽</label><label><input type="checkbox" data-toggle="imagined" checked${proposal.reference.imaginedParts.length ? '' : ' disabled'}/> 상상한 내부 그림</label></div><div class="diagram-pair"><figure>${illustration(card)}<figcaption>실제 길 + 참고 그림</figcaption></figure><figure>${illustration(card, true)}<figcaption>AI가 제안한 그림만</figcaption></figure></div><div class="legend"><span class="real">실선: 달릴 길</span><span class="reference">주황 점선: 참고 윤곽</span><span class="imagined">보라 점선: 상상한 부분</span></div>` : `<figure class="none-diagram">${illustration(card)}<figcaption>실제 달릴 길</figcaption></figure>`;
  return `<article class="card" data-card="${index}"><header><h2>${name}</h2><span class="step-status" data-status>먼저 경로만 보기</span></header>
    <figure class="road-only"><img src="inputs/${escapeHtml(card.image)}" width="512" height="512" alt="${name}, 실제 길의 선 그림만"/><figcaption>이름과 도움 그림 없이 먼저 봐 주세요.</figcaption></figure>
    <section class="before" aria-label="${name} 첫 판정"><label class="field-label" for="name-${index}">무엇처럼 보이나요?</label><input id="name-${index}" class="free-name" maxlength="120" autocomplete="off" placeholder="예: 떠오르는 이름, 또는 없음"/>
    <fieldset><legend>이름 없이도 알아볼 수 있나요?</legend><label><input type="radio" name="before-${index}" value="none"/> 안 보임</label><label><input type="radio" name="before-${index}" value="weak"/> 조금 보임</label><label><input type="radio" name="before-${index}" value="clear"/> 잘 보임</label></fieldset>
    <button type="button" class="reveal primary">AI 해석 보기</button><p class="form-message" data-message role="status" aria-live="polite"></p></section>
    <section class="after" hidden aria-label="${name} AI 해석"><h3>${label}</h3><p>${escapeHtml(proposal.explanation)}</p>${diagram}<div class="evidence-grid">${observed}${imagined}</div>${missing}<p class="prototype-note">에이전트가 작성한 시험 해석입니다. 참고 그림과 내부 그림은 달리는 길이 아닙니다.</p>
    <fieldset><legend>${proposal.decision === 'interpretation' ? '제안한 이름에 동의하나요?' : '닮은 대상이 없다는 해석에 동의하나요?'}</legend><label><input type="radio" name="after-${index}" value="no"/> 아니요</label><label><input type="radio" name="after-${index}" value="unsure"/> 애매해요</label><label><input type="radio" name="after-${index}" value="yes"/> 동의해요</label></fieldset>
    ${proposal.decision === 'interpretation' ? `<fieldset><legend>참고 그림이 해석을 이해하는 데 도움이 되나요?</legend><label><input type="radio" name="help-${index}" value="no"/> 아니요</label><label><input type="radio" name="help-${index}" value="unsure"/> 애매해요</label><label><input type="radio" name="help-${index}" value="yes"/> 도움이 돼요</label></fieldset>` : ''}
    <label class="field-label" for="notes-${index}">의견 <span>(선택)</span></label><textarea id="notes-${index}" class="notes" maxlength="600" rows="2" placeholder="잘 보이는 부분이나 어색한 부분을 적어 주세요."></textarea></section>
  </article>`;
}

function pageHtml(cards: Card[], fingerprints: Record<string, string>): string {
  const metadata = { studyId: 'road-first-reference-v1-20261014', coordinateSpace: ROAD_REFERENCE_COORDINATE_SPACE, semanticVerification: 'not-proven', manualAgentPrototype: true, appApplied: false, originalBenchmarkReplaced: false, generatedAt: new Date().toISOString(), sourceHashes: fingerprints, candidates: cards.map(card => ({ candidateId: card.packet.candidateId, inputFingerprint: card.packet.fingerprint, decision: card.proposal.decision, ...(card.proposal.decision === 'interpretation' ? { label: card.proposal.label } : {}), provenance: card.proposal.provenance, structuralValidation: card.proposal.validation })) };
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>도로 모양을 함께 해석하기</title><style>
  :root{font-family:system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif;color:#243247;background:#f3f6fa;line-height:1.6;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1240px;margin:auto;padding:36px 24px 80px}h1{font-size:clamp(24px,4vw,34px);line-height:1.3;margin:12px 0}h2{font-size:19px;margin:0}h3{font-size:22px;margin:18px 0 8px}h3 small{font-size:13px;color:#64748b;margin-left:5px;font-weight:400}h4{font-size:14px;margin:0 0 4px}p{margin:8px 0}.intro{max-width:820px}.eyebrow{color:#475569;font-size:13px;font-weight:650}.intro-note{color:#64748b;font-size:14px}.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:24px 0}.toolbar label{font-size:14px}.toolbar input{width:180px}.save-status{color:#52647a;font-size:14px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.card{background:white;border:1px solid #dce3ed;border-radius:18px;padding:20px;box-shadow:0 4px 16px #182e4506}.card header{display:flex;align-items:center;justify-content:space-between;gap:8px}.step-status{font-size:12px;color:#64748b;background:#f1f5f9;padding:4px 9px;border-radius:999px}figure{margin:0}svg,img{max-width:100%;height:auto;display:block;background:white}.road-only{margin:12px 0 18px}.road-only img{max-height:420px;width:100%;object-fit:contain}figcaption{font-size:12px;color:#64748b;text-align:center;margin-top:5px}.field-label{display:block;font-size:14px;font-weight:650;margin:10px 0 6px}.field-label span{font-weight:400;color:#64748b}input[type=text],input:not([type]),textarea{width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:10px 11px;font:inherit;font-size:14px;background:#fff;color:inherit}input:focus-visible,textarea:focus-visible,button:focus-visible{outline:3px solid #38bdf8;outline-offset:2px}input:disabled{opacity:.6}input[type=radio],input[type=checkbox]{accent-color:#0284c7;width:16px;height:16px;vertical-align:middle;margin:0 4px 0 0}fieldset{border:0;margin:14px 0;padding:0;display:flex;flex-wrap:wrap;gap:10px 18px}legend{font-weight:650;font-size:14px;margin-bottom:7px}fieldset label,.layer-controls label{font-size:14px;white-space:nowrap}button{font:inherit;font-size:14px;border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:9px;padding:10px 16px;cursor:pointer}.primary{background:#0369a1;color:#fff;border-color:#0369a1}button:hover{filter:brightness(.96)}button:disabled{opacity:.65;cursor:default}.form-message{font-size:13px;color:#7c4b15;min-height:20px}.after[hidden]{display:none}.after{border-top:1px solid #e2e8f0;padding-top:4px}.before-locked .road-only img{max-height:250px}.layer-controls{display:flex;flex-wrap:wrap;gap:10px 20px;margin:16px 0 8px}.diagram-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.diagram-pair svg{width:100%;border:1px solid #e2e8f0;border-radius:10px}.legend{display:flex;flex-wrap:wrap;gap:5px 14px;font-size:12px;margin:10px 0}.real{color:#0891b2}.reference{color:#b45309}.imagined{color:#7e22ce}.evidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:14px 0}.evidence{background:#f8fafc;border-radius:10px;padding:12px;font-size:13px}.evidence p{margin:0}.evidence ul,.missing ul{padding-left:18px;margin:0}.missing{font-size:13px;margin:12px 0;color:#52647a}.prototype-note{font-size:12px;color:#64748b}.none-diagram svg{width:100%;max-height:340px}.footer-note{color:#64748b;font-size:13px;margin-top:24px}@media(max-width:740px){main{padding:24px 14px 60px}.cards{grid-template-columns:1fr}.card{padding:16px}.toolbar{align-items:flex-start}.toolbar label{width:100%}.toolbar input{width:100%}.evidence-grid{grid-template-columns:1fr}}@media(prefers-reduced-motion:no-preference){button{transition:filter .12s}}
  </style></head><body><main><section class="intro"><div class="eyebrow">도로 모양 해석 · 독립 시험 화면</div><h1>실제 길이 무엇처럼 보이나요?</h1><p>먼저 선 그림만 보고 떠오르는 이름을 적어 주세요. 그다음 AI가 제안한 이름과 참고 그림을 보고, 해석에 동의하는지 평가해 주세요.</p><p class="intro-note">실제 도로로 연결된 경로 6개입니다. 첫 판정은 AI 해석을 열면 잠기며, 참고 그림은 실제 경로를 바꾸지 않습니다. 이 시험은 기존 경로 유사도 점수와 별도로 기록됩니다.</p></section>
  <div class="toolbar"><label>평가자 이름 <input id="reviewer" type="text" maxlength="60" placeholder="선택 사항"/></label><button id="save-review" type="button" class="primary">평가 결과 저장</button><span class="save-status" id="save-status" role="status" aria-live="polite">첫 판정 0 / 6</span></div>
  <div class="cards">${cards.map(cardHtml).join('')}</div><p class="footer-note">청록 실선은 달릴 길입니다. 주황·보라 점선은 해석을 돕는 그림이며 달릴 길에 포함되지 않습니다. 이름을 제안하지 않은 경로도 그대로 평가해 주세요.</p>
  </main><script type="application/json" id="review-metadata">${jsonForHtml(metadata)}</script><script>
  (function(){'use strict';
    var metadata=JSON.parse(document.getElementById('review-metadata').textContent);
    var reviews=metadata.candidates.map(function(candidate){return {candidateId:candidate.candidateId,inputFingerprint:candidate.inputFingerprint,beforeAI:null,afterAI:null};});
    var cards=Array.from(document.querySelectorAll('[data-card]'));
    function selected(card,prefix){var radio=card.querySelector('input[name="'+prefix+'-'+card.dataset.card+'"]:checked');return radio?radio.value:null;}
    function updateStatus(){var locked=reviews.filter(function(row){return row.beforeAI!==null;}).length;document.getElementById('save-status').textContent='첫 판정 '+locked+' / '+reviews.length;}
    function afterVerdict(card,index){if(!reviews[index].beforeAI)return;reviews[index].afterAI={nameAcceptability:selected(card,'after'),referenceHelps:metadata.candidates[index].decision==='interpretation'?selected(card,'help'):null,notes:card.querySelector('.notes').value,updatedAt:new Date().toISOString()};}
    cards.forEach(function(card,index){
      card.querySelector('.reveal').addEventListener('click',function(){
        if(reviews[index].beforeAI)return;
        var input=card.querySelector('.free-name'),rating=selected(card,'before'),name=input.value.trim(),message=card.querySelector('[data-message]');
        if(!rating){message.textContent='먼저 알아보이는 정도를 선택해 주세요.';return;}
        if(rating!=='none'&&!name){message.textContent='떠오르는 이름을 적거나, 안 보임을 선택해 주세요.';return;}
        reviews[index].beforeAI={freeName:name,recognizability:rating,submittedAt:new Date().toISOString(),locked:true};
        input.readOnly=true;card.querySelectorAll('.before input[type=radio]').forEach(function(radio){radio.disabled=true;});
        this.disabled=true;this.textContent='첫 판정 저장됨';message.textContent='첫 판정을 잠그고 AI 해석을 열었습니다.';
        card.querySelector('.after').hidden=false;card.classList.add('before-locked');card.querySelector('[data-status]').textContent='첫 판정 잠금 · 해석 평가';updateStatus();
      });
      card.querySelectorAll('[data-toggle]').forEach(function(toggle){toggle.addEventListener('change',function(){var layer=toggle.dataset.toggle;card.querySelectorAll('[data-layer="'+layer+'"]').forEach(function(group){group.style.display=toggle.checked?'':'none';});});});
      card.querySelector('.after').addEventListener('change',function(){afterVerdict(card,index);});card.querySelector('.notes').addEventListener('input',function(){afterVerdict(card,index);});
    });
    document.getElementById('save-review').addEventListener('click',function(){
      cards.forEach(afterVerdict);
      var payload={schemaVersion:1,studyId:metadata.studyId,reviewer:document.getElementById('reviewer').value.trim(),savedAt:new Date().toISOString(),manualAgentPrototype:true,semanticVerification:'human-review-recorded-not-aggregated',firstVerdictCount:reviews.filter(function(row){return row.beforeAI!==null;}).length,denominator:reviews.length,sourceHashes:metadata.sourceHashes,candidateProvenance:metadata.candidates,reviews:reviews};
      var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='road-first-review-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},0);document.getElementById('save-status').textContent='평가 결과를 저장했습니다. 첫 판정 '+payload.firstVerdictCount+' / '+reviews.length;
    });
  })();
  </script></body></html>`;
}

it.skipIf(process.env.ROAD_FIRST_REFERENCE_PREVIEW !== '1')('renders and records six structurally validated road-first explanations without replacing any benchmark', async () => {
  const reportPath = path.join(root, 'preview-validation.json');
  if (existsSync(reportPath)) throw new Error('Refusing to overwrite a completed road-first preview');
  const packetsPath = path.join(root, 'inputs/packets.json'), completePath = path.join(root, 'inputs/complete.json'), generationsPath = path.join(root, 'generations/proposals.json');
  const inputs = inputShape.parse(JSON.parse(readFileSync(packetsPath, 'utf8'))), complete = JSON.parse(readFileSync(completePath, 'utf8'));
  expect(complete).toMatchObject({ denominator: 6, verified: true, noOriginalMean80Proof: true, holdoutRead: false });
  expect(sha(readFileSync(packetsPath))).toBe(complete.packetsSha256);
  expect(inputs.protocol).toMatchObject({ denominator: 6, fixedTemplatesUsed: false, expectedNamesUsed: false, originalTwelveBenchmarkReplaced: false, originalMean80Proof: false, imageOnlyActualOriginalVertices: true, holdoutRead: false });
  const generation = generationShape.parse(JSON.parse(readFileSync(generationsPath, 'utf8')));
  const codeFiles = ['src/lib/art/roadReference.ts', 'prompts/road-first-reference-v1.md', 'tests/eval/road-first-reference-preview-20261014.test.ts', 'tests/eval/road-first-reference-inputs-20261014.test.ts'];
  const sourceFiles = [...codeFiles, path.relative(process.cwd(), packetsPath), path.relative(process.cwd(), completePath), path.relative(process.cwd(), generationsPath), ...inputs.candidates.map(candidate => path.relative(process.cwd(), path.join(root, 'inputs', candidate.image)))];
  const beforeHashes = Object.fromEntries(sourceFiles.map(file => [file.replace(/\\/g, '/'), sha(readFileSync(file))]));
  const sources = path.join(root, 'preview-sources'), visual = path.join(root, 'visual'); mkdirSync(sources, { recursive: true }); mkdirSync(visual, { recursive: true });
  for (const file of codeFiles) writeFileSync(path.join(sources, path.basename(file) + '.source'), readFileSync(file));
  writeFileSync(path.join(root, 'preview-protocol-before-run.json'), JSON.stringify({ beforeHashes, denominator: 6, manualAgentPrototype: true, appApplied: false, semanticVerification: 'not-proven', originalBenchmarkReplaced: false, independentOfFixedTwelveScore: true, holdoutRead: false }, null, 2));
  expect(new Set(inputs.candidates.map(candidate => candidate.packet.candidateId)).size).toBe(6);
  const candidatesById = new Map(inputs.candidates.map(candidate => [candidate.packet.candidateId, candidate])), cards = new Map<string, Card>();
  for (const entry of generation.entries) {
    const candidateId = z.object({ candidateId: z.string() }).passthrough().parse(entry.raw).candidateId;
    const candidate = candidatesById.get(candidateId); expect(candidate, 'The model may only refer to provided candidates').toBeDefined();
    expect(cards.has(candidateId), 'Duplicate candidate proposal').toBe(false);
    const proposal = parseRoadReferenceProposal(candidate!.packet, entry.raw, entry.provenance);
    expect(proposal.provenance.mode).toBe('manual-agent'); expect(proposal.provenance.promptVersion).toBe('road-first-reference-v1');
    expect(proposal.validation.semantic).toBe('unverified'); expect(proposal.validation.nativeRouteModified).toBe(false);
    const line = candidate!.renderLine; expect(line[0]).toEqual(line.at(-1));
    if (line.length <= 256) expect(candidate!.packet.route).toEqual(line);
    const imageInfo = await sharp(readFileSync(path.join(root, 'inputs', candidate!.image))).metadata(); expect(imageInfo.width).toBe(512); expect(imageInfo.height).toBe(512);
    cards.set(candidateId, { ...candidate!, proposal });
  }
  expect(cards.size).toBe(6);
  const ordered = inputs.candidates.map(candidate => cards.get(candidate.packet.candidateId)!);
  const rendered = [];
  for (const card of ordered) {
    const id = card.packet.candidateId, overlay = illustration(card), overlayBytes = await sharp(Buffer.from(overlay)).flatten({ background: '#fff' }).png().toBuffer();
    writeFileSync(path.join(visual, id + '-overlay.svg'), overlay); writeFileSync(path.join(visual, id + '-overlay.png'), overlayBytes);
    const overlayInfo = await sharp(overlayBytes).metadata(); expect(overlayInfo.width).toBe(512); expect(overlayInfo.height).toBe(512);
    let referenceOnlyHash: string | null = null;
    if (card.proposal.decision === 'interpretation') {
      const reference = illustration(card, true), bytes = await sharp(Buffer.from(reference)).flatten({ background: '#fff' }).png().toBuffer();
      writeFileSync(path.join(visual, id + '-reference.svg'), reference); writeFileSync(path.join(visual, id + '-reference.png'), bytes);
      const info = await sharp(bytes).metadata(); expect(info.width).toBe(512); expect(info.height).toBe(512); referenceOnlyHash = sha(bytes);
    }
    rendered.push({ candidateId: id, fingerprint: card.packet.fingerprint, decision: card.proposal.decision, fullActualRenderPointCount: card.renderLine.length, numericalPacketPointCount: card.packet.route.length, observedPartCount: card.proposal.decision === 'interpretation' ? card.proposal.reference.observedParts.length : 0, imaginedPartCount: card.proposal.decision === 'interpretation' ? card.proposal.reference.imaginedParts.length : 0, exactTraceCopy: card.proposal.validation.exactRouteTraceCopy, nativeRouteModified: false, semanticStatus: 'unverified', overlaySha256: sha(overlayBytes), referenceOnlySha256: referenceOnlyHash });
  }
  const html = pageHtml(ordered, beforeHashes), htmlPath = path.join(root, 'preview.html');
  expect(html).not.toContain('privateAudit'); expect(html).not.toContain('latlngs'); expect(html).not.toContain('graphOrigin');
  expect((html.match(/class="after" hidden/g) ?? []).length).toBe(6); expect((html.match(/class="reveal primary"/g) ?? []).length).toBe(6);
  expect((html.match(/class="road-only"/g) ?? []).length).toBe(6);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; expect(scripts).toHaveLength(1);
  expect(() => new Script(scripts[0][1])).not.toThrow();
  writeFileSync(htmlPath, html);
  const afterHashes = Object.fromEntries(sourceFiles.map(file => [file.replace(/\\/g, '/'), sha(readFileSync(file))])); expect(afterHashes).toEqual(beforeHashes);
  writeFileSync(reportPath, JSON.stringify({ denominator: 6, interpreted: ordered.filter(card => card.proposal.decision === 'interpretation').length, abstained: ordered.filter(card => card.proposal.decision === 'none').length, semanticVerification: 'not-proven', manualAgentPrototype: true, appApplied: false, originalBenchmarkReplaced: false, originalMean80Proof: false, nativeRouteModified: false, holdoutRead: false, sourceHashesStable: true, beforeHashes, afterHashes, rendered, htmlSha256: sha(html), humanReviewAggregated: false, syntaxValidated: true, interactiveUIValidated: false, sharpVersions: sharp.versions }, null, 2));
  console.log(JSON.stringify({ candidates: ordered.length, interpreted: ordered.filter(card => card.proposal.decision === 'interpretation').length, none: ordered.filter(card => card.proposal.decision === 'none').length, originalBenchmarkReplaced: false, semanticVerification: 'not-proven', sourceHashesStable: true }));
}, 180000);
