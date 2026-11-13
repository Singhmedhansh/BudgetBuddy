# Sign-in providers: Google, GitHub and magic links

FinTrack uses Supabase Auth for every sign-in method. The app **detects which providers are enabled** (it reads the
public `/auth/v1/settings` endpoint of your Supabase project) and shows a button only for those that are. Until you
configure a provider, its button simply does not appear and email and password keeps working.

Nothing in the code contains an OAuth client ID or secret. You create them with Google and GitHub and paste them into
the Supabase Dashboard.

Project: `glgpgmptugomfxoteyys` (ap-south-1). This project is shared with HireCheck, so read **Shared project notes**
at the end before switching anything on.

## 1. URLs you will need

| What | Value |
| --- | --- |
| Supabase OAuth callback (give this to Google and GitHub) | `https://glgpgmptugomfxoteyys.supabase.co/auth/v1/callback` |
| App callback (already built, used after Supabase finishes) | `http://localhost:3100/auth/callback` |
| Redirect allow-list entry for local development | `http://localhost:3100/**` |
| Redirect allow-list entry for production | add your real domain, for example `https://yourdomain.com/**`, only once it exists |

Set the allow-list in **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**. Without the local
entry, Supabase refuses to send the browser back to the app after sign-in, and magic links and email-change links
fail. Do not add a production URL until the domain is real.

`NEXT_PUBLIC_SITE_URL` (in `.env.local`) should match the origin the app is served from. It is used for the links in
emails.

## 2. Google

1. Open the Google Cloud Console and choose or create a project.
2. **APIs & Services → OAuth consent screen**: set the app name, a support email and your developer contact. For
   testing, leave it in Testing mode and add your own Google account as a test user.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
4. Under **Authorized redirect URIs** add `https://glgpgmptugomfxoteyys.supabase.co/auth/v1/callback`.
5. Copy the **Client ID** and **Client secret**.
6. In Supabase: **Authentication → Sign In / Providers → Google**. Turn it on and paste the two values. Save.

## 3. GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Homepage URL: `http://localhost:3100` for now. Authorization callback URL:
   `https://glgpgmptugomfxoteyys.supabase.co/auth/v1/callback`.
3. Create it, then **Generate a new client secret**. Copy the Client ID and the secret.
4. In Supabase: **Authentication → Sign In / Providers → GitHub**. Turn it on and paste the two values. Save.

GitHub only returns an email address if the person has a verified primary email. When it does not, sign-in fails with
a clear "did not confirm your email address" message in the app.

## 4. Connecting a second sign-in method to an existing account

Settings → Connected accounts uses `linkIdentity`. Supabase needs manual linking switched on for that:
**Authentication → Sign In / Providers → Allow manual linking**. Until it is on, the Connect buttons show
"Connecting accounts is not switched on for this project yet" and nothing else is affected.

The app refuses to disconnect a person's only sign-in method.

## 5. Magic links

Magic links need no provider setup. They use the project's email sending (the Supabase default sender is rate limited,
so configure custom SMTP for anything beyond testing). The link returns through `/auth/callback`, so the redirect
allow-list entry above must be in place. The form always answers "If an account exists for that address, we sent a
link", so it never reveals whether an address is registered. Magic links sign in existing accounts only.

## 6. How to check it works

1. Reload `/login`. The Google and GitHub buttons appear only for providers you switched on.
2. Click one. You should land on the provider, then back on `/app`.
3. Open Settings → Connected accounts. The provider is listed with its email.
4. Try Cancel at the provider's screen. You return to `/login` with "You cancelled the sign-in".

If a button is missing, check the provider toggle in Supabase. The app caches the provider list for five minutes.

## Shared project notes

- The project also serves HireCheck. Enabling Google or GitHub makes those providers available to every app on the
  project, but an app only shows them if it renders a button. HireCheck's existing sign-in is unchanged.
- Supabase links identities that share a **verified** email address automatically. Only enable providers that verify
  email addresses (Google and GitHub both do).
- FinTrack uses its own session cookie name (`sb-budgetbuddy-auth-token`), so a session in HireCheck does not sign
  anyone into FinTrack.
- FinTrack never changes the project's email confirmation setting, email templates or existing triggers.
- Deleting a FinTrack account deletes FinTrack data only. The sign-in identity is shared, so it is removed
  only if you set `BUDGETBUDDY_DELETE_AUTH_USER=true` together with `SUPABASE_SERVICE_ROLE_KEY`, which you should do
  only on a project dedicated to FinTrack.
