// 13절 사용자 메시지와 연결되는 입력·처리 오류 코드.

export type ImportErrorCode =
  | "empty_file"
  | "file_too_large"
  | "not_xml"
  | "doctype_forbidden"
  | "not_gpx"
  | "route_only"
  | "no_track"
  | "too_many_tracks"
  | "too_many_segments"
  | "too_many_points"
  | "invalid_coordinate"
  | "no_valid_segment"
  | "antimeridian"
  | "polar"
  | "out_of_range"
  | "degenerate"
  | "render_limit"
  | "timeout"
  | "cancelled";

export class ImportError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    message: string,
    public readonly detail?: Record<string, number | string>,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export function describeImportError(e: unknown): { title: string; action: string } {
  if (!(e instanceof ImportError)) {
    return { title: "GPX 기록을 읽지 못했어요. 다른 파일을 선택해 주세요.", action: "다른 파일 선택" };
  }
  const d = e.detail ?? {};
  switch (e.code) {
    case "empty_file":
    case "not_xml":
    case "not_gpx":
      return { title: `GPX 기록을 읽지 못했어요. 다른 파일을 선택해 주세요. (${e.message})`, action: "다른 파일 선택" };
    case "doctype_forbidden":
      return { title: "보안상 DOCTYPE·ENTITY 선언이 있는 파일은 읽지 않아요.", action: "기록 앱에서 GPX를 다시 내보내 주세요." };
    case "route_only":
    case "no_track":
      return {
        title: "이 버전은 트랙 기록이 들어 있는 GPX만 지원해요.",
        action: "기록 앱에서 ‘활동 기록(트랙)’ GPX를 내보내 주세요. 계획 경로(rte)·지점(wpt)만 있는 파일은 지원하지 않아요.",
      };
    case "file_too_large":
      return { title: `파일이 너무 커요. 현재 한도 5 MiB, 이 파일 ${d.size}.`, action: "더 짧은 기록을 선택해 주세요." };
    case "too_many_tracks":
      return { title: `트랙이 너무 많아요. 현재 한도 20개, 이 파일 ${d.count}개.`, action: "트랙 하나만 내보낸 파일을 선택해 주세요." };
    case "too_many_segments":
      return { title: `구간이 너무 많아요. 현재 한도 200개, 이 파일 ${d.count}개.`, action: "다른 기록을 선택해 주세요." };
    case "too_many_points":
      return { title: `점이 너무 많아요. 현재 한도 20,000개, 이 파일 ${d.count}개.`, action: "더 짧은 기록을 선택해 주세요. 잘라서 쓰지 않아요." };
    case "invalid_coordinate":
      return {
        title: `트랙 ${d.track}, 구간 ${d.segment}의 좌표가 올바르지 않아요. (${d.point}번째 점)`,
        action: "잘못된 점을 지우고 앞뒤를 이어 붙이지 않기 때문에 파일 전체를 거절했어요.",
      };
    case "no_valid_segment":
    case "degenerate":
      return { title: "서로 다른 위치의 점이 2개 이상인 구간이 없어 그림을 만들 수 없어요.", action: "다른 트랙이나 파일을 선택해 주세요." };
    case "antimeridian":
    case "polar":
    case "out_of_range":
      return {
        title: "이 버전에서 처리할 수 있는 범위 밖의 기록이에요. (가로·세로 50km 이하, 위도 80° 미만, 날짜변경선 미통과)",
        action: "더 작은 지역의 다른 트랙을 선택해 주세요.",
      };
    case "render_limit":
      return {
        title: "2m 허용 오차로 단순화해도 전시 점이 2,000개를 넘어요. 이 버전의 처리 범위 밖이에요.",
        action: "더 짧은 기록을 선택해 주세요.",
      };
    case "timeout":
      return { title: "처리 시간이 목표(10초)를 넘어 중단했어요. 아무것도 저장하지 않았어요.", action: "더 작은 파일을 선택해 주세요." };
    case "cancelled":
      return { title: "가져오기를 취소했어요.", action: "다른 파일 선택" };
  }
}
