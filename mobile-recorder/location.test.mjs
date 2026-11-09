import {test} from "node:test";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";

test("SQLite 위치 저장, 잠금 재시도, 중복·튀는 좌표·정확도 검사와 삭제",async()=>{
  const sql=new DatabaseSync(":memory:");
  let callback,active=false,locked=false,retries=0;
  const db={
    execAsync:q=>sql.exec(q),
    runAsync:(q,...args)=>sql.prepare(q).run(...args),
    getFirstAsync:(q,...args)=>sql.prepare(q).get(...args),
    getAllAsync:(q,...args)=>sql.prepare(q).all(...args),
    async withExclusiveTransactionAsync(fn){
      if(locked){locked=false;retries++;throw Error("database is locked");}
      sql.exec("BEGIN");
      try {await fn(db);sql.exec("COMMIT");} catch(e){sql.exec("ROLLBACK");throw e;}
    }
  };
  const modules={
    "expo-audio": {createAudioPlayer(){},setAudioModeAsync:async()=>{}},
    "./turnAudio": {turnAudio:{}},
    "react-native": {PermissionsAndroid:{},Platform:{OS:"ios"}},
    "expo-location": {requestForegroundPermissionsAsync:async()=>({granted:true}),requestBackgroundPermissionsAsync:async()=>({granted:true}),hasStartedLocationUpdatesAsync:async()=>active,startLocationUpdatesAsync:async()=>{active=true;},stopLocationUpdatesAsync:async()=>{active=false;},Accuracy:{High:1},ActivityType:{Fitness:1}},
    "expo-sqlite": {openDatabaseAsync:async()=>db},
    "expo-speech": {speak(){},stop(){}},
    "expo-task-manager": {defineTask:(_,fn)=>{callback=fn;}},
    "expo-file-system": {File:class {exists=false;},Paths:{cache:"cache"}}
  };
  const code = new vm.SourceTextModule(await readFile(new URL("./location.js",import.meta.url),"utf8"));
  await code.link(key=>new vm.SyntheticModule(Object.keys(modules[key]),function(){
    for(const [name,val] of Object.entries(modules[key])) this.setExport(name,val);
  }));
  await code.evaluate();
  const {begin,stop,read,erase}=code.namespace;
  await begin(100,100,[]);
  function point(timestamp,longitude,accuracy=8){return {timestamp,coords:{latitude:35,longitude,accuracy}};}
  const batch={data:{locations:[point(1000,129),point(2000,130),point(3000,129.00005),point(4000,129.00005,80)]}};
  locked=true;
  await callback(batch);await callback(batch);
  const r=await read(100,0);
  assert.equal(retries,1);
  assert.deepEqual(r.points.map(p=>p.time),[1000,3000]);
  assert.equal(r.health.state,"정확도 부족");
  assert.equal(r.health.saved,3000);
  await assert.rejects(erase([100]));
  await stop(100);await erase([100]);
  assert.equal((await read(100,0)).points.length,0);
});

