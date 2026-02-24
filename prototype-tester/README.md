# PrototypeTester — Full Workflow Guide

A lightweight Maze-style testing layer for HTML prototypes.
Drop in one `<script>` tag, define tasks, deploy, collect data in Supabase, view results.

---

## The full workflow at a glance

```
Figma design
    ↓  build prototype in Claude Code
HTML prototype
    ↓  add PrototypeTester.init({...}) with your tasks
Test-ready prototype
    ↓  run ./deploy.sh
Live Vercel URL  ←── share with testers
    ↓  testers complete session
Supabase database  ←── results saved automatically
    ↓  open results-dashboard.html
Insights → pick which design to continue
```

---

## Step 1 — Set up Supabase (one-time, ~5 min)

### 1.1 Create a project

1. Go to [supabase.com](https://supabase.com) and sign up (free tier is plenty).
2. Click **New project**, give it a name like `prototype-testing`, choose a region close to you.
3. Wait ~2 minutes for it to provision.

### 1.2 Create the table

Open your project → **SQL Editor** → **New query**, paste and run:

```sql
-- Create the table that stores every test session
create table if not exists public.test_sessions (
  id                   uuid        primary key default gen_random_uuid(),
  session_id           text        not null,
  project_name         text        not null,
  tester_name          text,
  tester_email         text,
  submitted_at         timestamptz not null,
  session_duration_fmt text,
  overall_rating       integer,
  overall_comment      text,
  completed_tasks      integer,
  total_tasks          integer,
  tasks                jsonb       not null default '[]'::jsonb,
  created_at           timestamptz default now()
);

-- Allow anyone with the anon key to INSERT (testers submit results)
alter table public.test_sessions enable row level security;

create policy "Testers can insert sessions"
  on public.test_sessions for insert
  to anon
  with check (true);

-- Allow reading with the anon key (for the results dashboard)
create policy "Anyone can read sessions"
  on public.test_sessions for select
  to anon
  using (true);
```

### 1.3 Get your keys

Go to **Settings → API** in your Supabase dashboard. Copy:
- **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`
- **anon / public key** — starts with `eyJ...`

You'll paste these into every prototype's `PrototypeTester.init()` call.

---

## Step 2 — Add PrototypeTester to a prototype

Paste these lines just before `</body>` in any HTML prototype:

```html
<script src="prototype-tester.js"></script>
<script>
  PrototypeTester.init({
    projectName:     'My App — Flow A',   // shown on welcome screen + in dashboard
    primaryColor:    '#6366f1',           // your brand color

    // ── Supabase ──────────────────────────────────────────────────────────
    supabaseUrl:     'https://xxxx.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIs...',
    downloadResults: false,   // results go to Supabase, not a JSON file on the tester's machine

    // ── Tasks ─────────────────────────────────────────────────────────────
    tasks: [
      {
        id:          'task-1',
        title:       'Find the pricing page',
        description: 'You want to know how much the app costs. Find the pricing information.',
        hint:        'Check the main navigation.',
        // goalEvent: 'pricing-viewed',  ← fire this event in your prototype when the goal is reached
      },
      {
        id:          'task-2',
        title:       'Sign up for a free trial',
        description: 'Create a new free account.',
        goalEvent:   'signup-completed',
      },
    ],
  });
</script>
```

### Task types

**Standard task (manual)** — shows a "Mark as done" button in the bar:
```js
{ id: 'task-1', title: 'Find settings', description: 'Where would you go to change your password?' }
```

**Goal task (auto-detect)** — success dialog fires the moment the user achieves the goal:
```js
{
  id:          'add-item',
  title:       'Add an item',
  description: 'Add a new product to the catalogue.',
  goalEvent:   'item-added',   // fired in your prototype code (see below)
}
```
In your prototype JS, fire the event when the action completes:
```js
document.dispatchEvent(new CustomEvent('item-added'));
```

**Recall task** — timed observation window, then a memory question:
```js
{
  type:          'recall',
  id:            'check-price',
  title:         'What is the price?',
  description:   'Take a look at this product page.',
  question:      'What was the price of the Pro plan?',
  lookDuration:  5000,            // milliseconds to observe (5s)
  options:       ['$9', '$19', '$29', '$49'],
  correctAnswer: '$19',
}
```

---

## Step 3 — Test variants (A/B / multi-flow)

For each design variant, create a separate HTML file with a different `projectName`:

```
prototype-tester/
├── flow-a.html   → projectName: 'Onboarding — Flow A'
├── flow-b.html   → projectName: 'Onboarding — Flow B'
├── flow-c.html   → projectName: 'Onboarding — Flow C'
└── prototype-tester.js
```

All three share the same Supabase database. In the results dashboard you select a project from the sidebar and compare them side by side.

---

## Step 4 — Deploy (automatic, one command)

Make sure [Node.js](https://nodejs.org) is installed, then run:

```bash
./deploy.sh
```

The first time, Vercel will ask you to log in (free account). After that, every deploy takes ~10 seconds and gives you a unique production URL.

The script prints:
```
✅  Deployed!

   Prototype URL         → https://my-project-abc.vercel.app/flow-a.html
   Results dashboard URL → https://my-project-abc.vercel.app/results-dashboard.html
```

Send the **prototype URL** to testers.
Bookmark the **results dashboard URL** for yourself.

### Multiple versions over time

Each `./deploy.sh` creates a new immutable URL. Old links keep working. You can also update the `projectName` to include a date:
```js
projectName: 'Onboarding — Flow A — Feb 2026'
```

---

## Step 5 — View results

Open `results-dashboard.html` in a browser (or use the deployed Vercel URL).

1. Enter your Supabase **Project URL** and **anon key** once.
2. The sidebar shows all your tests grouped by `projectName`.
3. Click a test to see:
   - Avg completion rate, avg overall rating
   - Per-task completion %, avg ease rating, time
   - Every individual session with tester details, click trails, comments

The results dashboard is also deployed to your Vercel URL so you can access it from any device.

---

## Step 6 — Make a decision

Look at the task completion rates and ease ratings across flows A, B, C. Pick the flow with the highest completion on the core tasks. If two flows are close, lean toward the one with better ease ratings or qualitative comments.

---

## Repeatable checklist (copy this for each new test round)

```
BEFORE TESTING

[ ] What flows/designs do I need to compare?
    → One HTML file per flow, different projectName

[ ] What are the user goals I'm testing?
    → Write 2–4 tasks per prototype

[ ] Do any tasks need auto-detection (goalEvent)?
    → Fire document.dispatchEvent(new CustomEvent('...')) in prototype JS

[ ] Any observation/recall tasks? (e.g. "what did you notice on this page?")
    → Use type: 'recall' with lookDuration + options

[ ] Supabase keys added to each prototype?

DEPLOYING

[ ] Run ./deploy.sh from the prototype-tester folder
[ ] Copy the Prototype URL (send to testers)
[ ] Copy the Results Dashboard URL (keep for yourself)

DURING TESTING

[ ] 5–8 testers per flow is usually enough
[ ] Note any verbal comments while they test (timestamp them)

AFTER TESTING

[ ] Open results-dashboard.html → select each flow
[ ] Note: completion %, ease ratings, time-on-task, qualitative comments
[ ] Decide which flow to continue with
[ ] Archive the Supabase data if needed (export as CSV from Supabase Table Editor)
```

---

## All config options

```js
PrototypeTester.init({
  projectName:       'My App',         // shown on welcome screen
  tasks:             [...],            // array of task objects (see above)

  // Results destination (pick one)
  supabaseUrl:       null,             // https://xxxx.supabase.co
  supabaseAnonKey:   null,             // anon/public key from Supabase Settings → API
  webhookUrl:        null,             // Google Sheets Apps Script URL (alternative)
  downloadResults:   true,            // auto-false when supabaseUrl is set; useful for local testing

  // UX
  collectTesterInfo: true,             // ask for name + email at the start
  allowSkip:         true,             // let testers skip a task (recorded as incomplete)
  primaryColor:      '#6366f1',        // accent color for the overlay UI
});
```

---

## Using with a React prototype

```jsx
// Option 1: public/index.html
<script src="%PUBLIC_URL%/prototype-tester.js"></script>

// Option 2: in a component
useEffect(() => {
  window.PrototypeTester.init({ ... });
}, []);
```

---

## Files in this folder

| File | Purpose |
|---|---|
| `prototype-tester.js` | Core library — drop into any prototype |
| `results-dashboard.html` | View & compare test results (connects to Supabase) |
| `deploy.sh` | One-command Vercel deployment |
| `event-management.html` | Example prototype (Figma → Claude Code) |
| `demo-prototype.html` | Simple demo prototype (Taskly SaaS) |
| `README.md` | This guide |
