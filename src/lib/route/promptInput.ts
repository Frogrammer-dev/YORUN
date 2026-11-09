// 내 그림 입력 해석: 맨 앞이 @이면 글자를 그리고, 아니면 설명으로 윤곽을 만든다.

export const MAX_DRAWN_LETTERS = 4;

export type PromptInput =
  | { kind: "empty" }
  | { kind: "text"; text: string; tooLong: boolean }
  | { kind: "description"; text: string };

/** 전각 ＠도 같은 뜻으로 본다. 문장 중간의 @는 설명의 일부다 */
export function parsePromptInput(raw: string): PromptInput {
  const value = raw.trim();
  if (!value) return { kind: "empty" };
  const match = value.match(/^[@＠]\s*(.*)$/su);
  if (!match) return { kind: "description", text: value };
  const text = match[1].trim();
  return { kind: "text", text, tooLong: [...text].length > MAX_DRAWN_LETTERS };
}
