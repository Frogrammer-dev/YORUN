import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// Diagnostic only: never changes paths or promotes a proxy to recognition accuracy.
const root = 'eval/recognition/multiscale-route-20261027';
const bytes = readFileSync(`${root}/results.json`);
const data = JSON.parse(bytes);
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(data.cases.length, 6);
assert.equal(sha(readFileSync(data.protocol.source)), data.protocol.sourceHash);
assert.equal(sha(readFileSync(data.protocol.shapeFile)), data.protocol.shapeHash);
const rows = [];
for (const c of data.cases) {
  for (const a of c.arms) {
    const levels = [];
    for (const [i, sigma] of data.protocol.sigmas.entries()) {
      const png = readFileSync(`${root}/${c.id}-${a.mode}-sigma${sigma}.png`);
      const { data: raw, info } = await sharp(png).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject:true });
      assert.equal(info.channels, 1);
      assert.equal(info.width, 400);
      let ink = 0, energy = 0, peak = 0, darkPixels = 0;
      for (const pixel of raw) {
        const v = (255-pixel)/255;
        ink += v; energy += v*v; peak = Math.max(peak,v);
        if (v >= .5) darkPixels++;
      }
      levels.push({ sigma, cosine:a.scores[i], ink, energy, peakContrast:peak, darkPixels, pngHash:sha(png) });
    }
    rows.push({ caseId:c.id, mode:a.mode, selected:c.multiscaleWinner===a.mode,
      scoreGain:levels.at(-1).cosine-levels[0].cosine,
      inkRetention:levels.at(-1).ink/levels[0].ink,
      energyRetention:levels.at(-1).energy/levels[0].energy, levels });
  }
}
const mean = values => values.reduce((a,b)=>a+b,0)/values.length;
const policies = data.protocol.sigmas.map((sigma,i) => {
  const selected = data.cases.map(c => {
    const a = [...c.arms].sort((a,b)=>b.scores[i]-a.scores[i]||a.mode.localeCompare(b.mode))[0];
    return { caseId:c.id, mode:a.mode, geometry:a.geometry, negativeWins:c.controls.some(n=>n.scores[i]>a.scores[i]) };
  });
  return { sigma, meanGeometry:mean(selected.map(a=>a.geometry)), negativeWins:selected.filter(a=>a.negativeWins).length, selected };
});
const result = { sourceHash:sha(bytes), scriptHash:sha(readFileSync(import.meta.filename)), diagnostic:true,
  learnedModelInference:false, humanRecognitionMeasured:false, pathsModified:false,
  summary:{ outputs:rows.length, cosineIncreasedAtSigma8:rows.filter(r=>r.scoreGain>0).length,
    meanInkRetention:mean(rows.map(r=>r.inkRetention)), meanEnergyRetention:mean(rows.map(r=>r.energyRetention)),
    meanPeakContrastSigma8:mean(rows.map(r=>r.levels.at(-1).peakContrast)),
    meanDarkPixelsSigma8:mean(rows.map(r=>r.levels.at(-1).darkPixels)) }, policies, rows };
mkdirSync('reports/illusion-route-20261027',{recursive:true});
writeFileSync('reports/illusion-route-20261027/signal-audit.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({summary:result.summary,policies:policies.map(({selected,...p})=>p)},null,2));
