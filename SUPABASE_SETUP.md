# Supabase setup

The browser UI uses Supabase Auth for real employee sign-in. Employee accounts and their role, name, and skills are stored in `public.profiles`; passwords are managed by Supabase Auth and are never stored in that table.

## 1. Configure the Supabase project

1. Create a Supabase project and copy its **Project URL** and **publishable key** (or legacy anon key).
2. Put those two public values in `supabase-client.js`. Never put a `service_role` key in browser code or commit one to this repository.
3. Run the **entire contents** of `supabase/schema.sql` in the Supabase SQL Editor. It creates/backfills profiles, shared task assignments, private one-to-one chat tables, employee report/review tables, and the private report-attachment bucket with row-level security. Run the updated script again after pulling schema changes; its policies and bucket setup are safe to re-apply.
4. Create the first administrator in Supabase Authentication > Users (or keep the account you already created). Then run the following SQL with that account's email:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = lower('admin@your-company.com');
   ```

   If the editor reports `UPDATE 0`, verify the Auth email and profile row:

   ```sql
   select id, email, role
   from public.profiles
   where lower(email) = lower('admin@your-company.com');
   ```

   If this query returns no rows, run the full schema script again to backfill users who were created before the profile trigger. If it returns a different email, use that exact Auth email in the role update.

5. Deploy the employee importer Edge Function. Creating the SQL table does not deploy this server function; CSV import will not work until it is deployed:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_ID
   supabase functions deploy import-employees
   ```

   Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions. If running the function locally, set those secrets in the local Supabase environment. The service-role key is server-only.

6. Host this static site on an HTTPS origin and add that origin to Supabase Authentication's allowed redirect/site URLs. Do not open the site using `file://`; ES modules and secure authentication require an HTTP(S) origin.

## 2. Import employee accounts

Sign in as the administrator, choose **Download template**, and fill in one employee per CSV row. The required columns are `email,password,full_name`; `skills` is optional and may contain semicolon-separated skills inside a quoted CSV field.

Passwords must be 12–128 characters. The admin page sends the CSV contents over HTTPS to the authenticated Edge Function, which checks the caller's database role before creating accounts. Supabase Auth handles the password; it is not written to the employee profile table. Share imported temporary passwords with employees through a secure channel and have employees change them after first sign-in.

Imports support up to 100 rows and report results per account. Employees sign in at `login.html` with the imported email and password.

## Chats and report reviews

- Chats are private, direct conversations between two signed-in workspace members. The app uses `public.workspace_directory()` to populate chat recipients; database RLS restricts each conversation and its messages to those two participants.
- Employees can submit reports with an optional PDF, image, text/CSV, Word, or Excel attachment up to **3 MiB (3,145,728 bytes)**. When a report is linked to a task, the employee submits a completion percentage with the update; the task is marked **In progress** below 100% and **Completed** at 100%. Task progress and the report are saved together. The attachment bucket is private; employees can access their own files, and admins can access files attached to reports they review.
- Admins use **Report reviews** to approve a report or request changes and leave an optional review note. Employees see pending, approved, or rejected status and any review note on their dashboard and report history.
- Task assignments and employee task-status changes are stored in Supabase and shared across devices. The first admin sign-in after adding this schema imports the tasks from that admin browser's existing local workspace when the shared task table is empty.
- If these features were already loaded in a browser before the schema update, run the updated schema script in the Supabase SQL Editor, then reload the site and sign in again. Existing browser-only messages/reports are not automatically imported into the new database.

## Important security boundary

The web pages redirect users based on their Supabase profile, and the importer verifies admin role on the server. The database also enforces task, report, and chat permissions with row-level security. Activities and other non-task prototype workspace data may still use browser `localStorage`; never put the Supabase service-role key in the static site. Delete plaintext employee-import CSVs after importing and rotate temporary passwords shared in those files.
