import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const runtime = "nodejs";
const input = z.object({ lines: z.array(z.array(z.tuple([z.number().min(-0.51).max(0.51), z.number().min(-0.51).max(0.51)])).min(2).max(1024)).min(1).max(128) }).strict();
let busy = false;

export async function POST(request: Request) {
  if (busy) return Response.json({ error: "busy" }, { status: 503 });
  if (Number(request.headers.get("content-length")) > 4_000_000) return Response.json({ error: "too_large" }, { status: 413 });
  const body = await request.text();
  if (body.length > 4_000_000) return Response.json({ error: "too_large" }, { status: 413 });
  let parsed: z.infer<typeof input>;
  try { parsed = input.parse(JSON.parse(body)); } catch { return Response.json({ error: "invalid_shape" }, { status: 400 }); }
  const root = process.cwd();
  const python = process.env.CLIP_PYTHON || path.join(root, "eval/recognition/model-env/Scripts/python.exe");
  // Python/runtime weights are provisioned separately, never bundled by Next.js.
  if (!existsSync(/* turbopackIgnore: true */ python)) return Response.json({ error: "model_unavailable" }, { status: 503 });
  if (busy || request.signal.aborted) return Response.json({ error: "busy" }, { status: 503 });
  busy = true;
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(/* turbopackIgnore: true */ python, [path.join(root, "scripts/clip-recognition.py")], {
        windowsHide: true,
        env: { ...process.env, HF_HOME: process.env.CLIP_MODEL_CACHE || path.join(root, "eval/recognition/model-cache"), HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_PROGRESS_BARS: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("timeout")); }, 80_000);
      const abort = () => { child.kill(); reject(new Error("aborted")); };
      request.signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (data) => { output += data; if (output.length > 200_000) child.kill(); });
      child.stderr.on("data", () => {});
      child.stdin.on("error", () => {});
      child.on("error", reject);
      child.on("close", (code) => { clearTimeout(timer); request.signal.removeEventListener("abort", abort); if (code === 0) resolve(output); else reject(new Error("inference_failed")); });
      child.stdin.end(JSON.stringify(parsed));
    });
    return Response.json(JSON.parse(result));
  } catch { return Response.json({ error: "recognition_unavailable" }, { status: 503 }); }
  finally { busy = false; }
}
