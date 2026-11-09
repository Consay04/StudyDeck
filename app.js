const $ = (s) => document.querySelector(s);
const state = { subjects: [], tasks: [], stats: null };
let editingTask = null, editingSubject = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

async function load() {
  [state.subjects, state.tasks, state.stats] = await Promise.all([api('/api/subjects'), api('/api/tasks'), api('/api/stats')]);
  render();
}

function render() { renderStats(); renderSelects(); renderTasks(); renderChart(); renderSubjects(); }

function renderStats() {
  const s = state.stats;
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  $('#stats').innerHTML = `
    <div class="stat"><div class="label">Total tasks</div><div class="value">${s.total}</div></div>
    <div class="stat good"><div class="label">Completed</div><div class="value">${pct}%</div></div>
    <div class="stat ${s.overdue ? 'warn' : ''}"><div class="label">Overdue</div><div class="value">${s.overdue}</div></div>
    <div class="stat"><div class="label">Due in 7 days</div><div class="value">${s.due_week}</div></div>
    <div class="stat"><div class="label">Study streak</div><div class="value">${s.streak} 🔥</div></div>`;
}

function renderSelects() {
  const opts = state.subjects.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const keep = $('#fSubject').value || 'all';
  $('#fSubject').innerHTML = `<option value="all">All subjects</option>` + opts;
  $('#fSubject').value = [...$('#fSubject').options].some((o) => o.value === keep) ? keep : 'all';
  const ts = $('#timerSubject').value;
  $('#timerSubject').innerHTML = opts;
  if (ts) $('#timerSubject').value = ts;
  $('#taskSubject').innerHTML = opts;
}

function renderTasks() {
  const fs = $('#fStatus').value, fj = $('#fSubject').value;
  const list = state.tasks.filter((t) => (fs === 'all' || t.status === fs) && (fj === 'all' || String(t.subject_id) === fj));
  if (!list.length) { $('#tasks').innerHTML = `<li class="empty">No tasks here. Add one with “+ New Task”.</li>`; return; }
  $('#tasks').innerHTML = list.map((t) => {
    const late = t.due_date && t.status !== 'done' && t.due_date < today();
    return `<li class="task ${t.status === 'done' ? 'done' : ''}" style="--c:${esc(t.subject_color)}">
      <input type="checkbox" ${t.status === 'done' ? 'checked' : ''} data-toggle="${t.id}">
      <div class="body">
        <div class="title">${esc(t.title)}</div>
        <div class="meta">
          <span class="chip">${esc(t.subject_name)}</span>
          <span class="chip ${t.priority}">${t.priority}</span>
          ${t.status === 'doing' ? '<span class="chip">in progress</span>' : ''}
          ${t.due_date ? `<span class="chip ${late ? 'late' : ''}">${late ? 'Overdue · ' : 'Due '}${esc(t.due_date)}</span>` : ''}
        </div>
        ${t.notes ? `<div class="meta">${esc(t.notes)}</div>` : ''}
      </div>
      <button class="icon" title="Edit" data-edit-task="${t.id}">✎</button>
      <button class="icon" title="Delete" data-del-task="${t.id}">🗑</button>
    </li>`;
  }).join('');
}

function renderChart() {
  const w = state.stats.week, max = Math.max(30, ...w.map((d) => d.minutes));
  $('#chart').innerHTML = w.map((d) => `<div class="bar"><span>${d.minutes}m</span><i style="height:${(d.minutes / max) * 90}px"></i><span>${d.label}</span></div>`).join('');
  $('#weekTotal').textContent = `${(state.stats.weekMinutes / 60).toFixed(1)} h total`;
}

function renderSubjects() {
  if (!state.subjects.length) { $('#subjects').innerHTML = '<div class="empty">Add your first subject.</div>'; return; }
  $('#subjects').innerHTML = state.subjects.map((s) => {
    const st = state.stats.bySubject.find((x) => x.id === s.id) || { tasks: 0, done: 0, minutes: 0 };
    const pct = st.tasks ? Math.round((st.done / st.tasks) * 100) : 0;
    return `<div class="subj">
      <div class="subj-top"><span class="dot" style="background:${esc(s.color)}"></span><b>${esc(s.name)}</b>
        <button class="icon" data-edit-subj="${s.id}">✎</button><button class="icon" data-del-subj="${s.id}">🗑</button></div>
      <div class="prog"><i style="width:${pct}%;background:${esc(s.color)}"></i></div>
      <small>${st.done}/${st.tasks} tasks · ${(st.minutes / 60).toFixed(1)}h studied / ${s.goal_hours}h goal</small>
    </div>`;
  }).join('');
}

/* ----- Task CRUD ----- */
function openTask(task) {
  if (!state.subjects.length) return toast('Add a subject first');
  editingTask = task || null;
  const f = $('#taskForm');
  $('#taskDlgTitle').textContent = task ? 'Edit Task' : 'New Task';
  f.title.value = task?.title || '';
  f.subject_id.value = task?.subject_id || state.subjects[0].id;
  f.due_date.value = task?.due_date || '';
  f.priority.value = task?.priority || 'medium';
  f.status.value = task?.status || 'todo';
  f.notes.value = task?.notes || '';
  $('#taskDlg').showModal();
}

$('#taskForm').addEventListener('submit', async (e) => {
  const f = e.target;
  const body = { title: f.title.value, subject_id: Number(f.subject_id.value), due_date: f.due_date.value || null,
    priority: f.priority.value, status: f.status.value, notes: f.notes.value };
  try {
    if (editingTask) await api(`/api/tasks/${editingTask.id}`, 'PUT', body); else await api('/api/tasks', 'POST', body);
    toast(editingTask ? 'Task updated' : 'Task added'); load();
  } catch (err) { toast(err.message); }
});

/* ----- Subject CRUD ----- */
function openSubject(s) {
  editingSubject = s || null;
  const f = $('#subjectForm');
  $('#subjectDlgTitle').textContent = s ? 'Edit Subject' : 'New Subject';
  f.name.value = s?.name || ''; f.color.value = s?.color || '#7c5cff'; f.goal_hours.value = s?.goal_hours || 5;
  $('#subjectDlg').showModal();
}

$('#subjectForm').addEventListener('submit', async (e) => {
  const f = e.target;
  const body = { name: f.name.value, color: f.color.value, goal_hours: Number(f.goal_hours.value) };
  try {
    if (editingSubject) await api(`/api/subjects/${editingSubject.id}`, 'PUT', body); else await api('/api/subjects', 'POST', body);
    toast(editingSubject ? 'Subject updated' : 'Subject added'); load();
  } catch (err) { toast(err.message); }
});

/* ----- Click handling ----- */
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.close !== undefined) t.closest('dialog').close();
  if (t.dataset.editTask) openTask(state.tasks.find((x) => x.id == t.dataset.editTask));
  if (t.dataset.editSubj) openSubject(state.subjects.find((x) => x.id == t.dataset.editSubj));
  if (t.dataset.delTask && confirm('Delete this task?')) { await api(`/api/tasks/${t.dataset.delTask}`, 'DELETE'); toast('Task deleted'); load(); }
  if (t.dataset.delSubj && confirm('Delete this subject and all its tasks?')) { await api(`/api/subjects/${t.dataset.delSubj}`, 'DELETE'); toast('Subject deleted'); load(); }
});

document.addEventListener('change', async (e) => {
  if (e.target.dataset.toggle) {
    const task = state.tasks.find((x) => x.id == e.target.dataset.toggle);
    await api(`/api/tasks/${task.id}`, 'PUT', { ...task, status: e.target.checked ? 'done' : 'todo' });
    load();
  }
});

$('#addTaskBtn').onclick = () => openTask();
$('#addSubjectBtn').onclick = () => openSubject();
$('#fStatus').onchange = renderTasks;
$('#fSubject').onchange = renderTasks;

/* ----- Focus timer ----- */
let timerId = null, remaining = 0, elapsed = 0;
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

$('#timerMins').oninput = () => { if (!timerId) $('#time').textContent = fmt((Number($('#timerMins').value) || 25) * 60); };

$('#startBtn').onclick = () => {
  if (timerId) return;
  if (!state.subjects.length) return toast('Add a subject first');
  if (!remaining) remaining = (Number($('#timerMins').value) || 25) * 60;
  $('#timerMsg').textContent = 'Focus mode on. Stay with it!';
  timerId = setInterval(async () => {
    remaining--; elapsed++;
    $('#time').textContent = fmt(remaining);
    if (remaining <= 0) { await finishTimer(true); }
  }, 1000);
};

async function finishTimer(done) {
  clearInterval(timerId); timerId = null;
  const mins = Math.floor(elapsed / 60);
  if (mins >= 1) {
    await api('/api/sessions', 'POST', { subject_id: Number($('#timerSubject').value), minutes: mins });
    toast(done ? `Session complete: ${mins} min saved` : `${mins} min saved`);
    await load();
  } else { toast('Under 1 minute, not saved'); }
  remaining = 0; elapsed = 0;
  $('#time').textContent = fmt((Number($('#timerMins').value) || 25) * 60);
  $('#timerMsg').textContent = 'Study sessions are saved to your stats.';
}
$('#stopBtn').onclick = () => { if (timerId || elapsed) finishTimer(false); };

load();
