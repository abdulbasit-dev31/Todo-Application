/* TaskFlow Pro - logic | Author: Abdul Basit */
(function () {
  'use strict';
  if (window.__taskflow_initialized) { return; }
  window.__taskflow_initialized = true;

  const $ = id => document.getElementById(id);
  const CATS = { work: '💼 Work', personal: '🏠 Personal', study: '📚 Study', health: '💪 Health', other: '📌 Other' };
  const REPEAT = { daily: 1, weekly: 7, monthly: 0 };
  const KEY = 'taskflow_pro_tasks', PREF = 'taskflow_prefs', THEME = 'taskflow_theme';

  const el = {
    list: $('taskList'), input: $('taskInput'), cat: $('catSelect'), pri: $('prioritySelect'), due: $('dueDateInput'), rep: $('repeatSelect'),
    add: $('addTaskBtn'), search: $('searchInput'), catFilter: $('catFilter'), count: $('taskCount'), alert: $('alertBar'),
    modal: $('editModal'), eText: $('editTaskInput'), eNotes: $('editNotes'), eCat: $('editCat'), ePri: $('editPriority'),
    eDue: $('editDue'), eRep: $('editRepeat'), subList: $('subList'), subInput: $('subInput'),
    tabs: document.querySelectorAll('.tab'), sorts: document.querySelectorAll('.sort')
  };

  let tasks = [], editingId = null, editingSubs = [], dragId = null, undoStack = [];
  let prefs = { filter: 'all', sort: 'date', cat: 'all' };

  /* ---------- helpers ---------- */
  const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const local = s => new Date(s + 'T00:00:00');
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const todayIso = () => iso(new Date());
  const isOverdue = t => !!t.dueDate && !t.completed && t.dueDate < todayIso();
  function fmtDate(s) {
    const d = local(s), t = local(todayIso()), diff = Math.round((d - t) / 864e5);
    if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== t.getFullYear() ? 'numeric' : undefined });
  }
  function nextDate(s, rep) {
    const d = local(s);
    if (rep === 'monthly') d.setMonth(d.getMonth() + 1); else d.setDate(d.getDate() + REPEAT[rep]);
    return iso(d);
  }
  const clean = (v, n) => String(v == null ? '' : v).slice(0, n);
  function sanitize(t) {
    if (!t || typeof t.text !== 'string' || !t.text.trim()) return null;
    return {
      id: clean(t.id, 40) || uid(), text: clean(t.text.trim(), 200), notes: clean(t.notes, 500),
      completed: !!t.completed, priority: ['low', 'medium', 'high'].includes(t.priority) ? t.priority : 'medium',
      category: CATS[t.category] ? t.category : 'other', dueDate: /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : null,
      repeat: REPEAT[t.repeat] !== undefined ? t.repeat : 'none', createdAt: Number(t.createdAt) || Date.now(),
      subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter(s => s && s.text).map(s => ({ id: clean(s.id, 40) || uid(), text: clean(s.text, 120), done: !!s.done })) : []
    };
  }

  /* ---------- storage ---------- */
  function load() {
    try { const p = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(p)) tasks = p.map(sanitize).filter(Boolean); } catch (_) { tasks = []; }
    try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF)) || {}); } catch (_) {}
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(tasks)); localStorage.setItem(PREF, JSON.stringify(prefs)); }
    catch (_) { toast('⚠️ Storage is full or blocked - changes may not be saved.'); }
  }

  /* ---------- toast, undo, confirm ---------- */
  function toast(msg, undo) {
    const t = document.createElement('div'); t.className = 'toast';
    const s = document.createElement('span'); s.textContent = msg; t.appendChild(s);
    if (undo) { const b = document.createElement('button'); b.textContent = 'Undo'; b.onclick = () => { undoLast(); t.remove(); }; t.appendChild(b); }
    $('toasts').appendChild(t); setTimeout(() => t.remove(), undo ? 6000 : 3000);
  }
  function snapshot() { undoStack.push(JSON.stringify(tasks)); if (undoStack.length > 20) undoStack.shift(); }
  function undoLast() {
    if (!undoStack.length) { toast('Nothing to undo.'); return; }
    tasks = JSON.parse(undoStack.pop()); render(); toast('↩️ Action undone');
  }
  function ask(title, msg, ok) {
    return new Promise(res => {
      $('cTitle').textContent = title; $('cMsg').textContent = msg; $('cYes').textContent = ok || 'Confirm';
      const m = $('confirmModal'); m.classList.add('active'); $('cNo').focus();
      const done = v => { m.classList.remove('active'); $('cYes').onclick = $('cNo').onclick = null; res(v); };
      $('cYes').onclick = () => done(true); $('cNo').onclick = () => done(false);
    });
  }

  /* ---------- filter & sort ---------- */
  const PRI = { high: 0, medium: 1, low: 2 };
  function getFiltered() {
    const term = el.search.value.toLowerCase().trim(), today = todayIso();
    let r = tasks.filter(t => {
      if (prefs.filter === 'active' && t.completed) return false;
      if (prefs.filter === 'completed' && !t.completed) return false;
      if (prefs.filter === 'high' && !(t.priority === 'high' && !t.completed)) return false;
      if (prefs.filter === 'today' && !(t.dueDate === today && !t.completed)) return false;
      if (prefs.filter === 'overdue' && !isOverdue(t)) return false;
      if (prefs.cat !== 'all' && t.category !== prefs.cat) return false;
      return !term || t.text.toLowerCase().includes(term) || t.notes.toLowerCase().includes(term);
    });
    const byDate = (a, b) => !a.dueDate ? (!b.dueDate ? 0 : 1) : !b.dueDate ? -1 : a.dueDate.localeCompare(b.dueDate);
    if (prefs.sort === 'date') r.sort((a, b) => byDate(a, b) || PRI[a.priority] - PRI[b.priority]);
    else if (prefs.sort === 'priority') r.sort((a, b) => PRI[a.priority] - PRI[b.priority] || byDate(a, b));
    else if (prefs.sort === 'status') r.sort((a, b) => a.completed - b.completed || byDate(a, b));
    else if (prefs.sort === 'alpha') r.sort((a, b) => a.text.localeCompare(b.text));
    return r;
  }

  /* ---------- stats ---------- */
  function updateStats() {
    const total = tasks.length, done = tasks.filter(t => t.completed).length;
    const high = tasks.filter(t => t.priority === 'high' && !t.completed).length;
    const rate = total ? Math.round(done / total * 100) : 0;
    $('totalStats').textContent = total; $('activeStats').textContent = total - done;
    $('completedStats').textContent = done; $('highStats').textContent = high;
    $('progressStats').textContent = rate + '%'; $('miniFill').style.width = rate + '%';
    const od = tasks.filter(isOverdue).length, td = tasks.filter(t => t.dueDate === todayIso() && !t.completed).length;
    el.alert.replaceChildren();
    if (od || td) {
      const mk = (n, label, f) => { if (!n) return; const b = document.createElement('button'); b.textContent = `${n} ${label}`; b.onclick = () => setFilter(f); el.alert.appendChild(b); };
      const lead = document.createElement('span'); lead.textContent = '⚠️ Heads up:'; el.alert.appendChild(lead);
      mk(od, 'overdue', 'overdue'); mk(td, 'due today', 'today');
    }
    el.alert.hidden = !(od || td);
  }

  /* ---------- render ---------- */
  function highlight(node, text, term) {
    if (!term) { node.textContent = text; return; }
    const low = text.toLowerCase(); let i = 0, j;
    while ((j = low.indexOf(term, i)) !== -1) {
      node.append(text.slice(i, j)); const m = document.createElement('mark'); m.textContent = text.slice(j, j + term.length); node.appendChild(m); i = j + term.length;
    }
    node.append(text.slice(i));
  }
  const pill = (cls, txt) => { const s = document.createElement('span'); s.className = 'pill ' + cls; s.textContent = txt; return s; };
  const btn = (cls, txt, title, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = txt; b.title = title; b.setAttribute('aria-label', title); b.onclick = fn; return b; };

  function makeItem(t, term) {
    const li = document.createElement('li'); li.className = 'item' + (t.completed ? ' done' : ''); li.dataset.id = t.id;
    if (prefs.sort === 'manual') {
      li.draggable = true;
      li.ondragstart = e => { dragId = t.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
      li.ondragend = () => { li.classList.remove('dragging'); dragId = null; };
      li.ondragover = e => { e.preventDefault(); li.classList.add('over'); };
      li.ondragleave = () => li.classList.remove('over');
      li.ondrop = e => { e.preventDefault(); li.classList.remove('over'); reorder(dragId, t.id); };
    }
    const grip = document.createElement('span'); grip.className = 'grip'; grip.textContent = '⋮⋮'; grip.title = 'Drag to reorder';
    const chk = document.createElement('button'); chk.className = 'chk' + (t.completed ? ' on' : ''); chk.textContent = t.completed ? '✓' : '';
    chk.setAttribute('role', 'checkbox'); chk.setAttribute('aria-checked', t.completed); chk.setAttribute('aria-label', 'Mark "' + t.text + '" as complete');
    chk.onclick = () => toggleTask(t.id);
    const body = document.createElement('div'); body.className = 'body';
    const txt = document.createElement('div'); txt.className = 'txt'; highlight(txt, t.text, term); body.appendChild(txt);
    if (t.notes) { const n = document.createElement('div'); n.className = 'note'; n.textContent = t.notes; body.appendChild(n); }
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.appendChild(pill('cat', CATS[t.category]));
    meta.appendChild(pill('p-' + t.priority, t.priority[0].toUpperCase() + t.priority.slice(1)));
    if (t.subtasks.length) meta.appendChild(pill('cat', '☑ ' + t.subtasks.filter(s => s.done).length + '/' + t.subtasks.length));
    if (t.repeat !== 'none') meta.appendChild(pill('cat', '🔁 ' + t.repeat));
    if (t.dueDate) { const d = document.createElement('span'); d.className = 'due' + (isOverdue(t) ? ' overdue' : ''); d.textContent = '📅 ' + fmtDate(t.dueDate); meta.appendChild(d); }
    const acts = document.createElement('div'); acts.className = 'acts';
    acts.append(btn('sm e', '✏️', 'Edit task', () => openEdit(t.id)), btn('sm d', '🗑️', 'Delete task', () => deleteTask(t.id)));
    li.append(grip, chk, body, meta, acts);
    return li;
  }

  const EMPTY = { all: ['✨', 'No tasks yet', 'Add your first task above to get started'], active: ['🎉', 'Nothing left to do', 'All your tasks are complete'], completed: ['📭', 'No completed tasks', 'Finish a task and it will show up here'], high: ['🟢', 'No high priority tasks', 'Nothing urgent right now'], today: ['☀️', 'Nothing due today', 'Enjoy the breathing room'], overdue: ['👏', 'No overdue tasks', "You're on schedule"] };
  function render() {
    const term = el.search.value.toLowerCase().trim(), r = getFiltered();
    el.list.className = 'list' + (prefs.sort === 'manual' ? ' manual' : '');
    el.list.replaceChildren();
    if (!r.length) {
      const e = (term || prefs.cat !== 'all') ? ['🔎', 'No matching tasks', 'Try a different search or category'] : EMPTY[prefs.filter];
      const li = document.createElement('li'); li.className = 'empty';
      li.innerHTML = '<div class="ic"></div><p></p><small></small>';
      li.children[0].textContent = e[0]; li.children[1].textContent = e[1]; li.children[2].textContent = e[2];
      el.list.appendChild(li);
    } else r.forEach(t => el.list.appendChild(makeItem(t, term)));
    el.count.textContent = r.length + (r.length === 1 ? ' task' : ' tasks');
    el.tabs.forEach(b => b.classList.toggle('active', b.dataset.filter === prefs.filter));
    el.sorts.forEach(b => b.classList.toggle('active', b.dataset.sort === prefs.sort));
    updateStats(); save();
  }
  function setFilter(f) { prefs.filter = f; render(); }

  /* ---------- CRUD ---------- */
  function addTask() {
    const text = el.input.value.trim();
    if (!text) { toast('Please enter a task description.'); el.input.focus(); return; }
    snapshot();
    tasks.unshift(sanitize({ id: uid(), text, priority: el.pri.value, category: el.cat.value, dueDate: el.due.value || null, repeat: el.rep.value }));
    el.input.value = ''; el.due.value = ''; el.rep.value = 'none';
    render(); toast('✅ Task added'); el.input.focus();
  }
  function deleteTask(id) {
    snapshot(); tasks = tasks.filter(t => t.id !== id); render(); toast('🗑️ Task deleted', true);
  }
  function toggleTask(id) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    snapshot(); t.completed = !t.completed;
    if (t.completed && t.repeat !== 'none') {
      const c = sanitize(Object.assign({}, t, { id: uid(), completed: false, createdAt: Date.now(), dueDate: nextDate(t.dueDate || todayIso(), t.repeat), subtasks: t.subtasks.map(s => Object.assign({}, s, { id: uid(), done: false })) }));
      tasks.splice(tasks.indexOf(t) + 1, 0, c); toast('🔁 Next ' + t.repeat + ' task scheduled for ' + fmtDate(c.dueDate));
    }
    render();
  }
  function reorder(from, to) {
    if (!from || from === to) return;
    snapshot(); const a = tasks.findIndex(t => t.id === from), [m] = tasks.splice(a, 1);
    tasks.splice(tasks.findIndex(t => t.id === to), 0, m); render();
  }
  async function clearAll() {
    if (!tasks.length) { toast('There are no tasks to clear.'); return; }
    if (await ask('Delete all tasks?', 'This removes all ' + tasks.length + ' tasks. You can undo right after.', 'Delete all')) { snapshot(); tasks = []; render(); toast('🗑️ All tasks deleted', true); }
  }
  function clearDone() {
    const n = tasks.filter(t => t.completed).length; if (!n) { toast('No completed tasks to clear.'); return; }
    snapshot(); tasks = tasks.filter(t => !t.completed); render(); toast('🧹 Cleared ' + n + ' completed', true);
  }

  /* ---------- edit modal ---------- */
  function renderSubs() {
    el.subList.replaceChildren();
    editingSubs.forEach(s => {
      const li = document.createElement('li'); li.className = s.done ? 'done' : '';
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = s.done; c.onchange = () => { s.done = c.checked; renderSubs(); };
      const sp = document.createElement('span'); sp.textContent = s.text;
      const x = document.createElement('button'); x.textContent = '✕'; x.setAttribute('aria-label', 'Remove subtask'); x.onclick = () => { editingSubs = editingSubs.filter(z => z !== s); renderSubs(); };
      li.append(c, sp, x); el.subList.appendChild(li);
    });
  }
  function openEdit(id) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    editingId = id; el.eText.value = t.text; el.eNotes.value = t.notes; el.eCat.value = t.category; el.ePri.value = t.priority;
    el.eDue.value = t.dueDate || ''; el.eRep.value = t.repeat; editingSubs = t.subtasks.map(s => Object.assign({}, s)); renderSubs();
    el.modal.classList.add('active'); el.eText.focus();
  }
  function closeEdit() { el.modal.classList.remove('active'); editingId = null; }
  function saveEdit() {
    const text = el.eText.value.trim();
    if (!text) { toast('Please enter a task description.'); el.eText.focus(); return; }
    const t = tasks.find(x => x.id === editingId); if (!t) return;
    snapshot();
    Object.assign(t, { text, notes: el.eNotes.value.trim(), category: el.eCat.value, priority: el.ePri.value, dueDate: el.eDue.value || null, repeat: el.eRep.value, subtasks: editingSubs });
    closeEdit(); render(); toast('💾 Changes saved');
  }

  /* ---------- import / export ---------- */
  function download(name, data, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportJson() {
    download('taskflow-backup-' + todayIso() + '.json', JSON.stringify(tasks, null, 2), 'application/json'); toast('⬇️ Backup downloaded');
  }
  function exportCsv() {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const rows = [['Task', 'Category', 'Priority', 'Due date', 'Status', 'Repeat', 'Notes', 'Subtasks']].concat(tasks.map(t =>
      [t.text, t.category, t.priority, t.dueDate || '', t.completed ? 'Completed' : 'Active', t.repeat, t.notes, t.subtasks.map(s => (s.done ? '[x] ' : '[ ] ') + s.text).join('; ')]));
    download('taskflow-tasks-' + todayIso() + '.csv', '\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv'); toast('📄 CSV downloaded');
  }
  function importJson(file) {
    if (!file) return; const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(fr.result); if (!Array.isArray(data)) throw 0;
        const ids = new Set(tasks.map(t => t.id)), add = data.map(sanitize).filter(t => t && !ids.has(t.id));
        snapshot(); tasks = tasks.concat(add); render(); toast('⬆️ Imported ' + add.length + ' task' + (add.length === 1 ? '' : 's'), true);
      } catch (_) { toast('❌ That file is not a valid TaskFlow backup.'); }
    };
    fr.readAsText(file);
  }

  /* ---------- theme ---------- */
  function setTheme(v) { document.documentElement.setAttribute('data-theme', v); $('themeToggle').textContent = v === 'dark' ? '🌞' : '🌙'; }
  function toggleTheme() {
    const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    setTheme(n); try { localStorage.setItem(THEME, n); } catch (_) {}
  }

  /* ---------- init ---------- */
  function init() {
    const optHtml = (all) => (all ? '<option value="all">🗂️ All categories</option>' : '') + Object.keys(CATS).map(k => '<option value="' + k + '">' + CATS[k] + '</option>').join('');
    el.cat.innerHTML = optHtml(); el.eCat.innerHTML = optHtml(); el.catFilter.innerHTML = optHtml(true);
    let th = null; try { th = localStorage.getItem(THEME); } catch (_) {}
    setTheme(th || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    load(); if (!['all', 'active', 'completed', 'high', 'today', 'overdue'].includes(prefs.filter)) prefs.filter = 'all';
    if (!['date', 'priority', 'status', 'alpha', 'manual'].includes(prefs.sort)) prefs.sort = 'date';
    if (prefs.cat !== 'all' && !CATS[prefs.cat]) prefs.cat = 'all';
    el.catFilter.value = prefs.cat; render();

    el.add.onclick = addTask;
    el.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } });
    el.search.addEventListener('input', render);
    el.catFilter.onchange = () => { prefs.cat = el.catFilter.value; render(); };
    el.tabs.forEach(b => b.onclick = () => setFilter(b.dataset.filter));
    el.sorts.forEach(b => b.onclick = () => { prefs.sort = b.dataset.sort; render(); });
    $('themeToggle').onclick = toggleTheme;
    $('clearAllBtn').onclick = clearAll; $('clearDone').onclick = () => { clearDone(); $('dataMenu').open = false; };
    $('undoBtn').onclick = () => { undoLast(); $('dataMenu').open = false; };
    $('expJson').onclick = () => { exportJson(); $('dataMenu').open = false; };
    $('expCsv').onclick = () => { exportCsv(); $('dataMenu').open = false; };
    $('printBtn').onclick = () => { $('dataMenu').open = false; window.print(); };
    $('impBtn').onclick = () => { $('dataMenu').open = false; $('impFile').click(); };
    $('impFile').onchange = e => { importJson(e.target.files[0]); e.target.value = ''; };
    $('modalClose').onclick = $('modalCancel').onclick = closeEdit; $('modalSave').onclick = saveEdit;
    el.modal.addEventListener('click', e => { if (e.target === el.modal) closeEdit(); });
    el.eText.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } });
    el.subInput.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return; e.preventDefault(); const v = el.subInput.value.trim();
      if (v) { editingSubs.push({ id: uid(), text: v, done: false }); el.subInput.value = ''; renderSubs(); }
    });
    document.addEventListener('click', e => { const m = $('dataMenu'); if (m.open && !m.contains(e.target)) m.open = false; });
    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (e.key === 'Escape') { if ($('confirmModal').classList.contains('active')) $('cNo').click(); else closeEdit(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undoLast(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); el.search.focus(); } else if (e.key.toLowerCase() === 'n') { e.preventDefault(); el.input.focus(); }
    });
    setInterval(() => { if (!document.hidden) render(); }, 60000 * 5); /* refresh overdue/today labels */
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
