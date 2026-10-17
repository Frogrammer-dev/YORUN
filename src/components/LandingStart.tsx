"use client";
import { useRouter } from "next/navigation";
import { ImportPanel } from "./ImportPanel";
import { buildDemoArtwork, demoMapLines } from "@/lib/art/artwork";
import { RoadMapStore } from "@/lib/art/roadMap";
import { setPendingArtwork } from "@/lib/client/pending";
import type { ArtworkView } from "@/lib/contracts/types";

/** 가입 없이 파일 하나로 첫 작품을 만들고 임시 작품방으로 이동 (FR-01, FR-05). */
export function LandingStart() {
  const router = useRouter();
  const go = (v: ArtworkView) => {
    setPendingArtwork(v);
    router.push("/room");
  };
  return (
    <div className="start">
      <ImportPanel onCreated={go} />
      <button type="button" className="btn btn-link" onClick={async () => {
          const { view } = buildDemoArtwork();
          await RoadMapStore.save(view.id, demoMapLines("dog"));
          go(view);
        }}>
        GPX가 없나요? 예시 기록으로 둘러보기
      </button>
    </div>
  );
}
