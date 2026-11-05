import type { Fix } from "./tracker";

type Reply = { failure?: string; points?: Fix[]; service?: boolean; error?: string; health?: { saved: number|null; received: number|null; count: number; state: string } };
export function nativeRecorder() {
  return typeof window !== "undefined" && (window as Window & {ReactNativeWebView?: {postMessage(value:string):void}}).ReactNativeWebView;
}
let sequence=0;
export function nativeRequest(op:"begin"|"read"|"stop", id:number, fields:Record<string,unknown>={}):Promise<Reply> {
  const bridge=nativeRecorder();
  if (!bridge) return Promise.reject(new Error("기록기 연결이 끊겼습니다."));
  const seq=++sequence;
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{ clearTimeout(timer);window.removeEventListener("yorun-native",receive); };
    const receive=(event:Event)=>{
      const reply=(event as CustomEvent<{seq:number;result:Reply}>).detail;
      if(reply?.seq!==seq) return;
      cleanup();
      if(reply.result.failure) reject(new Error(reply.result.failure)); else resolve(reply.result);
    };
    const timer=setTimeout(()=>{cleanup();reject(new Error("기록기 응답 대기 시간이 지났습니다. 다시 시도하세요."));},90000);
    window.addEventListener("yorun-native",receive);
    bridge.postMessage(JSON.stringify({seq,id,op,...fields}));
  });
}
