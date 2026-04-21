/**
 * Edge Function: admin-update-user
 * Allows a super-admin to update another user's username and/or password.
 *
 * Deploy:
 *   npx supabase functions deploy admin-update-user --project-ref <your-ref>
 *
 * The function verifies the caller is super-admin (via their JWT),
 * then uses the service role key to update auth.users and profiles.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  // Verify caller identity with the anon client
  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }
  if (caller.user_metadata?.role !== "super-admin") {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  const { userId, username, password } = await req.json() as {
    userId: string;
    username?: string;
    password?: string;
  };

  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Fetch existing user_metadata to preserve role
  const { data: { user: target }, error: fetchErr } = await adminClient.auth.admin.getUserById(userId);
  if (fetchErr || !target) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authUpdates: Record<string, unknown> = {};
  if (password) authUpdates.password = password;
  if (username) {
    authUpdates.email = `${username.toLowerCase()}@cropcomp.internal`;
    authUpdates.user_metadata = { ...target.user_metadata, username };
  }

  if (Object.keys(authUpdates).length > 0) {
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, authUpdates);
    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (username) {
    const { error: profileErr } = await adminClient
      .from("profiles")
      .update({ username })
      .eq("id", userId);
    if (profileErr) {
      return new Response(JSON.stringify({ error: profileErr.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
