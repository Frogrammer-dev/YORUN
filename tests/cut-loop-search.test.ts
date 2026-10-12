import { expect, it } from "vitest";
import { minimizeBinaryEnergy } from "@/lib/route/cutLoopSearch";

it("matches exhaustive partitions including virtual-outside boundary costs",()=>{
  for(let fixture=0;fixture<8;fixture++){
    const n=fixture%3+4;
    const cost0=Array.from({length:n},(_,i)=>(i*3+fixture*7)%11/5);
    const cost1=Array.from({length:n},(_,i)=>(i*7+fixture*2)%13/4);
    const pairs:Array<[number,number,number]>=[];
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if((i+j+fixture)%3!==0)pairs.push([i,j,((i+1)*(j+2)+fixture)%7/3]);
    // Label 1 pays for an edge into an outside node fixed to label 0.
    cost1[0]+=.9;cost1[n-1]+=1.7;
    let exact=Infinity;
    for(let partition=0;partition<2**n;partition++){
      const labels=Array.from({length:n},(_,i)=>(partition>>i)&1);
      const energy=labels.reduce((s,x,i)=>s+(x?cost1[i]:cost0[i]),0)+pairs.reduce((s,[a,b,w])=>s+(labels[a]!==labels[b]?w:0),0);
      exact=Math.min(exact,energy);
    }
    const actual=minimizeBinaryEnergy(cost0,cost1,pairs);
    expect(actual.energy).toBeCloseTo(exact,8);
    expect(actual.flow).toBeCloseTo(exact,8);
  }
});

it("uses the correct terminal labels and retains disconnected optimal choices",()=>{
  expect(minimizeBinaryEnergy([20,0,0,9],[0,10,8,0],[]).labels).toEqual([1,0,0,1]);
  expect(()=>minimizeBinaryEnergy([0],[0],[[0,1,1]])).toThrow();
  expect(()=>minimizeBinaryEnergy([0],[-1],[])).toThrow();
});
