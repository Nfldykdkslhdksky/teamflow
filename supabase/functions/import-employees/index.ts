import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

type EmployeeImport = {
  email: string;
  password: string;
  full_name: string;
  skills?: string[];
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return jsonResponse({ error: "Sign in as an administrator before importing accounts." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Account import is not configured on the server." }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return jsonResponse({ error: "Your sign-in has expired. Sign in again." }, 401);

  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) return jsonResponse({ error: "Couldn't verify administrator permissions." }, 500);
  if (profile?.role !== "admin") return jsonResponse({ error: "Only administrators can import employee accounts." }, 403);

  let body: { employees?: EmployeeImport[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }
  if (!Array.isArray(body.employees) || body.employees.length < 1 || body.employees.length > 100) {
    return jsonResponse({ error: "Import between 1 and 100 employee accounts at a time." }, 400);
  }

  const seen = new Set<string>();
  for (const [index, employee] of body.employees.entries()) {
    const email = typeof employee.email === "string" ? employee.email.trim().toLowerCase() : "";
    const fullName = typeof employee.full_name === "string" ? employee.full_name.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: `Row ${index + 1}: enter a valid email address.` }, 400);
    }
    if (!fullName || fullName.length > 120) {
      return jsonResponse({ error: `Row ${index + 1}: name is required and must be under 120 characters.` }, 400);
    }
    if (typeof employee.password !== "string" || employee.password.length < 12 || employee.password.length > 128) {
      return jsonResponse({ error: `Row ${index + 1}: password must be between 12 and 128 characters.` }, 400);
    }
    if (seen.has(email)) return jsonResponse({ error: `Row ${index + 1}: duplicate email ${email}.` }, 400);
    seen.add(email);
    if (employee.skills !== undefined && (!Array.isArray(employee.skills) || employee.skills.some((skill) => typeof skill !== "string" || skill.length > 80))) {
      return jsonResponse({ error: `Row ${index + 1}: skills must be a list of short text values.` }, 400);
    }
  }

  const results: Array<{ email: string; success: boolean; message: string }> = [];
  for (const employee of body.employees) {
    const email = employee.email.trim().toLowerCase();
    const fullName = employee.full_name.trim();
    const skills = [...new Set((employee.skills || []).map((skill) => skill.trim()).filter(Boolean))];
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: employee.password,
      email_confirm: true,
      user_metadata: { full_name: fullName, skills }
    });
    if (createError || !created.user) {
      results.push({ email, success: false, message: createError?.message || "Account creation failed." });
      continue;
    }

    const { error: upsertError } = await admin.from("profiles").upsert({
      id: created.user.id,
      email,
      full_name: fullName,
      role: "employee",
      skills
    });
    if (upsertError) {
      await admin.auth.admin.deleteUser(created.user.id);
      results.push({ email, success: false, message: "Profile creation failed; the Auth user was removed." });
      continue;
    }
    results.push({ email, success: true, message: "Account created. Share the temporary password securely." });
  }
  return jsonResponse({ results });
});
