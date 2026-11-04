import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
const db=new PGlite();
const sql=name=>readFile(new URL("../migrations/"+name,import.meta.url),"utf8");
const entries=race=>db.query("select lane,owner_id,fingerprint from public.derby_entries where race=$1 order by lane",[race]).then(r=>r.rows);
try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);grant usage on schema auth to service_role;");
  for(const file of ["0002_derby.sql","0003_player_duels.sql","0004_battle_run_sessions.sql","0005_account_deletion.sql"])await db.exec(await sql(file));
  const ids=(await db.query("insert into auth.users select gen_random_uuid() from generate_series(1,12) returning id")).rows.map(r=>r.id);
  await db.exec("set role service_role");
  const enter=(id,hash)=>db.query("select public.derby_enter($1,$2,'{}') race",[id,hash]).then(r=>r.rows[0].race);

  // 끝난 경주(8명)에 참가한 사람
  let full;for(let i=0;i<8;i++)full=await enter(ids[i],"h"+i);
  // 모집 중인 경주(3명)의 가운데 자리
  const open=await enter(ids[8],"o0");await enter(ids[0],"o1");await enter(ids[9],"o2");
  assert.notEqual(open,full);

  await db.query("select public.derby_forget($1)",[ids[0]]);
  const race=await entries(full);
  assert.equal(race.length,8);assert.equal(race[0].owner_id,null);assert.equal(race[0].fingerprint,null);
  assert.equal(race[1].owner_id,ids[1]);
  assert.deepEqual((await entries(open)).map(e=>[e.lane,e.owner_id]),[[1,ids[8]],[2,ids[9]]]);
  // 당겨진 자리에 다음 참가자가 충돌 없이 들어온다
  assert.equal(await enter(ids[10],"o3"),open);
  assert.deepEqual((await entries(open)).map(e=>e.lane),[1,2,3]);
  // 같은 함수를 다시 불러도 안전하다
  await db.query("select public.derby_forget($1)",[ids[0]]);

  // 대결 기록과 세션은 auth.users 삭제에 함께 지워진다
  await db.query("insert into public.duel_players(owner_id,stats,plan) values($1,'{}','[]'),($2,'{}','[]')",[ids[0],ids[1]]);
  await db.query("insert into public.duel_matches values(gen_random_uuid(),$1,$2,'{}',now())",[ids[0],ids[1]]);
  await db.query("insert into public.battle_run_sessions(owner_id,run_id,course_hash) values($1,1,'x')",[ids[0]]);
  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1",[ids[0]]);
  // FK가 남은 참가 기록도 지운다
  await db.query("delete from auth.users where id=$1",[ids[8]]);
  await db.exec("set role service_role");
  assert.equal((await db.query("select 1 from public.duel_players where owner_id=$1",[ids[0]])).rows.length,0);
  assert.equal((await db.query("select 1 from public.duel_matches where challenger=$1",[ids[0]])).rows.length,0);
  assert.equal((await db.query("select 1 from public.battle_run_sessions where owner_id=$1",[ids[0]])).rows.length,0);
  assert.equal((await entries(open))[0].owner_id,null);
  await db.exec("reset role;set role authenticated");
  await assert.rejects(db.query("select public.derby_forget($1)",[ids[1]]));
  console.log("PASS: finished race anonymized, open race seat freed, cascade removes battle data, clients cannot call it");
}finally{await db.close();}
