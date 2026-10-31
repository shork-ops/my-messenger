import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const json = (body: unknown, status=200) => Response.json(body,{status,headers});
Deno.serve(async request => {
  if(request.method==='OPTIONS') return new Response('ok',{headers});
  if(request.method!=='POST') return json({error:'Method not allowed'},405);
  const url=Deno.env.get('SUPABASE_URL'), anon=Deno.env.get('SUPABASE_ANON_KEY'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!key) return json({error:'Not configured'},503);
  const caller=createClient(url,anon,{global:{headers:{Authorization:request.headers.get('Authorization')??''}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await caller.auth.getUser();
  if(authError||!identity.user) return json({error:'Authentication required'},401);
  let body: { action?: string; messageId?: string };
  try { body=await request.json(); } catch { return json({error:'Invalid JSON'},400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'Invalid request'},400);
  if(body.action==='ready') {
    const {data,error}=await caller.rpc('view_once_capabilities');
    return error||data!==true ? json({error:'Migration required'},503) : json({ready:true});
  }
  if(!body.messageId||! /^[0-9a-f-]{36}$/i.test(body.messageId)) return json({error:'Invalid message'},400);
  const {data:claim,error}=await caller.rpc('claim_view_once_message',{p_message:body.messageId});
  if(error||!claim?.path) return json({error:error?.code==='P0001'?'already_opened':'unavailable'},error?.code==='P0001'?409:403);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:signed,error:signError}=await admin.storage.from('view-once-media').createSignedUrl(claim.path,10);
  // A failed response consumes this attempt too: no replay can produce a second URL.
  if(signError||!signed?.signedUrl) return json({error:'Media unavailable'},503);
  return json({url:signed.signedUrl,seconds:10});
});
