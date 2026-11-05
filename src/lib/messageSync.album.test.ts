import {afterEach,expect,it,vi} from "vitest";
const sign=vi.hoisted(()=>vi.fn());
vi.mock("./supabase",()=>({supabase:{storage:{from:()=>({createSignedUrl:sign})}}}));
import {mapMessageRow} from "./messageSync";
const options={accountId:"owner",selfName:"Me",authorName:"Peer"};
const base={id:"00000000-0000-0000-0000-000000000001",chat_id:"chat",sender_id:"owner",body:"2 фото",created_at:"2026-11-05T12:00:00Z"};
afterEach(()=>vi.resetAllMocks());
it("restores every image of a published album after restart",async()=>{
 sign.mockImplementation(async(path:string)=>({data:{signedUrl:'https://signed.invalid/'+path},error:null}));
 const message=await mapMessageRow({...base,attachment:{items:[{name:"one.jpg",type:"image/jpeg",size:12,path:"one",thumbnail:"preview"},{name:"two.jpg",type:"image/jpeg",size:15,path:"two"}]} as any},options);
 expect(message?.album).toHaveLength(2);expect(message?.album?.map(item=>item.path)).toEqual(["one","two"]);expect(message?.album?.[0].thumbnail).toBe("preview");expect(message?.attachment).toBeUndefined();
});
it("does not hide an acknowledged attachment if URL signing has a network error",async()=>{
 sign.mockRejectedValue(new Error("Failed to fetch"));
 const message=await mapMessageRow({...base,attachment:{name:"file.pdf",type:"application/pdf",size:12,path:"path"}},options);
 expect(message?.attachment?.path).toBe("path");expect(message?.attachment?.data).toBe("");
});
it("never signs or exposes a deleted attachment",async()=>{
 const message=await mapMessageRow({...base,deleted_at:"2026-11-05T13:00:00Z",attachment:{name:"private",path:"private-path"}},options);
 expect(sign).not.toHaveBeenCalled();expect(message?.album).toBeUndefined();expect(message?.attachment).toBeUndefined();
});
