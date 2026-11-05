import "server-only";
import {createHash} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {HttpError} from "./http";
import {serviceRoleKey,supabasePublicEnv} from "./env";

export function battleDatabase(){
  const env=supabasePublicEnv(),key=serviceRoleKey();
  if(!env||!key) throw new HttpError(503,"unavailable","대결 서버 설정이 필요해요.");
  return createClient(env.url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function playerName(owner:string){
  return "러너 "+createHash("sha256").update("yorun-player:"+owner).digest("hex").slice(0,8).toUpperCase();
}
