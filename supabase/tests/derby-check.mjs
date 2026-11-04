import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

const db=new PGlite();
try{
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile(new URL("../migrations/0002_derby.sql",import.meta.url),"utf8"));
  await db.exec("set role service_role");
  const enter=async(i,hash="a")=>(await db.query("select public.derby_enter($1,$2,'{}') as race",["00000000-0000-4000-8000-"+String(i).padStart(12,"0"),hash])).rows[0].race;
  const first=await enter(1);
  assert.equal(await enter(1,"b"),first);
  for(let i=2;i<=8;i++)assert.equal(await enter(i),first);
  const second=await enter(9);
  assert.notEqual(second,first);
  assert.equal(await enter(1),first);
  assert.equal(await enter(1,"b"),second);
  assert.equal((await db.query("select count(*)::int n from public.derby_entries where race=$1",[first])).rows[0].n,8);
  await db.exec("reset role; set role authenticated");
  await assert.rejects(()=>enter(10));
  await assert.rejects(()=>db.query("select * from public.derby_entries"));
  console.log("PASS: eight distinct lanes, retry, pending entry, next race, private standings");
}finally{await db.close();}
