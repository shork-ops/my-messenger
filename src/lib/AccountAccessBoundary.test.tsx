/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const rpc=vi.hoisted(()=>vi.fn());
const signOut=vi.hoisted(()=>vi.fn());
vi.mock("./supabase",()=>({supabase:{rpc,auth:{signOut}}}));
import { AccountAccessBoundary } from "./AccountAccessBoundary";
afterEach(cleanup);
beforeEach(()=>{vi.clearAllMocks();rpc.mockResolvedValue({data:null,error:null});});
const view=(id="one",token="token")=><AccountAccessBoundary userId={id} token={token}><div>Private chat</div></AccountAccessBoundary>;
it("waits for server confirmation and hides content when session is revoked",async()=>{
 render(view());expect(screen.queryByText("Private chat")).toBeNull();
 expect(await screen.findByText("Private chat")).toBeTruthy();
 rpc.mockResolvedValue({error:{code:"42501"}});
 fireEvent(window,new Event("online"));
 expect(await screen.findByText("Подтвердите вход")).toBeTruthy();expect(screen.queryByText("Private chat")).toBeNull();
 fireEvent.click(screen.getByText("Выйти"));expect(signOut).toHaveBeenCalledWith({scope:"local"});
});
it("never shows the previous account while checking another and ignores stale responses",async()=>{
 const rendered=render(view());await screen.findByText("Private chat");
 let finish:(value:unknown)=>void=()=>{};
 rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 rendered.rerender(view("two","two-token"));expect(screen.queryByText("Private chat")).toBeNull();
 rpc.mockResolvedValue({error:{code:"42501"}});
 rendered.rerender(view("three","three-token"));await screen.findByText("Подтвердите вход");
 await act(async()=>{finish({error:null});});expect(screen.queryByText("Private chat")).toBeNull();
});
it("a temporary outage does not erase an already verified view; initial failure remains closed",async()=>{
 rpc.mockRejectedValue(new Error("offline"));render(view());
 await screen.findByText("Не удалось проверить доступ");expect(screen.queryByText("Private chat")).toBeNull();
 rpc.mockResolvedValue({error:null});fireEvent.click(screen.getByText("Повторить"));await screen.findByText("Private chat");
 rpc.mockRejectedValue(new Error("offline"));fireEvent(window,new Event("online"));
 await waitFor(()=>expect(rpc).toHaveBeenCalledTimes(3));expect(screen.queryByText("Private chat")).toBeTruthy();
});
