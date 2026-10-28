// Deletes chat-media objects that no message refers to.
//
// Two kinds of orphans accumulate:
//   1. uploads completed without the message row (tab closed mid-send, or the
//      insert failed after the delete raced with it);
//   2. messages removed by their author, which leaves the file behind because
//      row deletion cannot reach into Storage.
//
// The function only ever deletes files older than `MIN_AGE_HOURS`: a younger
// file might belong to an upload that is still in progress and would otherwise
// be destroyed before its message appears.
//
// Invoke with the service role key (a scheduled job), never from the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MIN_AGE_HOURS = 24;
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return Response.json({ error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required" }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const cutoff = new Date(Date.now() - MIN_AGE_HOURS * 3600_000);

  let scanned = 0;
  let removed = 0;
  const failures: { path: string; reason: string }[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data: folders, error: listError } = await supabase.storage
      .from("chat-media")
      .list("", { limit: PAGE_SIZE, offset: page * PAGE_SIZE });

    if (listError) {
      return Response.json({ error: listError.message }, { status: 500 });
    }
    if (!folders || folders.length === 0) break;

    for (const chatFolder of folders) {
      // Objects live under <chatId>/<userId>/<file>; folders show up as entries
      // without an id in some storage versions, so descend only into real dirs.
      const { data: userFolders, error: userFolderError } = await supabase.storage
        .from("chat-media")
        .list(chatFolder.name, { limit: PAGE_SIZE });
      if (userFolderError) {
        failures.push({ path: chatFolder.name, reason: userFolderError.message });
        continue;
      }

      for (const userFolder of userFolders ?? []) {
        const prefix = `${chatFolder.name}/${userFolder.name}`;
        const { data: files, error: fileError } = await supabase.storage
          .from("chat-media")
          .list(prefix, { limit: PAGE_SIZE });
        if (fileError) {
          failures.push({ path: prefix, reason: fileError.message });
          continue;
        }

        for (const file of files ?? []) {
          const path = `${prefix}/${file.name}`;
          scanned += 1;
          const createdAt = file.created_at ? new Date(file.created_at) : null;
          if (!createdAt || createdAt > cutoff) continue;

          const { data: referencing, error: lookupError } = await supabase
            .from("messages")
            .select("id")
            .eq("attachment->>path", path)
            .limit(1);

          if (lookupError) {
            failures.push({ path, reason: lookupError.message });
            continue;
          }
          if (referencing && referencing.length > 0) continue;

          const { error: removeError } = await supabase.storage.from("chat-media").remove([path]);
          if (removeError) failures.push({ path, reason: removeError.message });
          else removed += 1;
        }
      }
    }

    if (folders.length < PAGE_SIZE) break;
  }

  return Response.json({
    scanned,
    removed,
    failures,
    cutoff: cutoff.toISOString(),
    minAgeHours: MIN_AGE_HOURS,
  });
});
