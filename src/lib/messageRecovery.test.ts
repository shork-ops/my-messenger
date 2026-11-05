import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({ supabase: { rpc } }));
import { fetchRecoveryMessages } from "./messageRecovery";
const page = (offset: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: String(offset+i).padStart(8,"0"), chat_id: "chat" }));
beforeEach(() => vi.resetAllMocks());
it("traverses 251 rows without dropping the middle pages", async () => {
 rpc.mockResolvedValueOnce({data:page(0,100)}).mockResolvedValueOnce({data:page(100,100)}).mockResolvedValueOnce({data:page(200,51)});
 expect(await fetchRecoveryMessages("chat",0)).toHaveLength(251);
 expect(rpc.mock.calls[1][1].p_after).toBe("00000099");
 expect(rpc.mock.calls[2][1].p_after).toBe("00000199");
});
it("does not return a partial snapshot on a failed later page", async () => {
 rpc.mockResolvedValueOnce({data:page(0,100)}).mockResolvedValueOnce({error:{message:"offline"}});
 expect(await fetchRecoveryMessages("chat",0)).toBeNull();
});
it("rejects non-advancing cursors and unexpected chats", async () => {
 rpc.mockResolvedValue({data:page(0,100)});
 expect(await fetchRecoveryMessages("chat",0)).toBeNull();
 expect(rpc).toHaveBeenCalledTimes(2);
 rpc.mockResolvedValue({data:[{id:"1",chat_id:"other"}]});
 expect(await fetchRecoveryMessages("chat",0)).toBeNull();
});
