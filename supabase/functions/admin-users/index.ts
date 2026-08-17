import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Server configuration is incomplete' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const token = authHeader.replace('Bearer ', '');
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: { user: caller }, error: callerError } = await userClient.auth.getUser();
  if (callerError || !caller) return json({ error: 'Unauthorized' }, 401);

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles').select('id, role').eq('id', caller.id).maybeSingle();
  if (profileError || callerProfile?.role !== 'admin') return json({ error: 'Admin access required' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const action = body?.action;
  const userId = body?.userId;

  if (action === 'create') {
    const { name, username, email, password, role = 'student' } = body;
    if (!name || !username || !email || !password) return json({ error: 'name, username, email and password are required' }, 400);
    if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
    if (!['student', 'admin'].includes(role)) return json({ error: 'Invalid role' }, 400);

    const { data: existingUsername } = await adminClient.from('profiles').select('id').eq('username', String(username).toLowerCase()).maybeSingle();
    if (existingUsername) return json({ error: 'USERNAME_EXISTS' }, 409);

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { username: String(username).toLowerCase(), name, avatar: String(name).trim().charAt(0) },
    });
    if (createError || !created.user) {
      const msg = createError?.message || 'Failed to create user';
      const status = /already|exists|registered/i.test(msg) ? 409 : 400;
      return json({ error: msg }, status);
    }

    const newId = created.user.id;
    const { error: profileUpdateError } = await adminClient.from('profiles').update({
      username: String(username).toLowerCase(), name, email: String(email).trim().toLowerCase(), role,
    }).eq('id', newId);
    if (profileUpdateError) {
      await adminClient.auth.admin.deleteUser(newId);
      return json({ error: `Profile creation failed: ${profileUpdateError.message}` }, 500);
    }

    const { error: roleError } = await adminClient.from('user_roles').upsert({ user_id: newId, role }, { onConflict: 'user_id,role' });
    if (roleError) {
      await adminClient.auth.admin.deleteUser(newId);
      return json({ error: `Role creation failed: ${roleError.message}` }, 500);
    }

    return json({ ok: true, user: { id: newId, name, username: String(username).toLowerCase(), email, role } }, 201);
  }

  if (!userId) return json({ error: 'userId is required' }, 400);

  if (action === 'delete') {
    if (userId === caller.id) return json({ error: 'SELF_DELETE_NOT_ALLOWED' }, 400);

    const { data: target } = await adminClient.from('profiles').select('id, role').eq('id', userId).maybeSingle();
    if (!target) return json({ error: 'USER_NOT_FOUND' }, 404);

    if (target.role === 'admin') {
      const { count } = await adminClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if ((count ?? 0) <= 1) return json({ error: 'LAST_ADMIN' }, 400);
    }

    const { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === 'update') {
    const { name, username, email, password, role } = body;
    const { data: target } = await adminClient.from('profiles').select('id, role').eq('id', userId).maybeSingle();
    if (!target) return json({ error: 'USER_NOT_FOUND' }, 404);

    if (username) {
      const { data: other } = await adminClient.from('profiles').select('id').eq('username', String(username).toLowerCase()).neq('id', userId).maybeSingle();
      if (other) return json({ error: 'USERNAME_EXISTS' }, 409);
    }
    if (role && !['student', 'admin'].includes(role)) return json({ error: 'Invalid role' }, 400);
    if (target.role === 'admin' && role === 'student') {
      const { count } = await adminClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if ((count ?? 0) <= 1) return json({ error: 'LAST_ADMIN' }, 400);
    }

    const authUpdate: any = {};
    if (email) { authUpdate.email = String(email).trim().toLowerCase(); authUpdate.email_confirm = true; }
    if (password) {
      if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
      authUpdate.password = password;
    }
    if (name || username) authUpdate.user_metadata = { name, username: username ? String(username).toLowerCase() : undefined };
    if (Object.keys(authUpdate).length) {
      const { error } = await adminClient.auth.admin.updateUserById(userId, authUpdate);
      if (error) return json({ error: error.message }, 400);
    }

    const profilePatch: any = {};
    if (name) profilePatch.name = name;
    if (username) profilePatch.username = String(username).toLowerCase();
    if (email) profilePatch.email = String(email).trim().toLowerCase();
    if (role) profilePatch.role = role;
    if (Object.keys(profilePatch).length) {
      const { error } = await adminClient.from('profiles').update(profilePatch).eq('id', userId);
      if (error) return json({ error: error.message }, 400);
    }
    if (role) {
      const { error } = await adminClient.from('user_roles').delete().eq('user_id', userId);
      if (error) return json({ error: error.message }, 400);
      const { error: insertRoleError } = await adminClient.from('user_roles').insert({ user_id: userId, role });
      if (insertRoleError) return json({ error: insertRoleError.message }, 400);
    }

    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
