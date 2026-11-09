const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, 'study.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#7c5cff',
  goal_hours REAL NOT NULL DEFAULT 5
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  minutes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Seed sample data on first run so the dashboard isn't empty
if (db.prepare('SELECT COUNT(*) c FROM subjects').get().c === 0) {
  const addS = db.prepare('INSERT INTO subjects (name,color,goal_hours) VALUES (?,?,?)');
  const addT = db.prepare('INSERT INTO tasks (subject_id,title,notes,due_date,priority,status) VALUES (?,?,?,?,?,?)');
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const math = addS.run('Mathematics', '#7c5cff', 6).lastInsertRowid;
  const prog = addS.run('Programming', '#22d3ee', 8).lastInsertRowid;
  const eng = addS.run('English', '#f472b6', 4).lastInsertRowid;
  addT.run(math, 'Finish calculus problem set', 'Chapters 4-5', day(1), 'high', 'todo');
  addT.run(math, 'Review derivatives notes', '', day(-1), 'medium', 'todo');
  addT.run(prog, 'Build Express CRUD project', 'Push to GitHub', day(1), 'high', 'doing');
  addT.run(prog, 'Practice SQL joins', '', day(4), 'low', 'todo');
  addT.run(eng, 'Write essay draft', '500 words', day(3), 'medium', 'todo');
  addT.run(eng, 'Read chapter 2', '', day(-3), 'low', 'done');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES = ['todo', 'doing', 'done'];
const bad = (res, msg) => res.status(400).json({ error: msg });

/* ---------- SUBJECTS ---------- */
app.get('/api/subjects', (req, res) => {
  res.json(db.prepare('SELECT * FROM subjects ORDER BY name').all());
});

app.post('/api/subjects', (req, res) => {
  const { name, color = '#7c5cff', goal_hours = 5 } = req.body;
  if (!name || !name.trim()) return bad(res, 'Name is required');
  const r = db.prepare('INSERT INTO subjects (name,color,goal_hours) VALUES (?,?,?)')
    .run(name.trim(), color, Number(goal_hours) || 5);
  res.status(201).json(db.prepare('SELECT * FROM subjects WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/subjects/:id', (req, res) => {
  const { name, color, goal_hours } = req.body;
  if (!name || !name.trim()) return bad(res, 'Name is required');
  const r = db.prepare('UPDATE subjects SET name=?, color=?, goal_hours=? WHERE id=?')
    .run(name.trim(), color, Number(goal_hours) || 5, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json(db.prepare('SELECT * FROM subjects WHERE id=?').get(req.params.id));
});

app.delete('/api/subjects/:id', (req, res) => {
  const r = db.prepare('DELETE FROM subjects WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

/* ---------- TASKS ---------- */
app.get('/api/tasks', (req, res) => {
  res.json(db.prepare(`
    SELECT t.*, s.name AS subject_name, s.color AS subject_color
    FROM tasks t JOIN subjects s ON s.id = t.subject_id
    ORDER BY (t.status='done'), t.due_date IS NULL, t.due_date`).all());
});

function validTask(b) {
  if (!b.title || !b.title.trim()) return 'Title is required';
  if (!b.subject_id) return 'Subject is required';
  if (b.priority && !PRIORITIES.includes(b.priority)) return 'Invalid priority';
  if (b.status && !STATUSES.includes(b.status)) return 'Invalid status';
  return null;
}

app.post('/api/tasks', (req, res) => {
  const err = validTask(req.body);
  if (err) return bad(res, err);
  const b = req.body;
  try {
    const r = db.prepare('INSERT INTO tasks (subject_id,title,notes,due_date,priority,status) VALUES (?,?,?,?,?,?)')
      .run(b.subject_id, b.title.trim(), b.notes || '', b.due_date || null, b.priority || 'medium', b.status || 'todo');
    res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { bad(res, 'Invalid subject'); }
});

app.put('/api/tasks/:id', (req, res) => {
  const err = validTask(req.body);
  if (err) return bad(res, err);
  const b = req.body;
  const r = db.prepare('UPDATE tasks SET subject_id=?, title=?, notes=?, due_date=?, priority=?, status=? WHERE id=?')
    .run(b.subject_id, b.title.trim(), b.notes || '', b.due_date || null, b.priority || 'medium', b.status || 'todo', req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id));
});

app.delete('/api/tasks/:id', (req, res) => {
  const r = db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

/* ---------- FOCUS SESSIONS ---------- */
app.post('/api/sessions', (req, res) => {
  const { subject_id, minutes } = req.body;
  if (!subject_id || !(Number(minutes) > 0)) return bad(res, 'subject_id and minutes required');
  try {
    db.prepare('INSERT INTO sessions (subject_id, minutes) VALUES (?,?)').run(subject_id, Math.round(minutes));
    res.status(201).json({ ok: true });
  } catch (e) { bad(res, 'Invalid subject'); }
});

/* ---------- DASHBOARD STATS ---------- */
app.get('/api/stats', (req, res) => {
  const t = db.prepare(`
    SELECT COUNT(*) total,
      COALESCE(SUM(status='done'),0) done,
      COALESCE(SUM(status!='done' AND due_date IS NOT NULL AND due_date < date('now','localtime')),0) overdue,
      COALESCE(SUM(status!='done' AND due_date BETWEEN date('now','localtime') AND date('now','localtime','+7 day')),0) due_week
    FROM tasks`).get();

  const bySubject = db.prepare(`
    SELECT s.id,
      (SELECT COUNT(*) FROM tasks WHERE subject_id=s.id) tasks,
      (SELECT COUNT(*) FROM tasks WHERE subject_id=s.id AND status='done') done,
      (SELECT COALESCE(SUM(minutes),0) FROM sessions WHERE subject_id=s.id) minutes
    FROM subjects s`).all();

  const rows = db.prepare(`
    SELECT date(created_at,'localtime') d, SUM(minutes) m FROM sessions
    WHERE date(created_at,'localtime') >= date('now','localtime','-6 day') GROUP BY d`).all();
  const map = Object.fromEntries(rows.map(r => [r.d, r.m]));
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 864e5);
    const key = new Date(dt.getTime() - dt.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    week.push({ date: key, label: dt.toLocaleDateString('en', { weekday: 'short' }), minutes: map[key] || 0 });
  }

  // study streak (consecutive days with a session, ending today or yesterday)
  const days = new Set(db.prepare(`SELECT DISTINCT date(created_at,'localtime') d FROM sessions`).all().map(r => r.d));
  let streak = 0;
  const cur = new Date();
  const fmt = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (!days.has(fmt(cur))) cur.setDate(cur.getDate() - 1);
  while (days.has(fmt(cur))) { streak++; cur.setDate(cur.getDate() - 1); }

  res.json({ ...t, bySubject, week, streak, weekMinutes: week.reduce((a, d) => a + d.minutes, 0) });
});

app.listen(PORT, () => console.log(`StudyDeck running at http://localhost:${PORT}`));
