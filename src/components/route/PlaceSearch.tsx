"use client";
// 지도 위 장소 검색창: 검색어를 서버(/api/places → 카카오)로 보내고, 고른 곳으로 지도를 옮긴다

import { useState } from "react";
import type { Place } from "@/app/api/places/route";

export function PlaceSearch({ onPick }: { onPick: (p: Place) => void }) {
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/places?q=${encodeURIComponent(query)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? "장소를 검색하지 못했어요.");
      setPlaces(body.places);
      if (!body.places.length) setMsg("검색 결과가 없어요.");
    } catch (err) {
      setPlaces(null);
      setMsg((err as Error).message || "장소를 검색하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  function pick(p: Place) {
    setPlaces(null);
    setQ(p.name);
    onPick(p);
  }

  return (
    <div className="place-search" onKeyDown={(e) => e.key === "Escape" && (setPlaces(null), setMsg(null))}>
      <form role="search" onSubmit={submit}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="장소·주소 검색" aria-label="장소 검색" maxLength={60} enterKeyHint="search" />
        <button type="submit" disabled={busy || !q.trim()}>{busy ? "…" : "검색"}</button>
      </form>
      {(places?.length || msg) && (
        <div className="place-results">
          {msg && <p className="hint" role="status">{msg}</p>}
          {!!places?.length && (
            <ul aria-label="검색 결과">
              {places.map((p, i) => (
                <li key={`${p.lat},${p.lon},${i}`}>
                  <button type="button" onClick={() => pick(p)}>
                    <strong>{p.name}</strong>
                    <span>{p.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
