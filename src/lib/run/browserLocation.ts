import { isValidFix, type Fix } from "./tracker";

export type LocationFailure = "denied" | "unavailable" | "timeout" | "unsupported" | "invalid";

/** Browser acquisition only. Recording, filtering and persistence belong to the caller. */
export function watchBrowserLocation(
  onFix: (fix: Fix) => void,
  onError: (reason: LocationFailure) => void,
  geolocation: Geolocation | undefined = typeof navigator === "undefined" ? undefined : navigator.geolocation,
): () => void {
  if (!geolocation) {
    onError("unsupported");
    return () => {};
  }
  let stopped = false;
  let id: number;
  try {
    id = geolocation.watchPosition((position) => {
      if (stopped) return;
      const fix = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
        time: position.timestamp,
      };
      if (isValidFix(fix)) onFix(fix);
      else onError("invalid");
    }, (error) => {
      if (!stopped) onError(error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable");
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  } catch {
    onError("unavailable");
    return () => {};
  }
  return () => {
    if (stopped) return;
    stopped = true;
    geolocation.clearWatch(id);
  };
}
