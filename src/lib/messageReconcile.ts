import { compareMessages } from "./messageOrder";
import type { Message } from "../types";

/** Reconcile only IDs explicitly checked on the server. Preserve arrivals/edits during the request. */
export function reconcileMessageSnapshot(current: Message[], snapshot: Message[], fetched: Message[]): Message[] {
  const checked = new Map(snapshot.filter(message=>message.remoteId).map(message=>[message.remoteId!,message]));
  const remote = new Map(fetched.filter(message=>message.remoteId).map(message=>[message.remoteId!,message]));
  const result: Message[]=[];
  const seen=new Set<string>();
  for(const message of current){
    const id=message.remoteId;
    if(!id){result.push(message);continue;}
    seen.add(id);
    if(!checked.has(id) || checked.get(id)!==message || message.delivery==="sending" || message.delivery==="failed") {result.push(message);continue;}
    const fresh=remote.get(id);
    if(fresh) result.push({...message,...fresh,author:message.author});
  }
  for(const message of fetched){
    if(message.remoteId && !seen.has(message.remoteId) && !checked.has(message.remoteId)){
      seen.add(message.remoteId);result.push(message);
    }
  }
  return result.sort(compareMessages);
}
