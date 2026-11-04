import { polylineLength, sharpVertices, type ShapeDef } from './shapes';

export type ObjectTemplateKey = 'tshirt' | 'pants' | 'hammer' | 'bottle' | 'key' | 'chair';
export interface ObjectTemplate { key: ObjectTemplateKey; shape: ShapeDef; }
type XY = [number,number];

/** Explicit silhouette priors, not learned weights. Original benchmark shapes stay separate. */
const definitions: {key:ObjectTemplateKey;name:string;points:XY[]}[] = [
  {key:'tshirt',name:'티셔츠',points:[[-.25,.5],[-.1,.5],[-.1,.4],[.1,.4],[.1,.5],[.25,.5],[.5,.25],[.5,.05],[.25,.05],[.25,-.5],[-.25,-.5],[-.25,.05],[-.5,.05],[-.5,.25]]},
  {key:'pants',name:'바지',points:[[-.4,.5],[.4,.5],[.4,-.5],[.1,-.5],[.1,.1],[-.1,.1],[-.1,-.5],[-.4,-.5]]},
  {key:'hammer',name:'망치',points:[[-.5,.5],[.5,.5],[.5,.25],[.1,.25],[.1,-.5],[-.1,-.5],[-.1,.25],[-.5,.25]]},
  {key:'bottle',name:'병',points:[[-.1,.5],[.1,.5],[.1,.25],[.3,.12],[.3,-.5],[-.3,-.5],[-.3,.12],[-.1,.25]]},
  {key:'key',name:'열쇠',points:[[-.5,.5],[-.1,.5],[-.1,.2],[.5,.2],[.5,-.2],[.35,-.2],[.35,0],[.2,0],[.2,-.1],[.05,-.1],[.05,.05],[-.1,.05],[-.1,-.1],[-.5,-.1]]},
  {key:'chair',name:'의자',points:[[-.4,.5],[-.15,.5],[-.15,0],[.4,0],[.4,-.5],[.22,-.5],[.22,-.16],[-.22,-.16],[-.22,-.5],[-.4,-.5]]},
];

export const OBJECT_TEMPLATES: ObjectTemplate[] = definitions.map(({key,name,points:raw})=>{
  const xs=raw.map(p=>p[0]),ys=raw.map(p=>p[1]);
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  const extent=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
  const points:XY[]=raw.map(([x,y])=>[(x-cx)/extent,(y-cy)/extent]);
  points.push([...points[0]]);
  return {key,shape:{id:'custom',name,emoji:'',kind:'object',corners:true,points,perimeter:polylineLength(points),features:sharpVertices(points)}};
});
