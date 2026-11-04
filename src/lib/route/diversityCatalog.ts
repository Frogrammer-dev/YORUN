import { SHAPE_BY_ID, type ShapeDef, type ShapeId } from './shapes';
import { OBJECT_TEMPLATES } from './objectTemplates';

export interface DiversityItem {
  key:string; kind:'animal'|'object'; shape:ShapeDef; aliases:readonly string[];
  freeNameAliases:readonly string[];
  identifyingFeatures:string; roadRisk:string; ambiguity:string;
}
type Description=Omit<DiversityItem,'shape'|'freeNameAliases'>;
/** Template-structure hypotheses for review, not measured human-recognition difficulty. */
const descriptions:Description[]=[
  {key:'cat',kind:'animal',aliases:['cat'],identifyingFeatures:'양쪽 뾰족한 귀와 얼굴 윤곽',roadRisk:'귀 사이 간격과 귀 끝이 도로에서 합쳐질 수 있음',ambiguity:'귀가 손상되면 일반 다각형이나 다른 동물 얼굴로 보일 수 있음'},
  {key:'fish',kind:'animal',aliases:['fish'],identifyingFeatures:'몸통과 갈라진 꼬리',roadRisk:'원본 외곽에 접점이 반복되어 단순 고리와 다른 연결이 필요함',ambiguity:'눈·지느러미가 없어서 잎이나 다른 물고기류와 혼동 가능'},
  {key:'dog',kind:'animal',aliases:['dog'],identifyingFeatures:'머리·주둥이·다리·꼬리의 상대 위치',roadRisk:'여러 짧은 다리와 배 아래 오목한 부분이 도로에서 축소될 수 있음',ambiguity:'머리·다리가 손상되면 다른 네발동물이나 일반 경계로 보일 수 있음'},
  {key:'rabbit',kind:'animal',aliases:['rabbit'],identifyingFeatures:'긴 두 귀와 앉은 몸통',roadRisk:'좁고 가까운 두 귀를 별도 도로로 보존하기 어려울 수 있음',ambiguity:'귀가 합쳐지면 한 개 돌출부가 있는 도형으로 바뀔 수 있음'},
  {key:'bird',kind:'animal',aliases:['bird'],identifyingFeatures:'부리·몸통·꼬리',roadRisk:'짧은 부리와 가는 꼬리 연결이 사라질 수 있음',ambiguity:'날개·다리 내부선이 없는 외곽이라 오리·물고기와 구분이 약할 수 있음'},
  {key:'whale',kind:'animal',aliases:['whale'],identifyingFeatures:'큰 몸통과 꼬리 지느러미',roadRisk:'곡선 몸통이 계단형으로 변하고 꼬리 접합부가 뭉개질 수 있음',ambiguity:'물고기로 읽힌 경우 고래 종 일치와 별도로 기록해야 함'},
  {key:'turtle',kind:'animal',aliases:['sea_turtle'],identifyingFeatures:'등딱지·머리·네 다리·꼬리',roadRisk:'몸통 주변의 작은 돌출부가 여러 개라 경로가 복잡해짐',ambiguity:'CLIP에는 바다거북(sea_turtle) 범주만 있음. 돌출부가 손상되면 꽃·별·불규칙 다각형으로 보일 수 있음'},
  {key:'elephant',kind:'animal',aliases:['elephant'],identifyingFeatures:'길게 내려온 코와 큰 몸통·다리',roadRisk:'좁은 코와 다리 사이 홈이 실제 도로 간격보다 작아질 수 있음',ambiguity:'코가 보존되지 않으면 다른 네발동물과 구분이 약해짐'},
  {key:'giraffe',kind:'animal',aliases:['giraffe'],identifyingFeatures:'긴 목·작은 머리·다리',roadRisk:'길고 가는 목의 두 경계를 따로 이어야 함',ambiguity:'목·머리가 무너지면 의자나 막대가 붙은 도형처럼 보일 수 있음'},
  {key:'butterfly',kind:'animal',aliases:['butterfly'],identifyingFeatures:'좌우 날개 네 부분과 좁은 중앙',roadRisk:'대칭과 중앙의 잘록한 연결을 동시에 보존해야 함',ambiguity:'날개 비율이 변하면 나비넥타이나 일반 대칭 도형으로 보일 수 있음'},
  {key:'duck',kind:'animal',aliases:['duck'],identifyingFeatures:'부리·목·둥근 몸통·꼬리',roadRisk:'짧은 부리와 목의 오목한 연결이 도로에서 생략될 수 있음',ambiguity:'새로만 읽힌 경우 오리 종 일치와 분리해야 함'},
  {key:'house',kind:'object',aliases:['house'],identifyingFeatures:'삼각 지붕과 사각 몸통',roadRisk:'지붕 사선과 처마 돌출부가 격자 도로에 맞지 않을 수 있음',ambiguity:'내부 창문·문이 없어 화살표나 티셔츠로 읽힐 수 있음'},
  {key:'tree',kind:'object',aliases:['tree'],identifyingFeatures:'수관과 좁은 줄기',roadRisk:'줄기 폭이 도로 간격과 맞지 않거나 수관이 각져질 수 있음',ambiguity:'버섯·막대가 붙은 도형과 혼동 가능'},
  {key:'car',kind:'object',aliases:['car'],identifyingFeatures:'지붕·차체·두 바퀴 윤곽',roadRisk:'짧은 바퀴 돌출부와 차체 아래 홈이 손상될 수 있음',ambiguity:'바퀴가 없어지면 단순 계단형 다각형으로 보일 수 있음'},
  {key:'rocket',kind:'object',aliases:['rocket'],identifyingFeatures:'뾰족한 기수와 양옆 날개',roadRisk:'좁은 몸통·날개·하단 홈을 함께 연결해야 함',ambiguity:'현재 CLIP 이름 사전에 없으며 모양 생성과 모델 미지원을 구분해야 함'},
  {key:'apple',kind:'object',aliases:['apple'],identifyingFeatures:'둥근 몸통과 윗부분 줄기·홈',roadRisk:'작은 줄기·홈이 사라지면 둥근 고리만 남을 수 있음',ambiguity:'일반 원이나 다른 과일로 보이는 경우 사과 성공으로 세지 않음'},
  {key:'crown',kind:'object',aliases:['crown'],identifyingFeatures:'위쪽 세 꼭짓점과 아래 띠',roadRisk:'여러 꼭짓점의 사선과 깊은 홈을 함께 맞춰야 함',ambiguity:'지그재그·산 능선으로만 읽히면 일반 도형 판정'},
  {key:'airplane',kind:'object',aliases:['airplane'],identifyingFeatures:'기수·주날개·꼬리날개의 배치',roadRisk:'길고 좁은 날개·몸체와 반복된 돌출부가 서로 간섭할 수 있음',ambiguity:'십자나 나뭇가지로만 보이면 비행기 성공이 아님'},
  {key:'mug',kind:'object',aliases:['coffee_cup','cup'],identifyingFeatures:'컵 몸통과 옆 손잡이',roadRisk:'손잡이 구멍이 없는 단일 외곽에서는 돌출부만 남음',ambiguity:'냄비·일반 용기로 읽힐 수 있어 자유 명명을 따로 기록'},
  {key:'tshirt',kind:'object',aliases:['t-shirt'],identifyingFeatures:'두 소매·목 부분 홈·몸통',roadRisk:'좁은 목 홈과 소매 각도가 도로에서 무너질 수 있음',ambiguity:'목 홈이 사라지면 십자나 지붕 달린 도형으로 보일 수 있음'},
  {key:'pants',kind:'object',aliases:['pants'],identifyingFeatures:'허리와 두 다리 사이 긴 홈',roadRisk:'두 다리 사이의 평행한 도로 연결이 필요함',ambiguity:'홈이 짧으면 의자·문자·일반 꺾인 도형과 혼동 가능'},
  {key:'hammer',kind:'object',aliases:['hammer'],identifyingFeatures:'넓은 머리와 길고 좁은 손잡이',roadRisk:'머리·손잡이 비율과 끝 모양이 각져지거나 손상될 수 있음',ambiguity:'일반 T자 인식만으로 망치 성공이라고 하지 않음'},
  {key:'bottle',kind:'object',aliases:['wine_bottle'],identifyingFeatures:'좁은 병목·어깨·넓은 몸통',roadRisk:'병목과 어깨의 작은 폭 변화가 도로에서 사라질 수 있음',ambiguity:'막대가 붙은 사각형이나 다른 용기로 읽힐 수 있음'},
  {key:'key',kind:'object',aliases:['key'],identifyingFeatures:'큰 머리와 가는 축·여러 이빨',roadRisk:'좁은 축과 짧은 이빨을 동시에 보존해야 함',ambiguity:'머리 구멍이 없는 외곽이라 의자·도구·단순 계단과 혼동 가능'},
  {key:'chair',kind:'object',aliases:['chair'],identifyingFeatures:'등받이·좌판·다리의 상대 위치',roadRisk:'좌판 아래 빈 공간과 다리 간격이 좁아질 수 있음',ambiguity:'모양이 뒤틀리면 문자 h나 열쇠로 보일 수 있음'},
];

const FREE_NAMES:Record<string,readonly string[]>={
  cat:['고양이','고양이 얼굴','고양이 머리','cat','cat face'],fish:['물고기','생선','fish'],
  dog:['개','강아지','dog','puppy'],rabbit:['토끼','rabbit'],bird:['새','bird'],whale:['고래','whale'],
  turtle:['거북이','거북','바다거북','바다거북이','turtle','sea turtle'],elephant:['코끼리','elephant'],
  giraffe:['기린','giraffe'],butterfly:['나비','butterfly'],duck:['오리','duck'],
  house:['집','주택','house'],tree:['나무','tree'],car:['자동차','차','car'],rocket:['로켓','우주 로켓','rocket'],
  apple:['사과','apple'],crown:['왕관','crown'],airplane:['비행기','airplane'],mug:['컵','머그컵','머그','커피잔','cup','coffee cup','mug'],
  tshirt:['티셔츠','반팔 티셔츠','반소매 티셔츠','t-shirt','tshirt'],pants:['바지','긴바지','pants'],
  hammer:['망치','hammer'],bottle:['병','와인병','술병','bottle','wine bottle'],key:['열쇠','key'],chair:['의자','chair'],
};

export const DIVERSITY_CATALOG:DiversityItem[]=descriptions.map(item=>{
  const extended=OBJECT_TEMPLATES.find(t=>t.key===item.key);
  const shape=extended?.shape??SHAPE_BY_ID[item.key as ShapeId];
  if(!shape)throw new Error(`Missing frozen silhouette: ${item.key}`);
  return {...item,shape,freeNameAliases:FREE_NAMES[item.key]};
});

export function diversityModelCoverage(clipNames:ReadonlySet<string>,headNames:ReadonlySet<string>){
  return DIVERSITY_CATALOG.map(item=>({key:item.key,kind:item.kind,
    clipSupported:item.aliases.some(a=>clipNames.has(a)),headSupported:item.aliases.some(a=>headNames.has(a))}));
}
