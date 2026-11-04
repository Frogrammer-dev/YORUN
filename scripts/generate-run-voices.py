from pathlib import Path
import json,numpy as np,soundfile as sf
from supertonic import TTS
root=Path(__file__).resolve().parents[1]
tts=TTS(model="supertonic-2",intra_op_num_threads=4,inter_op_num_threads=1)
phrases=["달리기를 시작했어요","달리기를 마쳤어요","다시 시작했어요","일시정지했어요","음성 안내를 켰어요","코스로 돌아왔어요"]
for direction in ["좌회전이에요","우회전이에요","돌아서 주세요"]:
    phrases.extend([f"잠시 후 {direction}."]+[f"약 {n}미터 후 {direction}." for n in range(20,111,10)])
out=root/"public"/"run-voices"
out.mkdir(exist_ok=True)
manifest={}
for voice,style in [("male","M1"),("female","F1")]:
    speaker=tts.get_voice_style(voice_name=style)
    for i,text in enumerate(phrases):
        filename=f"{voice}-{i}.mp3"
        spoken=text
        for n,name in [(110,"백십"),(100,"백"),(90,"구십"),(80,"팔십"),(70,"칠십"),(60,"육십"),(50,"오십"),(40,"사십"),(30,"삼십"),(20,"이십")]:
            spoken=spoken.replace(str(n)+"미터",name+" 미터")
        audio,_=tts.synthesize(spoken,voice_style=speaker,lang="ko",speed=1.03)
        samples=audio.squeeze()
        assert np.isfinite(samples).all() and np.abs(samples).max()>0.01
        sf.write(out/filename,samples,tts.sample_rate,format="MP3")
        manifest[text]=i
(root/"src/lib/run/voicePhrases.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf8")

# Metro needs static asset references for playback in a suspended WebView.
import shutil
native=root/"mobile-recorder"/"voice-assets"
native.mkdir(exist_ok=True)
lines=["export const turnAudio = {"]
for text,i in manifest.items():
    if not (text.startswith("잠시 후") or text.startswith("약 100미터")): continue
    lines.append("  "+json.dumps(text,ensure_ascii=False)+": {")
    for voice in ["male","female"]:
        filename=f"{voice}-{i}.mp3"
        shutil.copyfile(out/filename,native/filename)
        lines.append(f'    {voice}: require("./voice-assets/{filename}"),')
    lines.append("  },")
lines.append("};")
(root/"mobile-recorder"/"turnAudio.js").write_text("\n".join(lines)+"\n",encoding="utf8")
