import { expect,it } from "vitest";
import { reconcileMessageSnapshot } from "./messageReconcile";
import type { Message } from "../types";
const message=(id:number,text="old"):Message=>({id,remoteId:`remote-${id}`,text,author:"Peer",time:"10:00",createdAt:id});
it("refreshes old edits and removes confirmed missing rows without duplicating arrivals",()=>{
 const old=message(1),deleted=message(2),local={...message(3),remoteId:undefined,delivery:"failed" as const};
 const result=reconcileMessageSnapshot([old,deleted,local],[old,deleted],[message(1,"edited"),message(4)]);
 expect(result.map(row=>row.id)).toEqual([1,3,4]);expect(result[0].text).toBe("edited");
});
it("preserves realtime updates and deletions that happened during a fetch",()=>{
 const old=message(1),removed=message(2),newer={...old,text:"newer"};
 const result=reconcileMessageSnapshot([newer,message(3)],[old,removed],[message(1,"stale"),message(2),message(3)]);
 expect(result.map(row=>row.id)).toEqual([1,3]);expect(result[0].text).toBe("newer");
});
it("an empty successful snapshot clears checked rows while preserving optimistic messages",()=>{
 const old=message(1),pending={...message(2),remoteId:undefined};
 expect(reconcileMessageSnapshot([old,pending],[old],[])).toEqual([pending]);
});
