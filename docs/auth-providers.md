# Sign-in providers: Google, Apple, X, GitHub, phone and magic links

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
| Local app callback | `http://localhost:3100/auth/callback` |
| Official app callback | `https://getfintrack.online/auth/callback` |
| Redirect allow-list entry for local development | `http://localhost:3100/**` |
| Redirect allow-list entry for the official domain | `https://getfintrack.online/**` (not yet added) |

Set the allow-list in **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**. Without the local
entry, Supabase refuses to send the browser back to the app after sign-in, and magic links and email-change links
fail. The official domain now exists, but its redirect entry has not been added because Supabase settings were not
authorized to change as part of domain setup.

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
2. Homepage URL: `https://getfintrack.online`. Authorization callback URL:
   `https://glgpgmptugomfxoteyys.supabase.co/auth/v1/callback`.
3. Create it, then **Generate a new client secret**. Copy the Client ID and the secret.
4. In Supabase: **Authentication → Sign In / Providers → GitHub**. Turn it on and paste the two values. Save.

GitHub only returns an email address if the person has a verified primary email. When it does not, sign-in fails with
a clear "did not confirm your email address" message in the app.

## 3b. Apple

Apple needs a paid Apple Developer account. Supabase uses "Sign in with Apple" for the web.

1. Apple Developer → **Certificates, Identifiers & Profiles → Identifiers**. Create an **App ID** with *Sign in with Apple* on,
   then a **Services ID** (this is the client ID). In the Services ID, enable *Sign in with Apple* and set the website
   domain to `glgpgmptugomfxoteyys.supabase.co` and the return URL to
   `https://glgpgmptugomfxoteyys.supabase.co/auth/v1/callback`.
2. Create a **Key** with *Sign in with Apple* on and download the `.p8` file. Note the Key ID and your Team ID.
3. Apple does not give a static secret: the client secret is a signed token built from the key, and it **expires after at
   most six months**. Generate it (Supabase's docs link a small generator) and paste it into Supabase.
4. In Supabase: **Authentication → Sign In / Providers → Apple**. Turn it on, paste the Services ID and the secret. Save.

Put a reminder in your calendar to regenerate the secret before it expires, or Apple sign-in stops working. Apple lets
people hide their email behind a relay address; FinTrack accepts it.

## 3c. X (Twitter)

1. [developer.x.com](https://developer.x.com) → create a Project and an App. Under **User authentication settings** turn on
   **OAuth 2.0**, type *Web App*, and set the callback URL to
   `https://glgpgmptugomfxoteyys.supabase.co/auth/v1/callback`. Request the scopes `users.read` and `tweet.read`
   (Supabase asks for what it needs).
2. Copy the OAuth 2.0 **Client ID** and **Client Secret**.
3. In Supabase: **Authentication → Sign In / Providers → X / Twitter (OAuth 2.0)**. Turn it on and paste both. Save.

Use the entry named **X / Twitter (OAuth 2.0)**, not the one marked *Deprecated*. FinTrack's button uses Supabase's `x`
provider. X does not always share an email address; when it does not, sign-in fails with the app's "did not confirm your
email address" message rather than creating an account with no email.

## 3d. Phone (text-message code)

Phone sign-in sends a six-digit code by SMS. Supabase does not send texts itself: it needs an SMS provider.

1. Supabase: **Authentication → Sign In / Providers → Phone**. Turn it on and choose a provider (Twilio, Twilio Verify,
   MessageBird or Vonage). Paste its credentials.
2. For India, SMS delivery needs **DLT registration** (a registered sender ID and message template) with the carrier or your
   SMS provider; without it, messages to Indian numbers are often blocked. This is a provider and regulatory step outside
   the app.
3. Set the OTP length to 6 and the expiry to a few minutes.

FinTrack's behaviour: a number can be typed with or without spaces; a bare 10-digit Indian mobile number gets `+91`. On
**sign-in**, a number with no account gets no code and the page says the same thing as for a number that does have one, so
it never reveals which numbers are registered. On **sign-up**, a new number creates an account. SMS costs money per message
and Supabase's rate limits apply; the app shows "Too many attempts" when they trip.

If the SMS provider is misconfigured, the page says "Phone sign-in is not available right now" and shows no provider
detail.

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

1. Reload `/login`. The Google, Apple, X and GitHub buttons and the phone option appear only for what you switched on.
2. Click one. You should land on the provider, then back on `/app`.
3. Open Settings → Connected accounts. The provider is listed with its email.
4. Try Cancel at the provider's screen. You return to `/login` with "You cancelled the sign-in".

If a button is missing, check the provider toggle in Supabase. The app caches the provider list for five minutes.

## Shared project notes

- The project also serves HireCheck. Enabling Google or GitHub makes those providers available to every app on the
  project, but an app only shows them if it renders a button. HireCheck's existing sign-in is unchanged.
- Supabase links identities that share a **verified** email address automatically. Only enable providers that verify
  email addresses (Google, Apple and GitHub do; X and phone may not
  provide an email at all, so signing in with one of them can create a separate account from an email-based one. Settings →
  Connected accounts lets a person link methods deliberately).
- FinTrack uses its own session cookie name (`sb-budgetbuddy-auth-token`), so a session in HireCheck does not sign
  anyone into FinTrack.
- FinTrack never changes the project's email confirmation setting, email templates or existing triggers.
- Deleting a FinTrack account deletes FinTrack data only. The sign-in identity is shared, so it is removed
  only if you set `BUDGETBUDDY_DELETE_AUTH_USER=true` together with `SUPABASE_SERVICE_ROLE_KEY`, which you should do
  only on a project dedicated to FinTrack.
