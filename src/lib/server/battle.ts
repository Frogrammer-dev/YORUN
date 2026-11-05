import "server-only";
import {createHash} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {HttpError} from "./http";
import {serviceRoleKey,supabasePublicEnv} from "./env";
import {cleanGuestName} from "@/lib/guestName";

export function battleDatabase(){
  const env=supabasePublicEnv(),key=serviceRoleKey();
  if(!env||!key) throw new HttpError(503,"unavailable","대결 서버 설정이 필요해요.");
  return createClient(env.url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function playerName(owner:string|null){
  if(!owner) return "탈퇴한 러너";
  return "러너 "+createHash("sha256").update("yorun-player:"+owner).digest("hex").slice(0,8).toUpperCase();
}
// 더비 대기 화면이 7초마다 조회하므로 이름을 잠시 기억한다. 게스트 이름만 쓰고, Google 계정 이름은 보여 주지 않는다.
const NAME_TTL=5*60_000;
const nameCache=new Map<string,{name:string;until:number}>();
async function lookupName(db:ReturnType<typeof battleDatabase>,owner:string){
  const hit=nameCache.get(owner);
  if(hit&&hit.until>Date.now()) return hit.name;
  const {data,error}=await db.auth.admin.getUserById(owner);
  const user=data?.user;
  const guest=user?.is_anonymous?cleanGuestName(user.user_metadata?.guest_name):null;
  const name=guest??playerName(owner);
  if(!error){
    if(nameCache.size>=5000) nameCache.clear();
    nameCache.set(owner,{name,until:Date.now()+NAME_TTL});
  }
  return name;
}
/** 조회에 실패하면 익명 이름으로 대신해 화면을 막지 않는다. */
export async function playerNames(db:ReturnType<typeof battleDatabase>,owners:(string|null)[]){
  const names=new Map<string|null,string>([[null,playerName(null)]]);
  await Promise.all([...new Set(owners)].filter((o):o is string=>!!o).map(async o=>{
    names.set(o,await lookupName(db,o).catch(()=>playerName(o)));
  }));
  return (owner:string|null)=>names.get(owner)??playerName(owner);
}
