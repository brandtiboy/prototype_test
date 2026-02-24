/*!
 * PrototypeTester.js v2
 * Goal-based user testing overlay for HTML prototypes.
 *
 * Key concepts:
 *  - Tasks with `goalEvent` auto-detect completion when the prototype fires that DOM event
 *  - Tasks without `goalEvent` show a manual "Mark as done" button
 *  - Skipping a task marks it as failed and records it in results
 *  - The prototype can also call `PrototypeTester.taskCompleted()` directly
 *
 * Usage:
 *   <script src="prototype-tester.js"></script>
 *   <script>
 *     PrototypeTester.init({
 *       projectName: 'My App',
 *       tasks: [
 *         {
 *           id: 'add-participant',
 *           title: 'Add a participant',
 *           description: 'A new booking just came in. Add them to the list.',
 *           hint: 'Look for a button near the participants list.',
 *           goalEvent: 'participant-added',   // <-- fires when goal is reached
 *         },
 *         {
 *           id: 'check-something',
 *           title: 'Find the total',
 *           description: 'How many tickets have been paid?',
 *           // no goalEvent → shows "Mark as done" button
 *         },
 *       ],
 *       // Option A — Supabase (recommended)
 *       supabaseUrl:      'https://xxxx.supabase.co',
 *       supabaseAnonKey:  'eyJhbGciOiJIUzI1NiIs...',
 *       downloadResults:  false,   // turn off JSON download once Supabase is set up
 *       // Option B — Google Sheets webhook
 *       // webhookUrl: 'https://script.google.com/macros/s/xxx/exec',
 *     });
 *   </script>
 *
 * In your prototype, fire the goal event like this:
 *   document.dispatchEvent(new CustomEvent('participant-added'));
 * Or call directly:
 *   PrototypeTester.taskCompleted();
 */
(function (global) {
  'use strict';

  const PT = {

    // ─── Config ──────────────────────────────────────────────────────────────

    _cfg: {
      projectName:        'Prototype Test',
      tasks:              [],
      webhookUrl:         null,          // Google Sheets Apps Script URL
      supabaseUrl:        null,          // https://xxxx.supabase.co
      supabaseAnonKey:    null,          // Supabase anon/public key
      collectTesterInfo:  true,
      allowSkip:          true,
      primaryColor:       '#6366f1',
      downloadResults:    true,          // auto-set to false if supabaseUrl is provided
    },

    // ─── State ───────────────────────────────────────────────────────────────

    _s: {
      sessionId:      null,
      testerName:     '',
      testerEmail:    '',
      sessionStart:   null,
      currentTask:    0,
      taskStart:      null,
      clicks:         [],
      taskResults:    [],
      goalListener:   null,   // { event, fn }
      timerIv:        null,
      recallIv:       null,   // countdown interval for recall tasks
      recallActive:   false,  // true while recall countdown is running
      hintOpen:       false,
      skipState:      false,  // true = showing skip confirm
      goalFired:      false,  // guard against double-fire
    },

    // ─── Public API ──────────────────────────────────────────────────────────

    init(config) {
      Object.assign(PT._cfg, config);
      PT._s.sessionId    = PT._uid();
      PT._s.sessionStart = Date.now();
      PT._css();
      PT._buildShell();
      PT._trackClicks();
      PT._showWelcome();
    },

    /** Call this from prototype code to signal goal achieved */
    taskCompleted() {
      if (PT._s.taskStart && !PT._s.goalFired) PT._goalReached();
    },

    // ─── Utilities ───────────────────────────────────────────────────────────

    _uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    _fmt(ms) {
      const s = Math.floor(ms / 1000);
      return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
    },
    _esc(str) {
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    // ─── CSS ─────────────────────────────────────────────────────────────────

    _css() {
      const c = PT._cfg.primaryColor;
      const sheet = `
        /* ── Reset ── */
        #_pt-prog, #_pt-bar, #_pt-back { * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; } }

        /* ── Progress bar ── */
        #_pt-prog { position:fixed; top:0; left:0; right:0; height:3px; z-index:2147483647; background:rgba(255,255,255,.06); pointer-events:none; }
        #_pt-prog-fill { height:100%; background:${c}; transition:width .5s ease; width:0%; }

        /* ── Bottom bar ── */
        #_pt-bar {
          position:fixed; bottom:0; left:0; right:0; z-index:2147483646;
          background:#18181b; color:#fff;
          display:flex; flex-direction:column;
          box-shadow: 0 -2px 24px rgba(0,0,0,.22);
        }
        #_pt-bar-main {
          display:flex; align-items:center; gap:14px;
          padding:11px 20px; min-height:58px;
        }

        /* Badge */
        #_pt-badge {
          background:${c}; color:#fff;
          border-radius:20px; padding:3px 11px;
          font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
          white-space:nowrap; flex-shrink:0;
        }

        /* Task info */
        #_pt-info { flex:1; min-width:0; }
        #_pt-title { font-size:14px; font-weight:600; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        #_pt-desc  { font-size:12px; color:#a1a1aa; margin-top:2px; line-height:1.4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

        /* Hint button */
        #_pt-hint-btn {
          display:none;
          align-items:center; gap:5px;
          background:rgba(255,255,255,.08); border:none; border-radius:8px;
          padding:6px 11px; color:#a1a1aa; font-size:12px; font-weight:600;
          cursor:pointer; white-space:nowrap; flex-shrink:0; transition:background .1s,color .1s;
        }
        #_pt-hint-btn:hover  { background:rgba(255,255,255,.14); color:#fff; }
        #_pt-hint-btn.active { background:rgba(255,255,255,.12); color:#fff; }

        /* Hint row (below main row) */
        #_pt-hint-row {
          display:none; align-items:flex-start; gap:10px;
          padding:0 20px 12px; animation:_pt-hint-in .18s ease;
        }
        #_pt-hint-row.open { display:flex; }
        @keyframes _pt-hint-in { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
        #_pt-hint-text {
          font-size:13px; color:#d4d4d8; line-height:1.55;
          background:rgba(255,255,255,.05); border-radius:8px;
          padding:9px 13px; flex:1;
        }

        /* Timer */
        #_pt-timer { font-size:12px; color:#52525b; font-variant-numeric:tabular-nums; white-space:nowrap; flex-shrink:0; }

        /* Right-side controls */
        #_pt-controls { display:flex; align-items:center; gap:8px; flex-shrink:0; }

        /* Done button (shown for tasks without goalEvent) */
        #_pt-done-btn {
          display:none;
          align-items:center; gap:7px;
          background:${c}; color:#fff; border:none; border-radius:9px;
          padding:8px 16px; font-size:13px; font-weight:600;
          cursor:pointer; font-family:inherit; white-space:nowrap; transition:filter .15s;
        }
        #_pt-done-btn:hover { filter:brightness(1.1); }
        #_pt-done-btn.visible { display:flex; }

        /* Skip button */
        #_pt-skip-btn {
          background:rgba(255,255,255,.07); border:none; border-radius:9px;
          padding:8px 15px; color:#71717a; font-size:13px; font-weight:600;
          cursor:pointer; font-family:inherit; white-space:nowrap; transition:background .1s,color .1s;
        }
        #_pt-skip-btn:hover { background:rgba(255,255,255,.12); color:#a1a1aa; }

        /* Skip confirm (replaces controls) */
        #_pt-skip-confirm {
          display:none; align-items:center; gap:8px;
        }
        #_pt-skip-confirm.open { display:flex; }
        #_pt-skip-confirm > span { font-size:13px; color:#71717a; white-space:nowrap; }
        #_pt-skip-yes {
          background:rgba(239,68,68,.15); border:none; border-radius:9px;
          padding:8px 15px; color:#fca5a5; font-size:13px; font-weight:600;
          cursor:pointer; font-family:inherit; transition:background .1s;
        }
        #_pt-skip-yes:hover { background:rgba(239,68,68,.28); }
        #_pt-skip-no {
          background:${c}; border:none; border-radius:9px;
          padding:8px 15px; color:#fff; font-size:13px; font-weight:600;
          cursor:pointer; font-family:inherit; transition:filter .1s;
        }
        #_pt-skip-no:hover { filter:brightness(1.12); }

        /* ── Modal backdrop ── */
        #_pt-back {
          position:fixed; inset:0; z-index:2147483645;
          background:rgba(0,0,0,.52); backdrop-filter:blur(7px);
          display:flex; align-items:center; justify-content:center;
        }
        #_pt-modal {
          background:#fff; border-radius:22px; padding:38px;
          max-width:500px; width:calc(100% - 40px);
          box-shadow:0 32px 80px rgba(0,0,0,.25);
          animation:_pt-pop .22s cubic-bezier(.34,1.3,.64,1);
        }
        @keyframes _pt-pop {
          from { opacity:0; transform:scale(.91) translateY(12px); }
          to   { opacity:1; transform:scale(1) translateY(0); }
        }
        #_pt-modal h2 { margin:0 0 8px; font-size:22px; color:#111; }
        #_pt-modal p  { margin:0 0 20px; font-size:15px; color:#555; line-height:1.65; }
        #_pt-modal label { display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:6px; }
        #_pt-modal input, #_pt-modal textarea {
          width:100%; border:1.5px solid #e5e7eb; border-radius:10px;
          padding:10px 13px; font-size:14px; color:#111;
          margin-bottom:16px; outline:none; font-family:inherit;
          background:#fafafa; transition:border-color .15s;
        }
        #_pt-modal input:focus, #_pt-modal textarea:focus { border-color:${c}; background:#fff; }
        #_pt-modal textarea { resize:vertical; min-height:80px; }

        /* Chip */
        ._pt-chip {
          display:inline-block; border-radius:20px;
          padding:3px 12px; font-size:12px; font-weight:700;
          margin-bottom:14px; letter-spacing:.04em;
        }
        ._pt-chip-green  { background:#dcfce7; color:#15803d; }
        ._pt-chip-blue   { background:#eff6ff; color:#2563eb; }
        ._pt-chip-purple { background:#f5f3ff; color:${c}; }
        ._pt-chip-gray   { background:#f4f4f5; color:#52525b; }

        /* ── Success icon (animated SVG checkmark) ── */
        ._pt-success-wrap { text-align:center; margin-bottom:20px; }
        ._pt-check-svg   { width:72px; height:72px; }

        ._pt-circ {
          stroke-dasharray:166; stroke-dashoffset:166;
          animation:_pt-draw-circ .5s ease .05s forwards;
        }
        ._pt-tick {
          stroke-dasharray:50; stroke-dashoffset:50;
          animation:_pt-draw-tick .3s ease .52s forwards;
        }
        @keyframes _pt-draw-circ { to { stroke-dashoffset:0; } }
        @keyframes _pt-draw-tick { to { stroke-dashoffset:0; } }

        /* ── Star rating ── */
        ._pt-stars  { display:flex; gap:8px; margin-bottom:6px; }
        ._pt-star   { font-size:32px; cursor:pointer; opacity:.18; line-height:1; transition:opacity .12s, transform .1s; }
        ._pt-star:hover { transform:scale(1.2); opacity:.6; }
        ._pt-star.on    { opacity:1; }
        ._pt-star-sub   { display:flex; justify-content:space-between; font-size:11px; color:#9ca3af; margin-bottom:20px; }

        /* ── Modal buttons ── */
        ._pt-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:8px; }
        ._pt-btn {
          border:none; border-radius:10px; padding:11px 22px;
          font-size:14px; font-weight:600; cursor:pointer; font-family:inherit;
          transition:filter .15s;
        }
        ._pt-btn-primary { background:${c}; color:#fff; }
        ._pt-btn-primary:hover { filter:brightness(1.1); }
        ._pt-btn-ghost { background:#f4f4f5; color:#3f3f46; }
        ._pt-btn-ghost:hover { filter:brightness(.95); }
        ._pt-full { width:100%; justify-content:center; text-align:center; }

        /* ── Skip screen ── */
        ._pt-skip-illo { font-size:48px; text-align:center; margin-bottom:12px; }

        /* ── Thank you ── */
        ._pt-ty { text-align:center; }
        ._pt-ty-illo { font-size:52px; margin-bottom:16px; }

        /* ── Recall task ── */
        #_pt-timer.recall-tick {
          font-size:22px; font-weight:700; color:#fff;
          min-width:2.5ch; text-align:right;
          transition: color .3s;
        }
        #_pt-timer.recall-tick.urgent { color:#f87171; }
        #_pt-badge.recall { background:#f59e0b !important; }
        ._pt-recall-look {
          font-size:13px; color:#fcd34d; font-weight:600;
          background:rgba(245,158,11,.12); border-radius:6px;
          padding:2px 8px; margin-left:6px;
        }
        ._pt-recall-opts { display:flex; flex-direction:column; gap:8px; margin-bottom:16px; }
        ._pt-recall-opt {
          text-align:left; padding:12px 16px; border-radius:10px;
          background:#f9fafb; border:1.5px solid #e5e7eb;
          font-size:15px; font-weight:500; cursor:pointer; font-family:inherit;
          transition:background .12s, border-color .12s;
        }
        ._pt-recall-opt:hover  { background:#eff6ff; border-color:#bfdbfe; }
        ._pt-recall-opt.chosen { background:#eff6ff; border-color:${c}; outline:2px solid ${c}; }
        ._pt-recall-question {
          font-size:18px; font-weight:600; color:#111;
          margin:0 0 20px; line-height:1.45;
        }
      `;
      const el = document.createElement('style');
      el.textContent = sheet;
      document.head.appendChild(el);
    },

    // ─── Shell ───────────────────────────────────────────────────────────────

    _buildShell() {
      // Progress
      const prog = document.createElement('div');
      prog.id = '_pt-prog';
      prog.innerHTML = '<div id="_pt-prog-fill"></div>';
      document.body.appendChild(prog);

      // Bar
      const bar = document.createElement('div');
      bar.id = '_pt-bar';
      bar.style.display = 'none';
      bar.innerHTML = `
        <div id="_pt-bar-main">
          <div id="_pt-badge">Task 1</div>
          <div id="_pt-info">
            <div id="_pt-title"></div>
            <div id="_pt-desc"></div>
          </div>
          <button id="_pt-hint-btn">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6.5" cy="6.5" r="5.5"/><path d="M6.5 9V7.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5M6.5 10.5v.01"/>
            </svg>
            Hint
          </button>
          <span id="_pt-timer"></span>
          <div id="_pt-controls">
            <button id="_pt-done-btn">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="2,7 5.5,10.5 12,4"/>
              </svg>
              Mark as done
            </button>
            <button id="_pt-skip-btn">Skip task</button>
          </div>
          <div id="_pt-skip-confirm">
            <span>Skip this task?</span>
            <button id="_pt-skip-yes">Yes, skip</button>
            <button id="_pt-skip-no">Keep trying</button>
          </div>
        </div>
        <div id="_pt-hint-row">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px">
            <circle cx="7.5" cy="7.5" r="6"/><path d="M7.5 10.5V9c0-.83.67-1.5 1.5-1.5M7.5 6V5.99"/>
          </svg>
          <span id="_pt-hint-text"></span>
        </div>
      `;
      document.body.appendChild(bar);

      // Hint toggle
      document.getElementById('_pt-hint-btn').onclick = () => {
        PT._s.hintOpen = !PT._s.hintOpen;
        document.getElementById('_pt-hint-row').classList.toggle('open', PT._s.hintOpen);
        document.getElementById('_pt-hint-btn').classList.toggle('active', PT._s.hintOpen);
      };

      // Manual done
      document.getElementById('_pt-done-btn').onclick = () => PT._goalReached();

      // Skip: show confirm
      document.getElementById('_pt-skip-btn').onclick = () => {
        PT._s.skipState = true;
        document.getElementById('_pt-controls').style.display = 'none';
        document.getElementById('_pt-skip-confirm').classList.add('open');
      };
      // Skip confirm: cancel
      document.getElementById('_pt-skip-no').onclick = () => {
        PT._s.skipState = false;
        document.getElementById('_pt-controls').style.display = '';
        document.getElementById('_pt-skip-confirm').classList.remove('open');
      };
      // Skip confirm: confirm
      document.getElementById('_pt-skip-yes').onclick = () => PT._doSkip();

      // Live timer (skips updates while a recall countdown is running)
      PT._s.timerIv = setInterval(() => {
        if (PT._s.taskStart && !PT._s.recallActive && !document.getElementById('_pt-back')) {
          document.getElementById('_pt-timer').textContent = PT._fmt(Date.now() - PT._s.taskStart);
        }
      }, 1000);
    },

    // ─── Modal helpers ───────────────────────────────────────────────────────

    _modal(html, cb) {
      PT._closeModal();
      const back = document.createElement('div');
      back.id = '_pt-back';
      back.innerHTML = `<div id="_pt-modal">${html}</div>`;
      document.body.appendChild(back);
      if (cb) cb();
    },

    _closeModal() {
      const el = document.getElementById('_pt-back');
      if (el) el.remove();
    },

    _starsHTML(id) {
      return [1,2,3,4,5].map(n =>
        `<span class="_pt-star" data-id="${id}" data-v="${n}">★</span>`
      ).join('');
    },

    _bindStars(groupId, cb) {
      let rating = 0;
      document.querySelectorAll(`[data-id="${groupId}"]`).forEach(star => {
        star.onclick = () => {
          rating = +star.dataset.v;
          cb(rating);
          document.querySelectorAll(`[data-id="${groupId}"]`).forEach(s =>
            s.classList.toggle('on', +s.dataset.v <= rating)
          );
        };
      });
    },

    // ─── Screens ─────────────────────────────────────────────────────────────

    _showWelcome() {
      document.getElementById('_pt-bar').style.display = 'none';

      const infoFields = PT._cfg.collectTesterInfo ? `
        <label>Your name</label>
        <input id="_pt-wname" type="text" placeholder="Jane Smith" autocomplete="name" />
        <label>Email <span style="font-weight:400;color:#9ca3af">(optional)</span></label>
        <input id="_pt-wemail" type="email" placeholder="jane@example.com" autocomplete="email" />
      ` : '';

      PT._modal(`
        <span class="_pt-chip _pt-chip-purple">User Test</span>
        <h2>${PT._esc(PT._cfg.projectName)}</h2>
        <p>You'll be given tasks to complete using this prototype. Work as naturally as you can — there are no right or wrong answers. We're testing the design, not you.</p>
        ${infoFields}
        <div class="_pt-actions">
          <button class="_pt-btn _pt-btn-primary _pt-full" id="_pt-start-btn">Start testing →</button>
        </div>
      `, () => {
        document.getElementById('_pt-start-btn').onclick = () => {
          if (PT._cfg.collectTesterInfo) {
            PT._s.testerName  = (document.getElementById('_pt-wname').value || '').trim();
            PT._s.testerEmail = (document.getElementById('_pt-wemail').value || '').trim();
          }
          PT._closeModal();
          document.getElementById('_pt-bar').style.display = '';
          PT._startTask(0);
        };
      });
    },

    _startTask(index) {
      const task  = PT._cfg.tasks[index];
      const total = PT._cfg.tasks.length;

      PT._s.currentTask = index;
      PT._s.clicks      = [];
      PT._s.hintOpen    = false;
      PT._s.skipState   = false;
      PT._s.goalFired   = false;
      PT._s.taskStart   = null;
      PT._s.recallActive = false;
      clearInterval(PT._s.recallIv);
      PT._s.recallIv = null;

      // Reset bar UI
      document.getElementById('_pt-controls').style.display = '';
      document.getElementById('_pt-skip-confirm').classList.remove('open');
      document.getElementById('_pt-hint-row').classList.remove('open');
      document.getElementById('_pt-hint-btn').classList.remove('active');
      document.getElementById('_pt-badge').classList.remove('recall');
      const timerEl = document.getElementById('_pt-timer');
      timerEl.textContent = '';
      timerEl.className = '';

      // Recall tasks have their own dedicated flow
      if (task.type === 'recall') {
        PT._startRecallTask(index, task, total);
        return;
      }

      // Progress
      document.getElementById('_pt-prog-fill').style.width = ((index / total) * 100) + '%';

      // Bar content
      document.getElementById('_pt-badge').textContent     = `Task ${index + 1} of ${total}`;
      document.getElementById('_pt-title').textContent     = task.title;
      document.getElementById('_pt-desc').textContent      = task.description;

      // Hint
      if (task.hint) {
        document.getElementById('_pt-hint-btn').style.display = 'flex';
        document.getElementById('_pt-hint-text').textContent  = task.hint;
      } else {
        document.getElementById('_pt-hint-btn').style.display = 'none';
      }

      // Show "Mark as done" only if no goal event (manual tasks)
      const doneBtn = document.getElementById('_pt-done-btn');
      if (task.goalEvent) {
        doneBtn.classList.remove('visible');
      } else {
        doneBtn.classList.add('visible');
      }

      // Register goal listener
      PT._clearGoalListener();
      if (task.goalEvent) {
        const fn = () => { if (!PT._s.goalFired) PT._goalReached(); };
        document.addEventListener(task.goalEvent, fn, { once: true });
        PT._s.goalListener = { event: task.goalEvent, fn };
      }

      // Task intro modal
      PT._modal(`
        <span class="_pt-chip _pt-chip-blue">Task ${index + 1} of ${total}</span>
        <h2>${PT._esc(task.title)}</h2>
        <p>${PT._esc(task.description)}</p>
        ${task.hint ? `<p style="font-size:13px;color:#6b7280;border-left:3px solid #e5e7eb;padding-left:12px;margin-top:-10px;line-height:1.6">💡 ${PT._esc(task.hint)}</p>` : ''}
        <div class="_pt-actions">
          <button class="_pt-btn _pt-btn-primary _pt-full" id="_pt-go-btn">Got it, let's go →</button>
        </div>
      `, () => {
        document.getElementById('_pt-go-btn').onclick = () => {
          PT._s.taskStart = Date.now();
          PT._closeModal();
        };
      });
    },

    // ─── Recall task ─────────────────────────────────────────────────────────

    _startRecallTask(index, task, total) {
      const seconds = Math.round((task.lookDuration || 5000) / 1000);

      // Bar: show task but lock controls (no skip/done during countdown)
      document.getElementById('_pt-badge').textContent = `Task ${index + 1} of ${total}`;
      document.getElementById('_pt-badge').classList.add('recall');
      document.getElementById('_pt-title').textContent = task.title;
      document.getElementById('_pt-desc').textContent  = task.description;
      document.getElementById('_pt-hint-btn').style.display = 'none';
      document.getElementById('_pt-controls').style.display = 'none';

      // Progress bar
      document.getElementById('_pt-prog-fill').style.width = ((index / total) * 100) + '%';

      PT._modal(`
        <span class="_pt-chip _pt-chip-blue">Task ${index + 1} of ${total} — Quick recall</span>
        <h2>${PT._esc(task.title)}</h2>
        <p>You'll have <strong>${seconds} seconds</strong> to look at the page, then we'll ask you one question. Just glance naturally — no tricks.</p>
        <p style="font-size:14px;background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:-8px;color:#111">
          💬 <strong>The question you'll answer:</strong><br/>${PT._esc(task.question)}
        </p>
        <div class="_pt-actions">
          <button class="_pt-btn _pt-btn-primary _pt-full" id="_pt-recall-go">Start ${seconds}s timer →</button>
        </div>
      `, () => {
        document.getElementById('_pt-recall-go').onclick = () => {
          PT._s.taskStart = Date.now();
          PT._closeModal();
          PT._runRecallCountdown(seconds);
        };
      });
    },

    _runRecallCountdown(seconds) {
      let remaining = seconds;
      const timerEl = document.getElementById('_pt-timer');
      const descEl  = document.getElementById('_pt-desc');

      PT._s.recallActive = true;
      timerEl.className  = 'recall-tick';
      timerEl.textContent = `${remaining}s`;
      descEl.innerHTML   = 'Look now — find the answer! <span class="_pt-recall-look">⏱ counting down</span>';

      PT._s.recallIv = setInterval(() => {
        remaining--;
        timerEl.textContent = `${remaining}s`;
        if (remaining <= 2) timerEl.classList.add('urgent');
        if (remaining <= 0) {
          clearInterval(PT._s.recallIv);
          PT._s.recallIv     = null;
          PT._s.recallActive = false;
          timerEl.className  = '';
          timerEl.textContent = '';
          PT._showRecallQuestion();
        }
      }, 1000);
    },

    _showRecallQuestion() {
      const task    = PT._cfg.tasks[PT._s.currentTask];
      const elapsed = Date.now() - PT._s.taskStart;

      const answerHTML = Array.isArray(task.options)
        ? `<div class="_pt-recall-opts">${
            task.options.map((opt, i) =>
              `<button class="_pt-recall-opt" data-opt="${PT._esc(opt)}" id="_pt-opt-${i}">${PT._esc(opt)}</button>`
            ).join('')
          }</div>`
        : `<input id="_pt-recall-ans" type="text" placeholder="Type your answer…" style="margin-bottom:16px" />`;

      PT._modal(`
        <span class="_pt-chip _pt-chip-blue">Quick question</span>
        <p class="_pt-recall-question">${PT._esc(task.question)}</p>
        ${answerHTML}
        <div class="_pt-actions">
          <button class="_pt-btn _pt-btn-primary _pt-full" id="_pt-recall-submit">Submit answer →</button>
        </div>
      `, () => {
        let chosen = '';

        if (Array.isArray(task.options)) {
          document.querySelectorAll('._pt-recall-opt').forEach(btn => {
            btn.onclick = () => {
              chosen = btn.dataset.opt;
              document.querySelectorAll('._pt-recall-opt').forEach(b => b.classList.remove('chosen'));
              btn.classList.add('chosen');
            };
          });
        } else {
          setTimeout(() => document.getElementById('_pt-recall-ans')?.focus(), 60);
        }

        document.getElementById('_pt-recall-submit').onclick = () => {
          const answer = Array.isArray(task.options)
            ? chosen
            : (document.getElementById('_pt-recall-ans').value.trim());
          PT._finishRecall(task, elapsed, answer);
        };
      });
    },

    _finishRecall(task, elapsed, answer) {
      const hasKey   = task.correctAnswer !== undefined;
      const correct  = hasKey
        ? answer.toLowerCase() === String(task.correctAnswer).toLowerCase()
        : null;

      PT._s.taskResults.push({
        taskId:        task.id || `task_${PT._s.currentTask + 1}`,
        taskTitle:     task.title,
        taskType:      'recall',
        completed:     true,
        durationMs:    elapsed,
        durationFmt:   PT._fmt(elapsed),
        easeRating:    null,
        comment:       '',
        recallAnswer:  answer,
        recallCorrect: correct,
        clicks:        PT._s.clicks.slice(),
      });

      // Restore bar for next task
      document.getElementById('_pt-controls').style.display = '';
      document.getElementById('_pt-badge').classList.remove('recall');

      if (hasKey) {
        // Show brief feedback
        PT._modal(`
          <div class="_pt-success-wrap">
            ${correct
              ? `<svg class="_pt-check-svg" viewBox="0 0 52 52" fill="none">
                   <circle class="_pt-circ" cx="26" cy="26" r="24.5" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"/>
                   <path class="_pt-tick" d="M14 26.5l9 9 15-17" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                 </svg>`
              : `<div style="font-size:52px;line-height:1">💡</div>`
            }
          </div>
          <span class="_pt-chip ${correct ? '_pt-chip-green' : '_pt-chip-gray'}">${correct ? 'Correct!' : 'Good effort!'}</span>
          <h2 style="font-size:19px">${correct ? 'Spot on!' : `The answer was: ${PT._esc(String(task.correctAnswer))}`}</h2>
          <p style="color:#6b7280;font-size:14px">Your answer: <em>"${PT._esc(answer || '(blank)')}"</em></p>
          <div class="_pt-actions">
            <button class="_pt-btn _pt-btn-primary _pt-full" id="_pt-recall-next">
              ${PT._s.currentTask + 1 < PT._cfg.tasks.length ? 'Next task →' : 'Finish & give feedback →'}
            </button>
          </div>
        `, () => {
          document.getElementById('_pt-recall-next').onclick = () => {
            PT._closeModal();
            PT._advance();
          };
        });
      } else {
        PT._closeModal();
        PT._advance();
      }
    },

    // ─── Goal reached (auto or manual) ───────────────────────────────────────

    _goalReached() {
      PT._s.goalFired = true;
      PT._clearGoalListener();

      const elapsed = Date.now() - (PT._s.taskStart || Date.now());
      const task    = PT._cfg.tasks[PT._s.currentTask];
      let   rating  = 0;

      // Small delay so the prototype action visually completes first
      setTimeout(() => {
        PT._modal(`
          <div class="_pt-success-wrap">
            <svg class="_pt-check-svg" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle class="_pt-circ" cx="26" cy="26" r="24.5"
                stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"/>
              <path class="_pt-tick" d="M14 26.5l9 9 15-17"
                stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="_pt-chip _pt-chip-green">Goal achieved! ✓</span>
          <h2>${PT._esc(task.title)}</h2>
          <p>Nice work! How easy was it to complete this task?</p>
          <div class="_pt-stars" style="margin-bottom:6px">${PT._starsHTML('ease')}</div>
          <div class="_pt-star-sub"><span>Very difficult</span><span>Very easy</span></div>
          <label>Any comments? <span style="font-weight:400;color:#9ca3af">(optional)</span></label>
          <textarea id="_pt-ease-comment" placeholder="What worked well? What was confusing?"></textarea>
          <div class="_pt-actions">
            <button class="_pt-btn _pt-btn-primary _pt-full" id="_pt-success-next">
              ${PT._s.currentTask + 1 < PT._cfg.tasks.length ? 'Next task →' : 'Finish & give feedback →'}
            </button>
          </div>
        `, () => {
          PT._bindStars('ease', v => { rating = v; });
          document.getElementById('_pt-success-next').onclick = () => {
            PT._record(task, true, elapsed, rating,
              document.getElementById('_pt-ease-comment').value.trim());
            PT._closeModal();
            PT._advance();
          };
        });
      }, 300);
    },

    // ─── Skip ────────────────────────────────────────────────────────────────

    _doSkip() {
      const elapsed = Date.now() - (PT._s.taskStart || Date.now());
      const task    = PT._cfg.tasks[PT._s.currentTask];
      PT._clearGoalListener();

      PT._modal(`
        <div class="_pt-skip-illo">⏭</div>
        <span class="_pt-chip _pt-chip-gray">Task skipped</span>
        <h2>${PT._esc(task.title)}</h2>
        <p>No worries — skipping helps us understand where the design needs work. What made this task difficult?</p>
        <label>Comments <span style="font-weight:400;color:#9ca3af">(optional)</span></label>
        <textarea id="_pt-skip-comment" placeholder="What was unclear or hard to find?"></textarea>
        <div class="_pt-actions">
          <button class="_pt-btn _pt-btn-ghost _pt-full" id="_pt-skip-next-btn">
            ${PT._s.currentTask + 1 < PT._cfg.tasks.length ? 'Next task →' : 'Finish & give feedback →'}
          </button>
        </div>
      `, () => {
        document.getElementById('_pt-skip-next-btn').onclick = () => {
          PT._record(task, false, elapsed, 0,
            document.getElementById('_pt-skip-comment').value.trim());
          PT._closeModal();
          PT._advance();
        };
      });
    },

    // ─── Final feedback ───────────────────────────────────────────────────────

    _showFinal() {
      document.getElementById('_pt-prog-fill').style.width = '100%';
      document.getElementById('_pt-bar').style.display = 'none';
      let overall = 0;

      PT._modal(`
        <span class="_pt-chip _pt-chip-purple">Almost done 🎉</span>
        <h2>One last thing</h2>
        <p>Overall, how would you rate your experience with this prototype?</p>
        <div class="_pt-stars" style="margin-bottom:6px">${PT._starsHTML('overall')}</div>
        <div class="_pt-star-sub"><span>Very poor</span><span>Excellent</span></div>
        <label>Final thoughts? <span style="font-weight:400;color:#9ca3af">(optional)</span></label>
        <textarea id="_pt-final-comment" placeholder="Overall impressions, suggestions, anything you noticed…"></textarea>
        <div class="_pt-actions">
          <button class="_pt-btn _pt-btn-primary _pt-full" id="_pt-submit-btn">Submit feedback</button>
        </div>
      `, () => {
        PT._bindStars('overall', v => { overall = v; });
        document.getElementById('_pt-submit-btn').onclick = () => {
          PT._submit({
            overallRating:  overall,
            overallComment: document.getElementById('_pt-final-comment').value.trim(),
          });
        };
      });
    },

    // ─── Record + advance ─────────────────────────────────────────────────────

    _record(task, completed, elapsed, rating, comment) {
      PT._s.taskResults.push({
        taskId:      task.id || `task_${PT._s.currentTask + 1}`,
        taskTitle:   task.title,
        completed,
        durationMs:  elapsed,
        durationFmt: PT._fmt(elapsed),
        easeRating:  rating,
        comment,
        clicks:      PT._s.clicks.slice(),
      });
    },

    _advance() {
      const next = PT._s.currentTask + 1;
      if (next < PT._cfg.tasks.length) {
        PT._startTask(next);
      } else {
        PT._showFinal();
      }
    },

    // ─── Submit ───────────────────────────────────────────────────────────────

    _submit(final) {
      const payload = {
        sessionId:          PT._s.sessionId,
        projectName:        PT._cfg.projectName,
        testerName:         PT._s.testerName,
        testerEmail:        PT._s.testerEmail,
        submittedAt:        new Date().toISOString(),
        sessionDurationMs:  Date.now() - PT._s.sessionStart,
        sessionDurationFmt: PT._fmt(Date.now() - PT._s.sessionStart),
        overallRating:      final.overallRating,
        overallComment:     final.overallComment,
        completedTasks:     PT._s.taskResults.filter(t => t.completed).length,
        totalTasks:         PT._cfg.tasks.length,
        tasks:              PT._s.taskResults,
      };

      // ── Supabase ──────────────────────────────────────────────────────────
      if (PT._cfg.supabaseUrl && PT._cfg.supabaseAnonKey) {
        const row = {
          session_id:           payload.sessionId,
          project_name:         payload.projectName,
          tester_name:          payload.testerName   || null,
          tester_email:         payload.testerEmail  || null,
          submitted_at:         payload.submittedAt,
          session_duration_fmt: payload.sessionDurationFmt,
          overall_rating:       payload.overallRating  || null,
          overall_comment:      payload.overallComment || null,
          completed_tasks:      payload.completedTasks,
          total_tasks:          payload.totalTasks,
          tasks:                payload.tasks,
        };
        fetch(`${PT._cfg.supabaseUrl}/rest/v1/test_sessions`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        PT._cfg.supabaseAnonKey,
            'Authorization': `Bearer ${PT._cfg.supabaseAnonKey}`,
            'Prefer':        'return=minimal',
          },
          body: JSON.stringify(row),
        }).catch(e => console.warn('[PrototypeTester] Supabase error:', e));
      }

      // ── Google Sheets webhook (legacy / alternative) ──────────────────────
      if (PT._cfg.webhookUrl) {
        fetch(PT._cfg.webhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        }).catch(e => console.warn('[PrototypeTester] Webhook error:', e));
      }

      // ── JSON download (useful for local testing; off by default if Supabase set) ──
      const shouldDownload = PT._cfg.downloadResults === true ||
        (PT._cfg.downloadResults !== false && !PT._cfg.supabaseUrl);
      if (shouldDownload) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), {
          href: url, download: `pt-session-${payload.sessionId}.json`,
        }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      PT._modal(`
        <div class="_pt-ty">
          <div class="_pt-ty-illo">🙏</div>
          <h2>Thank you!</h2>
          <p>Your feedback has been recorded. You can close this tab whenever you're ready.</p>
          <p style="font-size:12px;color:#9ca3af;margin-top:-8px">
            ${payload.completedTasks}/${payload.totalTasks} tasks completed &nbsp;·&nbsp; Session ${payload.sessionId}
          </p>
        </div>
      `);
    },

    // ─── Click tracking ───────────────────────────────────────────────────────

    _trackClicks() {
      document.addEventListener('click', e => {
        if (e.target.closest('#_pt-bar') || e.target.closest('#_pt-back')) return;
        if (!PT._s.taskStart) return;
        const t = e.target;
        PT._s.clicks.push({
          t:   Date.now() - PT._s.taskStart,
          x:   Math.round(e.clientX),
          y:   Math.round(e.clientY),
          tag: t.tagName.toLowerCase(),
          id:  t.id || null,
          txt: (t.innerText || t.value || '').slice(0, 60).trim(),
        });
      }, true);
    },

    _clearGoalListener() {
      if (PT._s.goalListener) {
        document.removeEventListener(PT._s.goalListener.event, PT._s.goalListener.fn);
        PT._s.goalListener = null;
      }
    },
  };

  global.PrototypeTester = PT;
})(window);
