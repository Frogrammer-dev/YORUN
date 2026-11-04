import assert from "node:assert/strict";
import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
const db=new PGlite();
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);");
 await db.exec(await readFile(new URL("../migrations/0004_battle_run_sessions.sql",import.meta.url),"utf8"));
 const owner=(await db.query("insert into auth.users values(gen_random_uuid()) returning id")).rows[0].id;
 await db.exec("set role service_role");
 const id=(await db.query("insert into public.battle_run_sessions(owner_id,run_id,course_hash) values ($1,1,'course') returning id",[owner])).rows[0].id;
 await assert.rejects(db.query("insert into public.battle_run_sessions(owner_id,run_id,course_hash) values ($1,1,'new')",[owner]));
 const seal=()=>db.query("update public.battle_run_sessions set trace_hash='finished',sealed_at=now() where id=$1 and trace_hash is null returning id",[id]);
 assert.equal((await seal()).rows.length,1);
 assert.equal((await seal()).rows.length,0);
 await db.exec("reset role;set role authenticated");await assert.rejects(db.query("select * from public.battle_run_sessions"));
 console.log("PASS: session schema, unique start, first seal wins, direct client access denied");
}finally{await db.close();}
