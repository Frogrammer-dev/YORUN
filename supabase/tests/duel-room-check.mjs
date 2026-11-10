// 0011 대결 방 규칙을 PGlite로 확인한다: 번호 형식·중복, 자기 방 참가 금지, 선택 값, 진행 중 조건, 권한.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
try {
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);");
  await db.exec(await readFile(new URL("../migrations/0011_duel_rooms.sql", import.meta.url), "utf8"));
  const { rows: [a, b] } = await db.query("insert into auth.users select gen_random_uuid() from generate_series(1,2) returning id");
  await db.exec("set role service_role");
  const room = (code, host = a.id) => db.query("insert into public.duel_rooms(code,host_id,host_name,host_sheet) values ($1,$2,'방장','{}') returning id", [code, host]);
  const { rows: [r] } = await room("123456");
  await assert.rejects(room("123456"), "열린 방 번호는 겹치지 않는다");
  await assert.rejects(room("12345a"), "번호는 숫자 6자리");
  await assert.rejects(db.query("update public.duel_rooms set guest_id=host_id,guest_name='나',guest_sheet='{}',state='{}',status='playing' where id=$1", [r.id]), "자기 방에는 못 들어간다");
  await assert.rejects(db.query("update public.duel_rooms set status='playing' where id=$1", [r.id]), "상대 없이 시작할 수 없다");
  await db.query("update public.duel_rooms set guest_id=$2,guest_name='손님',guest_sheet='{}',state='{}',status='playing' where id=$1", [r.id, b.id]);
  await assert.rejects(db.query("update public.duel_rooms set host_choice='lizard' where id=$1", [r.id]), "선택 값은 네 가지뿐");
  // 두 사람이 각자 자기 칸만 바꾸므로 서로 덮어쓰지 않는다
  await db.query("update public.duel_rooms set host_choice='rock' where id=$1 and host_choice is null", [r.id]);
  await db.query("update public.duel_rooms set guest_choice='paper' where id=$1 and guest_choice is null", [r.id]);
  const both = (await db.query("select host_choice,guest_choice from public.duel_rooms where id=$1", [r.id])).rows[0];
  assert.deepEqual(both, { host_choice: "rock", guest_choice: "paper" });
  // 판정은 turn_no가 그대로일 때 한 번만 저장된다
  const first = await db.query("update public.duel_rooms set turn_no=1,host_choice=null,guest_choice=null where id=$1 and turn_no=0 returning id", [r.id]);
  const second = await db.query("update public.duel_rooms set turn_no=1,host_choice=null,guest_choice=null where id=$1 and turn_no=0 returning id", [r.id]);
  assert.equal(first.rows.length, 1);
  assert.equal(second.rows.length, 0);
  // 끝난 방의 번호는 다시 쓸 수 있다
  await db.query("update public.duel_rooms set status='finished' where id=$1", [r.id]);
  await room("123456");
  await db.exec("reset role;set role authenticated");
  await assert.rejects(db.query("select * from public.duel_rooms"), "클라이언트는 직접 읽지 못한다");
  console.log("PASS: room code format/unique, no self join, choices separate, single resolution, private table");
} finally { await db.close(); }
