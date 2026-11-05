/** @vitest-environment jsdom */
import { act,cleanup,renderHook } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import type { Chat,Message } from "../types";
const mock=vi.hoisted(()=>({on:vi.fn(),subscribe:vi.fn(),removeChannel:vi.fn(),rpc:vi.fn(),map:vi.fn()}));
vi.mock("../lib/supabase",()=>({supabase:{channel:()=>mock,removeChannel:mock.removeChannel,rpc:mock.rpc}}));
vi.mock("../lib/messageSync",()=>({mapMessageRow:mock.map}));
import { useRealtimeChat } from "./useRealtimeChat";
let chats:Chat[];
let events:(event:{eventType:string;new:Record<string,unknown>;old?:Record<string,unknown>})=>Promise<void>;
const original:Message={id:1,remoteId:"message",author:"Peer",text:"original",time:"10:00",createdAt:1,attachment:{name:"private",type:"image/png",data:"private-url",size:1}};
beforeEach(()=>{
 vi.clearAllMocks();
 chats=[{id:1,remoteId:"chat",name:"Peer",avatar:"P",color:"blue",preview:"original",time:"10:00",messages:[original]}];
 mock.on.mockImplementation((_type,filter,callback)=>{if(filter.table==="messages")events=callback;return mock;});
 mock.subscribe.mockReturnValue(mock);mock.rpc.mockResolvedValue({data:null});
 mock.map.mockResolvedValue({...original,id:2,remoteId:"other",mine:true,text:"from other device"});
});
afterEach(cleanup);
function open(){return renderHook(()=>useRealtimeChat({accountId:"me",profileName:"Me",remoteId:"chat",visible:{chatOpen:false,conversationOnScreen:false,documentVisible:true},setChats:update=>{chats=typeof update==="function"?update(chats):update;}}));}
it("applies edit timestamps and clears deleted media immediately",async()=>{
 open();await act(async()=>{await events({eventType:"UPDATE",new:{id:"message",body:"changed",edited_at:"2026-01-01"}});});
 expect(chats[0].messages[0].edited).toBe(true);
 await act(async()=>{await events({eventType:"UPDATE",new:{id:"message",body:"",deleted_at:"2026-01-01"}});});
 expect(chats[0].messages[0].text).toBe("Сообщение удалено");expect(chats[0].messages[0].attachment).toBeUndefined();
});
it("handles hard deletion and inserts from another device of this same account",async()=>{
 open();await act(async()=>{await events({eventType:"DELETE",new:{},old:{id:"message"}});});expect(chats[0].messages).toHaveLength(0);
 await act(async()=>{await events({eventType:"INSERT",new:{id:"other",chat_id:"chat",sender_id:"me"}});});
 expect(chats[0].messages[0].text).toBe("from other device");expect(mock.rpc).not.toHaveBeenCalled();
});
it("discarded subscriptions cannot append late attachment results",async()=>{
 let finish:(message:Message)=>void=()=>{};mock.map.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const {unmount}=open();const pending=events({eventType:"INSERT",new:{id:"other",chat_id:"chat",sender_id:"peer"}});
 unmount();await act(async()=>{finish({...original,id:2,remoteId:"other"});await pending;});
 expect(chats[0].messages).toHaveLength(1);
});
