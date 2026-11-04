import React, {useRef,useState} from "react";
import {Alert,Button,ScrollView,Text,View,SafeAreaView} from "react-native";
import {WebView} from "react-native-webview";
import {registerRootComponent} from "expo";
import {begin,stop,read,erase,database} from "./location";

const address=process.env.EXPO_PUBLIC_YORUN_ORIGIN;
const origin=address && new URL(address).protocol==="https:" ? new URL(address).origin : null;
function App(){
  const browser=useRef(null);
  const [history,setHistory]=useState(null);
  const [message,setMessage]=useState("");
  async function list(){
    setHistory(await (await database).getAllAsync("SELECT id,ended,(SELECT count(*) FROM fix WHERE run=id) AS count FROM run ORDER BY id DESC"));
  }
  function confirmDelete(ids){
    Alert.alert("이 기기의 원본 위치를 지울까요?","이미 만든 작품과 지급한 포인트는 유지됩니다.",[
      {text:"취소"},{text:"삭제",style:"destructive",onPress:()=>erase(ids).then(list).catch(e=>setMessage(e.message))}
    ]);
  }
  async function receive(event){
    const {url,data}=event.nativeEvent;
    if(!origin || new URL(url).origin!==origin) return;
    let req;
    try{req=JSON.parse(data);}catch{return;}
    if(!Number.isSafeInteger(req.seq)||!Number.isSafeInteger(req.id)||req.id<=0) return;
    let result;
    try{
      if(req.op==="begin") await begin(req.id,req.since,req.turns);
      else if(req.op==="stop") await stop(req.id);
      else if(req.op==="read") result=await read(req.id,req.after);
      else return;
    }catch(e){result={failure:e.message};}
    const payload=JSON.stringify({seq:req.seq,result:result??{}});
    browser.current?.injectJavaScript("window.dispatchEvent(new CustomEvent('yorun-native',{detail:"+payload+"}));true;");
  }
  return <SafeAreaView style={{flex:1,paddingTop:24}}>
    {origin ? <View style={{flex:1,display:history?"none":"flex"}}><WebView ref={browser} source={{uri:origin+"/running"}} originWhitelist={[origin]}
      onShouldStartLoadWithRequest={r=>r.url==="about:blank" || new URL(r.url).origin===origin}
      onMessage={receive} geolocationEnabled /></View> : <Text>빌드 전에 EXPO_PUBLIC_YORUN_ORIGIN에 요런의 HTTPS 배포 주소를 설정하세요.</Text>}
    {history && <ScrollView><Text>{message}</Text>{history.map(r=><View key={r.id}><Text>{new Date(r.id).toLocaleString()} · {r.count}점</Text>
      <Button title="기록 삭제" onPress={()=>confirmDelete([r.id])}/>
      {r.ended===null && <Button title="위치 수집 중단" onPress={()=>stop(r.id).then(list).catch(e=>setMessage(e.message))}/>}
    </View>)}<Button title="원본 위치 전체 삭제" onPress={()=>confirmDelete(history.map(r=>r.id))}/></ScrollView>}
    <Button title={history?"러닝 화면":"기기 위치 기록 관리"} onPress={()=>history?setHistory(null):list().catch(e=>Alert.alert(e.message))}/>
  </SafeAreaView>;
}
registerRootComponent(App);
