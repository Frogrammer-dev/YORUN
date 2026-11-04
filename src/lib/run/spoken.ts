// 달리는 중 소리로 말하는 짧은 문구. scripts/generate-run-voices.py가 같은 문구로 음성 파일을 만든다.
// 화면 낭독에는 경과 시간과 누적 포인트까지 담은 긴 문장을 따로 쓴다.

export const OFF_ROUTE_PHRASE = "코스에서 벗어났어요. 코스 쪽으로 돌아가 주세요.";
export const CAP_PHRASE = "오늘 적립 한도를 채웠어요";
export const pointsPhrase = (gained: number) => `${gained}포인트 획득`;
export const kmPhrase = (km: number) => `${km}킬로미터`;
