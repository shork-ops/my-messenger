import { beforeEach, expect, it, vi } from "vitest";
const server = vi.hoisted(() => ({rpc:vi.fn()}));
vi.mock("./supabase", () => ({supabase:{rpc:server.rpc}}));
import { fetchLatestMessages, fetchOlderMessages, fetchKnownMessages, mapMessageRow } from "./messageSync";
beforeEach(()=>vi.resetAllMocks());
it("uses the server history contract on a new device and keeps precise cursors",async()=>{
 server.rpc.mockResolvedValue({data:[],error:null});
 expect(await fetchLatestMessages("chat",50)).toEqual([]);
 expect(server.rpc).toHaveBeenLastCalledWith("message_history_page",{p_chat:"chat",p_limit:50});
 const cursor={createdAt:"2026-11-01T10:00:00.123456+00:00",id:"message"};
 await fetchOlderMessages("chat",cursor,50);
 expect(server.rpc).toHaveBeenLastCalledWith("message_history_page",{p_chat:"chat",p_before_at:cursor.createdAt,p_before_id:"message",p_limit:50});
});
it("does not turn a history error into an empty successful page",async()=>{
 server.rpc.mockResolvedValue({data:null,error:{code:"42501"}});
 expect(await fetchLatestMessages("chat",50)).toBeNull();
 expect(await fetchKnownMessages("chat",["message"])).toBeNull();
});
it("maps a scheduled row using its send time and clears its pending state after delivery",async()=>{
 const row={id:"00000000-0000-0000-0000-000000000001",chat_id:"chat",sender_id:"me",body:"scheduled",created_at:"2026-01-01T00:00:00Z",send_at:"2026-11-01T10:00:00.123456Z",timeline_at:"2026-11-01T10:00:00.123456Z",history_pending:true};
 const options={accountId:"me",selfName:"Me",authorName:"Peer"};
 const pending=await mapMessageRow(row,options);
 expect(pending?.createdAt).toBe(Date.parse(row.send_at));
 expect(pending?.historyAt).toBe(row.timeline_at);
 expect(pending?.sendAt).toBe(Date.parse(row.send_at));
 const delivered=await mapMessageRow({...row,history_pending:false},options);
 expect(delivered?.sendAt).toBeUndefined();
});
