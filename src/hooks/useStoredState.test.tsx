/** @vitest-environment jsdom */
import { act,cleanup,renderHook } from "@testing-library/react";
import { afterEach,beforeEach,expect,it } from "vitest";
import { useChatFolders } from "./useChatFolders";
import { accountStorageKey,useStoredState } from "./useStoredState";
afterEach(cleanup);beforeEach(()=>localStorage.clear());
const parse=(raw:string|null)=>raw?JSON.parse(raw) as Record<string,string>:{};
it("isolates state across accounts, ignores stale setters and preserves each account's data",()=>{
 localStorage.setItem("drafts",JSON.stringify({chat:"unowned legacy draft"}));
 const {result,rerender}=renderHook(({id}:{id:string|null})=>useStoredState(accountStorageKey("drafts",id),parse),{initialProps:{id:"one" as string|null}});
 expect(result.current[0]).toEqual({});
 const stale=result.current[1];act(()=>result.current[1]({chat:"one secret"}));
 rerender({id:"two"});expect(result.current[0]).toEqual({});
 act(()=>stale({chat:"late one secret"}));expect(result.current[0]).toEqual({});
 act(()=>result.current[1]({chat:"two secret"}));
 expect(JSON.parse(localStorage.getItem("drafts:one")!)).toEqual({chat:"one secret"});
 rerender({id:null});expect(result.current[0]).toEqual({});
 rerender({id:"one"});expect(result.current[0]).toEqual({chat:"one secret"});
 expect(JSON.parse(localStorage.getItem("drafts:two")!)).toEqual({chat:"two secret"});
});
it("folder actions follow the currently selected account",()=>{
 const {result,rerender}=renderHook(({id})=>useChatFolders(id),{initialProps:{id:"one"}});
 act(()=>result.current.createFolder("Private"));expect(result.current.folders).toHaveLength(1);
 rerender({id:"two"});expect(result.current.folders).toHaveLength(0);
 act(()=>result.current.createFolder("Work"));expect(result.current.folders[0].name).toBe("Work");
 rerender({id:"one"});expect(result.current.folders[0].name).toBe("Private");
});
