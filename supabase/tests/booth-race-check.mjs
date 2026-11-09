import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
const db=new PGlite();
const sql=name=>readFile(new URL("../migrations/"+name,import.meta.url),"utf8");
const rows=async(q,p)=>(await db.query(q,p)).rows;
try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);grant usage on schema auth to service_role;");
  await db.exec(await sql("0008_booth_race.sql"));await db.exec(await sql("0010_booth_race_ten_seconds.sql"));
  const ids=(await rows("insert into auth.users select gen_random_uuid() from generate_series(1,10) returning id")).map(r=>r.id);
  await db.exec("set role service_role");
  const enter=async id=>(await rows("select public.booth_race_enter($1,'{\"avgPaceSecPerKm\":330}') race",[id]))[0].race;
  const status=async race=>(await rows("select public.booth_race_status($1) s",[race]))[0].s;

  // 같은 사람이 다시 눌러도 자리는 하나다
  const first=await enter(ids[0]);
  assert.equal(await enter(ids[0]),first);
  assert.equal((await rows("select 1 from public.booth_race_entries where race=$1",[first])).length,1);
  let state=await status(first);
  assert.equal(state.closed,false);assert.ok(state.secondsLeft>0&&state.secondsLeft<=10);

  // 8명이 차면 바로 마감되고, 레인은 1~8로 겹치지 않으며, 9번째는 새 경주로 간다
  for(let i=1;i<8;i++)assert.equal(await enter(ids[i]),first);
  assert.deepEqual((await rows("select lane from public.booth_race_entries where race=$1 order by lane",[first])).map(r=>r.lane),[1,2,3,4,5,6,7,8]);
  assert.equal((await status(first)).closed,true);
  const second=await enter(ids[8]);
  assert.notEqual(second,first);

  // 60초가 지난 경주에는 들어가지 않고, 마감으로 본다
  await db.exec("reset role");
  await db.query("update public.booth_races set closes=now()-interval '1 second' where id=$1",[second]);
  await db.exec("set role service_role");
  assert.equal((await status(second)).closed,true);
  const third=await enter(ids[9]);
  assert.notEqual(third,second);
  // 마감된 경주에 있던 사람은 다음 경주에 다시 참가할 수 있다
  assert.equal(await enter(ids[8]),third);

  // 계정이 지워져도 끝난 경주의 결과는 남고 누구인지 알 수 없다
  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1",[ids[0]]);
  assert.equal((await rows("select owner_id from public.booth_race_entries where race=$1 and lane=1",[first]))[0].owner_id,null);

  // 앱 사용자는 표와 함수에 직접 접근할 수 없다
  for(const role of ["anon","authenticated"]){
    await db.exec("set role "+role);
    await assert.rejects(db.query("select * from public.booth_race_entries"));
    await assert.rejects(db.query("select public.booth_race_enter($1,'{}')",[ids[1]]));
    await db.exec("reset role");
  }
  console.log("PASS: one seat per person, 8 seats then new race, 10s close, anonymized on delete, clients blocked");
}finally{await db.close();}
