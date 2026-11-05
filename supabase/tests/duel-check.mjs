import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
const db=new PGlite();
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);");
 await db.exec(await readFile(new URL("../migrations/0003_player_duels.sql",import.meta.url),"utf8"));
 const {rows}=await db.query("insert into auth.users select gen_random_uuid() from generate_series(1,13) returning id");
 await db.exec("set role service_role");
 for(const {id} of rows)await db.query("insert into public.duel_players(owner_id,stats,plan) values ($1,'{}','[]')",[id]);
 const peers=await db.query("select owner_id from public.duel_players where owner_id<>$1 order by updated desc,player_id limit 10",[rows[0].id]);
 assert.equal(peers.rows.length,10);assert.ok(peers.rows.every(p=>p.owner_id!==rows[0].id));
 const match=await db.query("insert into public.duel_matches values(gen_random_uuid(),$1,$2,'{}',now()) returning id",[rows[0].id,peers.rows[0].owner_id]);
 await assert.rejects(db.query("insert into public.duel_matches values(gen_random_uuid(),$1,$1,'{}',now())",[rows[0].id]));
 for(const id of [rows[0].id,peers.rows[0].owner_id])assert.equal((await db.query("select id from public.duel_matches where challenger=$1 or defender=$1",[id])).rows[0].id,match.rows[0].id);
 await db.exec("reset role;set role authenticated");
 await assert.rejects(db.query("select * from public.duel_players"));
 console.log("PASS: ten distinct opponents, both histories, self challenge rejected, private strategies");
}finally{await db.close();}
