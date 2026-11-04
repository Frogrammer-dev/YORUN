import { PermissionsAndroid, Platform } from "react-native";
import * as Location from "expo-location";
import * as SQLite from "expo-sqlite";
import * as Speech from "expo-speech";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { turnAudio } from "./turnAudio";
import * as Tasks from "expo-task-manager";
import { File, Paths } from "expo-file-system";

export const task = "yorun-run-location";
export const database = SQLite.openDatabaseAsync("runs.db").then(async db => {
  await db.execAsync(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS run(id INTEGER PRIMARY KEY, ended INTEGER);
    CREATE TABLE IF NOT EXISTS fix(run INTEGER, time INTEGER, lat REAL, lon REAL, PRIMARY KEY(run,time));
    CREATE TABLE IF NOT EXISTS health(run INTEGER PRIMARY KEY, received INTEGER, state TEXT, turns TEXT, next INTEGER DEFAULT 0, since INTEGER);`);
  const columns = await db.getAllAsync("PRAGMA table_info(fix)");
  if (!columns.some(column => column.name === "accuracy"))
    await db.execAsync("ALTER TABLE fix ADD COLUMN accuracy REAL");
  return db;
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function meters(a,b) {
  const rad = Math.PI/180;
  const h = Math.sin((b.lat-a.lat)*rad/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lon-a.lon)*rad/2)**2;
  return 12742000*Math.asin(Math.sqrt(Math.min(1,h)));
}
let storageError = "";
let lastWarning = 0;
let preferredVoice;
let player;
async function playTurn(turn) {
  const source = turnAudio[turn.label]?.[turn.voice === "male" ? "male" : "female"];
  if (source === undefined) return say(turn.label);
  try {
    await setAudioModeAsync({playsInSilentMode:true, shouldPlayInBackground:true, interruptionMode:"duckOthers"});
    player?.remove();
    const current = createAudioPlayer(source);
    player = current;
    current.addListener("playbackStatusUpdate", status => {
      if (status.didJustFinish && player === current) { current.remove(); player = undefined; }
    });
    current.play();
  } catch { await say(turn.label); }
}
async function say(text) {
  preferredVoice ??= Speech.getAvailableVoicesAsync().then(voices =>
    voices.find(v => /^ko/i.test(v.language) && v.quality === "Enhanced")?.identifier
  ).catch(() => undefined);
  Speech.speak(text, {language:"ko-KR", voice:await preferredVoice, rate:0.98});
}
function warn(message) {
  if (Date.now() - lastWarning < 60000) return;
  lastWarning = Date.now();
  void say(message);
}
Tasks.defineTask(task, async ({data,error}) => {
  const db = await database;
  if (error) {
    storageError = error.message;
    warn("위치 수신 오류입니다. 기록 상태를 확인하세요.");
    await db.runAsync("UPDATE health SET state='수신 오류' WHERE run IN (SELECT id FROM run WHERE ended IS NULL)");
    return;
  }
  const fixes = [...(data?.locations ?? [])].sort((a,b)=>a.timestamp-b.timestamp);
  for (let attempt=0; attempt<4; attempt++) {
    const messages=[];
    try {
      await db.withExclusiveTransactionAsync(async tx => {
        const run = await tx.getFirstAsync("SELECT * FROM run JOIN health ON health.run=run.id WHERE ended IS NULL ORDER BY id DESC LIMIT 1");
        if (!run) return;
        let prev = await tx.getFirstAsync("SELECT * FROM fix WHERE run=? ORDER BY time DESC LIMIT 1",run.id);
        const turns = JSON.parse(run.turns || "[]");
        for (const {timestamp:time,coords} of fixes) {
          if (time<run.since || time <= (prev?.time ?? 0)) continue;
          const point={lat:coords.latitude,lon:coords.longitude,time};
          let state="정상";
          if (!(coords.accuracy!=null && coords.accuracy>=0 && coords.accuracy<=35)) state="정확도 부족";
          else if (prev && prev.time>=run.since && time-prev.time<=60000 && meters(prev,point)/(0.001*(time-prev.time))>8.5) state="위치 튐";
          await tx.runAsync("UPDATE health SET received=?,state=? WHERE run=?",time,state,run.id);
          if (state!=="정상") {
            if (state==="정확도 부족" && time-(prev?.time ?? run.since)>30000)
              warn("정확한 위치를 받지 못하고 있습니다.");
            continue;
          }
          await tx.runAsync("INSERT OR IGNORE INTO fix(run,time,lat,lon,accuracy) VALUES(?,?,?,?,?)",run.id,time,point.lat,point.lon,coords.accuracy);
          prev=point;
          let turn=turns[run.next];
          const near=turns[run.next+1];
          if(turn?.radius===12 && near?.radius===20 && meters(point,near)<near.radius) {
            run.next++;
            turn=near;
          }
          if (turn && meters(point,turn)<(turn.radius ?? 35)) {
            messages.push(turn);
            await tx.runAsync("UPDATE health SET next=? WHERE run=?",++run.next,run.id);
          }
        }
      });
      storageError="";
      if (messages.length) void playTurn(messages.at(-1));
      return;
    } catch(e) {
      storageError="위치 저장 실패: "+e.message;
      if(attempt===3) warn("위치 저장에 실패했습니다. 기록 상태를 확인하세요.");
      if(attempt===3) throw e;
      await wait(150*(attempt+1));
    }
  }
});

export async function begin(id, since, turns) {
  const db=await database;
  if(await Location.hasStartedLocationUpdatesAsync(task)){
    const current=await db.getFirstAsync("SELECT id FROM run WHERE ended IS NULL ORDER BY id DESC LIMIT 1");
    if(current?.id===id) return;
    throw new Error("진행 중인 달리기를 먼저 종료하세요.");
  }
  if(!(await Location.requestForegroundPermissionsAsync()).granted || !(await Location.requestBackgroundPermissionsAsync()).granted)
    throw new Error("설정에서 정확한 위치와 백그라운드 위치를 허용하세요.");
  if(Platform.OS==="android" && Platform.Version>=33)
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  await db.withExclusiveTransactionAsync(async tx=>{
    await tx.runAsync("UPDATE run SET ended=? WHERE ended IS NULL",since);
    await tx.runAsync("INSERT INTO run VALUES(?,NULL) ON CONFLICT(id) DO UPDATE SET ended=NULL",id);
    await tx.runAsync("INSERT INTO health(run,state,turns,since) VALUES(?,'첫 위치 대기',?,?) ON CONFLICT(run) DO UPDATE SET since=excluded.since,state=excluded.state,turns=excluded.turns",id,JSON.stringify(turns),since);
  });
  try {
    await Location.startLocationUpdatesAsync(task,{accuracy:Location.Accuracy.High,distanceInterval:3,timeInterval:2000,activityType:Location.ActivityType.Fitness,pausesUpdatesAutomatically:false,showsBackgroundLocationIndicator:true,foregroundService:{notificationTitle:"요런 달리기 진행 중",notificationBody:"GPS 수신 상태는 러닝 화면에서 확인하세요."}});
  } catch(e){await db.runAsync("UPDATE run SET ended=? WHERE id=?",Date.now(),id);throw e;}
}
export async function stop(id){
  const db=await database;
  const current=await db.getFirstAsync("SELECT id FROM run WHERE ended IS NULL ORDER BY id DESC LIMIT 1");
  if(current?.id!==id) return;
  if(await Location.hasStartedLocationUpdatesAsync(task)) await Location.stopLocationUpdatesAsync(task);
  await db.runAsync("UPDATE run SET ended=? WHERE id=?",Date.now(),id);
  Speech.stop();
  player?.remove();
  player = undefined;
}
export async function read(id,after){
  const db=await database;
  const points=await db.getAllAsync("SELECT lat,lon,time,COALESCE(accuracy,35) AS accuracy FROM fix WHERE run=? AND time>? ORDER BY time",id,after);
  const health=await db.getFirstAsync("SELECT state,received,(SELECT max(time) FROM fix WHERE run=?) AS saved,(SELECT count(*) FROM fix WHERE run=?) AS count FROM health WHERE run=?",id,id,id);
  return {points,health,service:await Location.hasStartedLocationUpdatesAsync(task),error:storageError};
}
export async function erase(ids){
  const db=await database;
  for(const id of ids){
    const row=await db.getFirstAsync("SELECT ended FROM run WHERE id=?",id);
    if(row && row.ended===null && await Location.hasStartedLocationUpdatesAsync(task)) throw new Error("진행 중인 달리기를 먼저 종료하세요.");
    const file=new File(Paths.cache,`yorun-${id}.gpx`);
    if(file.exists) file.delete();
    await db.withExclusiveTransactionAsync(async tx=>{
      for(const [table,key] of [["fix","run"],["health","run"],["run","id"]]) await tx.runAsync("DELETE FROM "+table+" WHERE "+key+"=?",id);
    });
  }
}
