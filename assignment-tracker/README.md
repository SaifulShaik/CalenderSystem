# Planner

A private planner for your assignments, tasks, daily goals and day schedule, with an AI
assistant that rearranges your schedule when you ask. It installs on your iPhone Home Screen,
opens in any computer browser, and sends push alerts for what is coming up.

Only you can use it: one account, sign-ups turned off.

**Screens:** Today · Schedule · Assignments · Tasks · AI · Settings

**Stack:** plain HTML/JS front end, Supabase (login + database), Vercel (hosting + server
functions), cron-job.org (free timer for alerts), Claude API (the assistant).

Setup takes about 40 minutes. Everything is free except the AI, which is billed per use.

> **Already set up the first version (assignments + alerts only)?** Do only Step 1b, add the two
> new variables in Step 4 (`SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`), then redeploy.

---

## Step 1: Supabase (login + database)

1. Go to https://supabase.com, create a free account, then **New project**. Save the database password.
2. **SQL Editor -> New query**:
   - **1a.** paste all of `supabase.sql` and click **Run**.
   - **1b.** New query again: paste all of `supabase-v2.sql` and click **Run**.
     (Both files are safe to run more than once.)
3. **Authentication -> Users -> Add user -> Create new user**. Enter your email and a strong
   password, and tick **Auto Confirm User**.
4. **Authentication -> Sign In / Providers**: turn **off "Allow new users to sign up"**.
5. **Project Settings -> API**: copy the **Project URL**, the **anon public** key, and the
   **service_role** key (secret: it only ever goes into Vercel, never into a file in this project).

## Step 2: Notification keys

On a computer with Node.js, in this folder:

```
npm install
npx web-push generate-vapid-keys
```

Keep the **public key** and **private key** it prints.

## Step 3: Fill in the front-end config

Open `public/config.js` and replace the three placeholders: Supabase Project URL, anon key,
and the notification **public** key.

## Step 4: Deploy on Vercel

1. Put this folder in a GitHub repository (do not upload `node_modules` or any secrets).
2. https://vercel.com -> sign up with GitHub -> **Add New -> Project** -> pick the repository -> Deploy.
3. **Settings -> Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_ANON_KEY` | the anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service_role key |
   | `VAPID_PUBLIC_KEY` | notification public key |
   | `VAPID_PRIVATE_KEY` | notification private key |
   | `VAPID_SUBJECT` | `mailto:you@example.com` (your email) |
   | `CRON_SECRET` | any long random password you make up |
   | `ANTHROPIC_API_KEY` | your Claude API key (Step 4b) |
   | `ANTHROPIC_MODEL` | optional, see below |

4. **Redeploy** (Deployments -> latest -> Redeploy) so the variables take effect.
   Note your site address, like `https://your-app.vercel.app`.

### Step 4b: Claude API key (for the AI)

1. Create an account at https://console.anthropic.com and add a small amount of credit.
2. **Set a monthly spending limit** there so usage can never surprise you.
3. Create an API key and put it in Vercel as `ANTHROPIC_API_KEY`.

The API is billed separately from a claude.ai plan. The app uses `claude-sonnet-5-5` by default.
To use a different model, set `ANTHROPIC_MODEL` (model names and prices:
https://docs.claude.com). A smaller model costs less and is fine for simple planning.

## Step 5: Turn on the reminder timer

1. Free account at https://cron-job.org.
2. Create a cron job:
   - URL: `https://your-app.vercel.app/api/send-reminders?key=YOUR_CRON_SECRET`
   - Schedule: **every 5 minutes**
3. Open that URL in a browser to test. You should see something like
   `{"assignments":0,"overdue":0,"tasks":0,"blocks":0,"morning":0,"pushes":0}`.

## Step 6: Install on your iPhone

Alerts on iPhone only work when the app is on the Home Screen.

1. Open your site address in **Safari**.
2. **Share -> Add to Home Screen -> Add**.
3. Open the app **from the Home Screen icon**, sign in.
4. Go to **Settings -> Turn on alerts** (or tap Turn on on the Today screen) and allow notifications.

On your computer, open the same address in your browser and sign in.

---

## Using the app

- **Today:** your goals, what is next on your schedule, and what is due in the next 48 hours.
  Tap **Plan my day with AI** for a suggested schedule. Repeating goals appear here automatically.
- **Schedule:** day, week and month calendar. Tap an empty slot to add a block, tap a block to
  edit it, drag to move, drag the bottom edge to resize. **Lock** a block and the AI will never touch it.
- **Assignments:** list and month views, filters, estimated time (the AI uses this to plan).
- **Tasks:** to-dos with a time estimate, priority and deadline. **Schedule** drops one into your day.
  Manage repeating daily goals at the bottom.
- **AI:** type what you want, for example:
  - "Plan my day."
  - "Move my essay to tomorrow morning and add a gym session."
  - "I got sick, spread today over the next three days."
  - "What should I do first?"

  The AI shows its suggested changes as a list. **Nothing changes until you tap Apply**, and every
  applied change has an **Undo** button (also under "Recent AI changes").
  In Settings you can allow it to apply small changes (30 minutes or less) automatically.
- **Settings:** wake/bed times, work and focus hours and break rules (the AI follows these),
  your time zone, reminder timing, alerts for this device, download all your data, sign out.

## Alerts you get

| Alert | When |
|---|---|
| Assignment due soon | 24 hours and 2 hours before (changeable in Settings) |
| Overdue | Shortly after a deadline passes |
| Task deadline | 24 hours before (same setting) |
| Schedule block | 10 minutes before it starts |
| Morning summary | After your wake-up time |

Alerts are as punctual as the 5-minute timer, so expect up to 5 minutes of delay.

## Folder map

```
api/                 server functions (Vercel)
  assistant.js         AI chat
  plan-day.js          one-tap day planner
  apply-changes.js     applies changes you approved
  undo-change.js       reverses an applied change
  send-reminders.js    push alerts (called by cron-job.org)
  _lib/                shared code: login check, time zones, AI tools, prompt
public/              the website
  index.html  style.css  app.js  sw.js  manifest.json  config.js
  js/                  one file per screen (today, schedule, assignments, tasks, ai, settings)
supabase.sql         first database setup
supabase-v2.sql      tasks, goals, schedule, preferences, AI history
```

To change how the AI plans, edit the rules in the system prompt at the top of `api/_lib/ai.js`.
To add a new AI ability, add a tool in `api/_lib/tools.js`.

## Troubleshooting

- **No alerts option on iPhone:** you opened it in Safari instead of from the Home Screen icon.
- **Alerts blocked:** iPhone Settings -> Notifications -> Planner.
- **Login fails:** check the user was created with "Auto Confirm" and that the URL and anon key in
  `public/config.js` are right.
- **AI says "Not signed in" or "Session expired":** sign out and back in.
- **AI says it has no ANTHROPIC_API_KEY:** add it in Vercel and redeploy.
- **AI is slow:** a big reshuffle can take 10 to 30 seconds. Ask for one day at a time.
- **Cron says 401:** the `key=` in the URL must match `CRON_SECRET` exactly.
- **"relation ... does not exist":** you skipped `supabase-v2.sql` (Step 1b).
- **Data looks stale:** the app refreshes when you come back to it; pull the page down or switch tabs.

## Privacy and safety

- Row-level security means every table only returns your own rows.
- The service role key, Claude API key and notification private key live only in Vercel.
- When you use the AI, the schedule data needed for that request is sent to the Claude API.
- The offline copy stores only the app's files, never your data.
