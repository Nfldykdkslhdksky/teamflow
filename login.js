import { supabase, supabaseConfigured } from "./supabase-client.js";

const form = document.querySelector("#loginForm");
const error = document.querySelector("#loginError");
const passwordInput = document.querySelector("#loginPassword");
const submitButton = form.querySelector('[type="submit"]');
const connectionStatus = document.querySelector("#connectionStatus");

if (!supabaseConfigured) {
  connectionStatus.textContent = "Sign-in isn't configured yet. Add your Supabase project URL and publishable key to supabase-client.js.";
  submitButton.disabled = true;
} else {
  connectionStatus.textContent = "Accounts are securely managed by your workspace administrator.";
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    error.textContent = `Couldn't check your sign-in: ${sessionError.message}`;
  } else if (session) {
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("full_name, role")
      .eq("id", session.user.id)
      .maybeSingle();
    if (profileError) error.textContent = `Couldn't load your account: ${profileError.message}`;
    else if (profile) window.location.replace(profile.role === "admin" ? "admin.html" : "index.html");
  }
}

document.querySelector("#togglePassword").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const isVisible = passwordInput.type === "text";
  passwordInput.type = isVisible ? "password" : "text";
  button.textContent = isVisible ? "Show" : "Hide";
  button.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseConfigured) return;
  error.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "Signing in…";
  const email = document.querySelector("#loginEmail").value.trim().toLowerCase();
  const password = passwordInput.value;
  try {
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("full_name, role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !["admin", "employee"].includes(profile.role)) {
      await supabase.auth.signOut();
      throw new Error("Your account profile is missing. Ask your administrator to import your account again.");
    }
    window.location.assign(profile.role === "admin" ? "admin.html" : "index.html");
  } catch (signInError) {
    error.textContent = signInError.message || "Sign-in failed. Check your email and password.";
    submitButton.disabled = false;
    submitButton.innerHTML = 'Sign in <span>→</span>';
  }
});
