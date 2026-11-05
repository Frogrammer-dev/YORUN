"use client";
// 8인 경주와 1대1 대결이 함께 쓰는 캐릭터 카드 조각.

import { PathThumb } from "@/components/Icon";
import type { DerbyCharacter } from "./characters";

export function Gauge({ label, value }: { label: string; value: number }) {
  return (
    <div className="derby-gauge">
      <span>{label}</span>
      <div className="derby-gauge-bar"><i style={{ transform: `scaleX(${Math.max(0.04, Math.min(1, value))})` }} /></div>
    </div>
  );
}

export function CharacterFace({ character, size }: { character: Pick<DerbyCharacter, "line" | "name">; size: number }) {
  if (!character.line) return <span className="derby-face derby-face-empty" style={{ width: size, height: size }} aria-hidden="true">{character.name.slice(0, 1)}</span>;
  return <span className="derby-face" aria-hidden="true"><PathThumb lines={[character.line.map(([x, y]) => [x, -y] as [number, number])]} size={size} width={3} /></span>;
}
