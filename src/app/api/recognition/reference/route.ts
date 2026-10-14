import { generateRoadReferences, RoadReferenceProviderError, roadReferenceProviderStatus } from "@/lib/art/roadReferenceProvider";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 2_000_000;
const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  return Response.json(roadReferenceProviderStatus(), { headers: noStore });
}

async function readBoundedBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new Error("too_large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("too_large"); }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "origin_not_allowed", message: "현재 앱에서 다시 요청해 주세요." }, { status: 403, headers: noStore });
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "invalid_input", message: "해석할 경로 선 그림을 확인해 주세요." }, { status: 400, headers: noStore });
  }
  let raw: unknown;
  try { raw = JSON.parse(await readBoundedBody(request)); }
  catch (error) {
    const tooLarge = error instanceof Error && error.message === "too_large";
    return Response.json({ error: tooLarge ? "too_large" : "invalid_input", message: tooLarge ? "선 그림 자료가 너무 커요. 경로를 다시 선택해 주세요." : "해석할 경로 선 그림을 확인해 주세요." }, { status: tooLarge ? 413 : 400, headers: noStore });
  }
  try { return Response.json(await generateRoadReferences(raw, request.signal), { headers: noStore }); }
  catch (error) {
    if (error instanceof RoadReferenceProviderError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
    return Response.json({ error: "provider_unavailable", message: "그림 해석을 완료하지 못했어요. 경로는 그대로 볼 수 있어요." }, { status: 503, headers: noStore });
  }
}
