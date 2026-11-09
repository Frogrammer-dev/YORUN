import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
const db=new PGlite();
const sql=name=>readFile(new URL("../migrations/"+name,import.meta.url),"utf8");
const one=async(q,p)=>(await db.query(q,p)).rows;
try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null default false,created_at timestamptz not null default now());");
  for(const file of ["0002_derby.sql","0003_player_duels.sql","0004_battle_run_sessions.sql","0005_account_deletion.sql","0006_guest_expiry.sql"])await db.exec(await sql(file));
  const user=async(anonymous,age)=>(await one("insert into auth.users(id,is_anonymous,created_at) values(gen_random_uuid(),$1,now()-$2::interval) returning id",[anonymous,age]))[0].id;
  const enter=async(id,hash)=>(await one("select public.derby_enter($1,$2,'{}') race",[id,hash]))[0].race;

  const expired=await user(true,"6 hours 1 minute"),fresh=await user(true,"5 hours 59 minutes"),member=await user(false,"30 days");
  const filler=[];for(let i=0;i<7;i++)filler.push(await user(false,"1 day"));

  // 끝난 경주(8명)와 모집 중인 경주에 함께 참가한 만료 게스트
  const full=await enter(expired,"g0");for(let i=0;i<7;i++)await enter(filler[i],"f"+i);
  const open=await enter(member,"m0");await enter(expired,"g1");await enter(fresh,"n0");
  assert.notEqual(open,full);
  await db.query("insert into public.duel_players(owner_id,stats,plan) values($1,'{}','[]'),($2,'{}','[]')",[expired,member]);
  await db.query("insert into public.duel_matches values(gen_random_uuid(),$1,$2,'{}',now())",[expired,member]);
  await db.query("insert into public.battle_run_sessions(owner_id,run_id,course_hash) values($1,1,'x')",[expired]);

  assert.equal((await one("select public.purge_expired_guests() n"))[0].n,1);

  // 계정과 대결 데이터가 지워진다
  assert.equal((await one("select 1 from auth.users where id=$1",[expired])).length,0);
  assert.equal((await one("select 1 from public.duel_players where owner_id=$1",[expired])).length,0);
  assert.equal((await one("select 1 from public.duel_matches where challenger=$1",[expired])).length,0);
  assert.equal((await one("select 1 from public.battle_run_sessions where owner_id=$1",[expired])).length,0);
  // 끝난 경주는 다른 참가자의 결과이므로 남기고, 누구인지 알 수 없게 한다
  const race=await one("select owner_id,fingerprint from public.derby_entries where race=$1 order by lane",[full]);
  assert.equal(race.length,8);assert.equal(race[0].owner_id,null);assert.equal(race[0].fingerprint,null);
  // 모집 중인 경주는 자리를 비우고 번호를 당긴다
  assert.deepEqual((await one("select lane,owner_id from public.derby_entries where race=$1 order by lane",[open])).map(e=>[e.lane,e.owner_id]),[[1,member],[2,fresh]]);
  // 6시간이 안 된 게스트와 일반 계정은 남는다
  assert.equal((await one("select 1 from auth.users where id=any($1)",[[fresh,member]])).length,2);
  // 다시 실행해도 안전하다
  assert.equal((await one("select public.purge_expired_guests() n"))[0].n,0);
  // 앱과 사용자는 직접 부를 수 없다
  for(const role of ["anon","authenticated","service_role"]){
    await db.exec("set role "+role);
    await assert.rejects(db.query("select public.purge_expired_guests()"));
    await db.exec("reset role");
  }
  console.log("PASS: expired guests purged with battle data, finished race anonymized, open seat freed, others kept, clients cannot call it");
}finally{await db.close();}
