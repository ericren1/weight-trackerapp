import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Download,
  LogIn,
  LogOut,
  Moon,
  MoreHorizontal,
  Pencil,
  Save,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import * as api from './api';
import type { AppData, Phase, RangeKey, WeightEntry } from './types';
import {
  averageForWindow,
  buildChartData,
  formatChange,
  formatCompactDate,
  formatLongDate,
  formatPercent,
  formatWeight,
  getRangeLabel,
  latestEntry,
  localIsoDate,
  selectedRangeChange,
} from './utils';

const RANGES: RangeKey[] = ['7D', '30D', '3M', '6M', '1Y', 'ALL'];
const PHASES: Phase[] = ['Cut', 'Maintain', 'Gain'];

function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<RangeKey>('30D');
  const [showDaily, setShowDaily] = useState(true);
  const [showAverage, setShowAverage] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    (localStorage.getItem('weight-theme') as 'light' | 'dark') || 'dark',
  );
  const [loginOpen, setLoginOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<WeightEntry | null>(null);
  const [duplicate, setDuplicate] = useState<{ existing: WeightEntry; weight: number; notes: string } | null>(null);
  const [phaseConfirm, setPhaseConfirm] = useState<Phase | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setError('');
      const next = await api.getData();
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('weight-theme', theme);
  }, [theme]);

  const entries = data?.entries ?? [];
  const chartData = useMemo(() => buildChartData(entries, range), [entries, range]);
  const current = latestEntry(entries);
  const sevenDayAvg = current ? averageForWindow(entries, localIsoDate()) : null;
  const change = selectedRangeChange(entries, range);
  const yDomain = useMemo(() => {
    const values = chartData.flatMap((point) => [showDaily ? point.weight : null, showAverage ? point.sevenDayAvg : null])
      .filter((value): value is number => typeof value === 'number');
    if (!values.length) return ['auto', 'auto'] as const;
    const min = Math.floor((Math.min(...values) - 1) * 2) / 2;
    const max = Math.ceil((Math.max(...values) + 1) * 2) / 2;
    return [min, max] as const;
  }, [chartData, showDaily, showAverage]);

  async function handlePhaseChange(phase: Phase) {
    setPhaseConfirm(phase);
  }

  async function confirmPhase() {
    if (!phaseConfirm) return;
    try {
      await api.setPhase(phaseConfirm, localIsoDate());
      setPhaseConfirm(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change phase.');
    }
  }

  async function handleImport(file: File) {
    const text = await file.text();
    try {
      const parsed = parseCsv(text);
      if (!parsed.length) throw new Error('No valid rows found. Expected Date and Weight columns.');
      const result = await api.importEntries(parsed);
      alert(`Import complete: ${result.imported} added, ${result.updated} updated.`);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not import CSV.');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  if (loading) return <div className="center-screen">Loading tracker…</div>;
  if (!data) return <div className="center-screen">{error || 'Could not load tracker.'}</div>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">WEIGHT<span>.</span></div>
          <div className="subtitle">Personal Weight Analytics</div>
        </div>
        <div className="header-actions">
          <button className="icon-button" aria-label="Toggle theme" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          {data.authenticated ? (
            <button className="text-button" onClick={async () => { await api.logout(); await refresh(); }}>
              <LogOut size={16} /> Sign out
            </button>
          ) : (
            <button className="text-button" onClick={() => setLoginOpen(true)}>
              <LogIn size={16} /> Owner login
            </button>
          )}
        </div>
      </header>

      <main>
        <section className="phase-row card-flat">
          <div>
            <div className="eyebrow">Current phase</div>
            {data.authenticated ? (
              <select
                className={`phase-select phase-${data.settings.current_phase.toLowerCase()}`}
                value={data.settings.current_phase}
                onChange={(event) => handlePhaseChange(event.target.value as Phase)}
              >
                {PHASES.map((phase) => <option key={phase}>{phase}</option>)}
              </select>
            ) : (
              <span className={`phase-badge phase-${data.settings.current_phase.toLowerCase()}`}>{data.settings.current_phase}</span>
            )}
          </div>
          <div className="phase-since">Since {formatLongDate(data.settings.current_phase_started_on)}</div>
        </section>

        {data.authenticated && (
          <EntryForm
            currentPhase={data.settings.current_phase}
            onCreated={refresh}
            onDuplicate={(existing, weight, notes) => setDuplicate({ existing, weight, notes })}
          />
        )}

        <section className="metrics-grid">
          <Metric label="Current weight" value={formatWeight(current?.weight)} />
          <Metric label="7-day avg" value={formatWeight(sevenDayAvg)} />
          <Metric
            label={`${range} change`}
            value={formatChange(change?.pounds)}
            detail={formatPercent(change?.percent)}
            trend={change?.pounds}
          />
        </section>

        <section className="panel chart-panel">
          <div className="panel-heading chart-heading">
            <div>
              <h2>Weight progress</h2>
              <p>{getRangeLabel(range)}</p>
            </div>
            <div className={`change-chip ${change?.pounds == null ? '' : change.pounds <= 0 ? 'down' : 'up'}`}>
              {formatChange(change?.pounds)}
            </div>
          </div>

          <div className="range-row">
            <div className="segmented">
              {RANGES.map((item) => (
                <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item}</button>
              ))}
            </div>
            <div className="series-toggles">
              <label><input type="checkbox" checked={showDaily} onChange={(e) => setShowDaily(e.target.checked)} /> Daily weight</label>
              <label><input type="checkbox" checked={showAverage} onChange={(e) => setShowAverage(e.target.checked)} /> 7-day average</label>
            </div>
          </div>

          <div className="chart-wrap">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 18, right: 18, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="3 5" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={28} />
                  <YAxis domain={yDomain as [number | string, number | string]} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip content={<WeightTooltip />} />
                  {showDaily && (
                    <Line type="monotone" dataKey="weight" name="Daily weight" stroke="var(--chart-primary)" strokeWidth={2.4} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                  )}
                  {showAverage && (
                    <Line type="monotone" dataKey="sevenDayAvg" name="7-day average" stroke="var(--chart-average)" strokeWidth={2.8} dot={false} connectNulls />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </div>
          <p className="chart-note">Missed days remain null; no weight is invented. The 7-day average uses real measurements within each 7-calendar-day window.</p>
        </section>

        <section className="panel history-panel">
          <div className="panel-heading history-heading">
            <div>
              <h2>History</h2>
              <p>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</p>
            </div>
            {data.authenticated && (
              <div className="history-actions">
                <input
                  ref={importRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
                />
                <button className="secondary-button" onClick={() => importRef.current?.click()}><Upload size={16} /> Import CSV</button>
                <a className="secondary-button" href="/api/export.csv"><Download size={16} /> Export CSV</a>
              </div>
            )}
          </div>
          <HistoryTable entries={entries} authenticated={data.authenticated} onEdit={setEditEntry} onChanged={refresh} />
        </section>
      </main>

      <footer>Built as a public-read, owner-write weight analytics app.</footer>

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} onSuccess={async () => { setLoginOpen(false); await refresh(); }} />}
      {editEntry && <EditModal entry={editEntry} onClose={() => setEditEntry(null)} onSaved={async () => { setEditEntry(null); await refresh(); }} />}
      {duplicate && (
        <ConfirmModal
          title="Update today's entry?"
          onCancel={() => setDuplicate(null)}
          confirmText="Update entry"
          onConfirm={async () => {
            const notes = duplicate.notes.trim() || duplicate.existing.notes || null;
            await api.updateEntry(duplicate.existing.date, {
              date: duplicate.existing.date,
              weight: duplicate.weight,
              phase: duplicate.existing.phase,
              notes,
            });
            setDuplicate(null);
            await refresh();
          }}
        >
          <p>You already have an entry for {formatLongDate(duplicate.existing.date)}.</p>
          <div className="compare-grid">
            <div><span>Current</span><strong>{formatWeight(duplicate.existing.weight)}</strong></div>
            <div><span>New</span><strong>{formatWeight(duplicate.weight)}</strong></div>
          </div>
          <p className="muted-copy">Updating replaces the weight. If the new Notes box was blank, your existing notes are preserved.</p>
        </ConfirmModal>
      )}
      {phaseConfirm && (
        <ConfirmModal title={`Change phase to ${phaseConfirm}?`} confirmText="Change phase" onCancel={() => setPhaseConfirm(null)} onConfirm={confirmPhase}>
          <p>New entries will automatically be tagged <strong>{phaseConfirm}</strong> until you change the phase again. Existing entries will not be changed.</p>
        </ConfirmModal>
      )}
      {error && <div className="toast" onClick={() => setError('')}>{error}<X size={15} /></div>}
    </div>
  );
}

function Metric({ label, value, detail, trend }: { label: string; value: string; detail?: string; trend?: number | null }) {
  return (
    <div className="metric-card">
      <div className="eyebrow">{label}</div>
      <div className={`metric-value ${trend == null ? '' : trend <= 0 ? 'down-text' : 'up-text'}`}>{value}</div>
      {detail && <div className="metric-detail">{detail}</div>}
    </div>
  );
}

function EntryForm({ currentPhase, onCreated, onDuplicate }: {
  currentPhase: Phase;
  onCreated: () => Promise<void>;
  onDuplicate: (existing: WeightEntry, weight: number, notes: string) => void;
}) {
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(weight);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setSaving(true);
    try {
      await api.addEntry({ date: localIsoDate(), weight: parsed, notes });
      setWeight('');
      setNotes('');
      await onCreated();
    } catch (err) {
      const typed = err as Error & { status?: number; body?: { existing?: WeightEntry } };
      if (typed.status === 409 && typed.body?.existing) {
        onDuplicate(typed.body.existing, parsed, notes);
      } else {
        alert(err instanceof Error ? err.message : 'Could not save entry.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel entry-panel">
      <div className="panel-heading">
        <div><h2>Log today's entry</h2><p>{formatLongDate(localIsoDate())}</p></div>
        <span className={`phase-badge phase-${currentPhase.toLowerCase()}`}>{currentPhase}</span>
      </div>
      <form className="entry-form" onSubmit={submit}>
        <label className="field weight-field">
          <span>Weight</span>
          <div className="weight-input-wrap"><input inputMode="decimal" step="0.1" type="number" min="1" max="999" placeholder="159.5" value={weight} onChange={(e) => setWeight(e.target.value)} required /><b>lb</b></div>
        </label>
        <label className="field notes-field">
          <span>Notes <em>optional</em></span>
          <input maxLength={1000} type="text" placeholder="Basketball, ate late, high sodium…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button className="primary-button save-button" disabled={saving}><Save size={17} /> {saving ? 'Saving…' : 'Save entry'}</button>
      </form>
      <div className="auto-phase">Phase automatically assigned: <strong>{currentPhase}</strong></div>
    </section>
  );
}

function HistoryTable({ entries, authenticated, onEdit, onChanged }: {
  entries: WeightEntry[];
  authenticated: boolean;
  onEdit: (entry: WeightEntry) => void;
  onChanged: () => Promise<void>;
}) {
  const ordered = [...entries].reverse();
  if (!ordered.length) return <div className="empty-state">No entries yet. Your first weigh-in will appear here.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Weight</th><th>7D Avg</th><th>Phase</th><th>Notes</th>{authenticated && <th aria-label="Actions" />}</tr></thead>
        <tbody>
          {ordered.map((entry) => (
            <tr key={entry.id}>
              <td>{formatCompactDate(entry.date)}</td>
              <td className="weight-cell">{entry.weight.toFixed(1)} lb</td>
              <td>{formatWeight(averageForWindow(entries, entry.date))}</td>
              <td>
                {entry.phase
                  ? <span className={`phase-badge small phase-${entry.phase.toLowerCase()}`}>{entry.phase}</span>
                  : <span className="muted-copy">—</span>}
              </td>
              <td className="notes-cell">{entry.notes || <span className="muted-copy">—</span>}</td>
              {authenticated && <td><RowMenu entry={entry} onEdit={() => onEdit(entry)} onChanged={onChanged} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowMenu({ entry, onEdit, onChanged }: { entry: WeightEntry; onEdit: () => void; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="row-menu">
      <button className="icon-button compact" onClick={() => setOpen(!open)}><MoreHorizontal size={18} /></button>
      {open && (
        <div className="menu-popover">
          <button onClick={() => { setOpen(false); onEdit(); }}><Pencil size={15} /> Edit</button>
          <button className="danger" onClick={async () => {
            setOpen(false);
            if (!confirm(`Delete the ${formatCompactDate(entry.date)} entry?`)) return;
            await api.deleteEntry(entry.date);
            await onChanged();
          }}><Trash2 size={15} /> Delete</button>
        </div>
      )}
    </div>
  );
}

function LoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Owner login" onClose={onClose}>
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError('');
        try { await api.login(password); await onSuccess(); }
        catch { setError('Incorrect password.'); }
        finally { setBusy(false); }
      }}>
        <label className="field"><span>Password</span><input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </Modal>
  );
}

function EditModal({ entry, onClose, onSaved }: { entry: WeightEntry; onClose: () => void; onSaved: () => Promise<void> }) {
  const [date, setDate] = useState(entry.date);
  const [weight, setWeight] = useState(String(entry.weight));
  const [phase, setPhase] = useState<Phase | ''>(entry.phase ?? '');
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Edit entry" onClose={onClose}>
      <form className="modal-form" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try {
          await api.updateEntry(entry.date, { date, weight: Number(weight), phase: phase || null, notes: notes.trim() || null });
          await onSaved();
        } catch (err) { alert(err instanceof Error ? err.message : 'Could not save changes.'); }
        finally { setBusy(false); }
      }}>
        <label className="field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className="field"><span>Weight (lb)</span><input type="number" step="0.1" min="1" value={weight} onChange={(e) => setWeight(e.target.value)} required /></label>
        <label className="field"><span>Phase</span><select value={phase} onChange={(e) => setPhase(e.target.value as Phase | '')}><option value="">Unassigned</option>{PHASES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>Notes</span><textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>Save changes</button></div>
      </form>
    </Modal>
  );
}

function ConfirmModal({ title, children, onCancel, onConfirm, confirmText }: { title: string; children: ReactNode; onCancel: () => void; onConfirm: () => Promise<void> | void; confirmText: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="confirm-copy">{children}</div>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onCancel}>Cancel</button>
        <button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{busy ? 'Saving…' : confirmText}</button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" role="dialog" aria-modal="true">
        <div className="modal-head"><h3>{title}</h3><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

function WeightTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="chart-tooltip">
      <strong>{formatLongDate(point.date)}</strong>
      <div>Weight <b>{point.weight == null ? 'No entry' : `${point.weight.toFixed(1)} lb`}</b></div>
      <div>7-day avg <b>{point.sevenDayAvg == null ? '—' : `${point.sevenDayAvg.toFixed(1)} lb`}</b></div>
      {point.phase && <span className={`phase-badge small phase-${point.phase.toLowerCase()}`}>{point.phase}</span>}
      {point.notes && <p>“{point.notes}”</p>}
    </div>
  );
}

function EmptyChart() {
  return <div className="empty-chart"><strong>No weight data yet</strong><span>Log your first entry to start the graph.</span></div>;
}

function parseCsv(text: string): Array<{ date: string; weight: number; phase?: Phase; notes?: string }> {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some((v) => v.trim())) rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const dateIndex = header.findIndex((h) => h === 'date' || h.includes('date'));
  const weightIndex = header.findIndex((h) => h === 'weight' || h.includes('weight'));
  const phaseIndex = header.findIndex((h) => h === 'phase');
  const notesIndex = header.findIndex((h) => h === 'notes' || h === 'note');
  if (dateIndex < 0 || weightIndex < 0) throw new Error('CSV needs Date and Weight columns.');

  return rows.slice(1).map((cells) => {
    const date = normalizeDate(cells[dateIndex]?.trim());
    const weight = Number(String(cells[weightIndex] ?? '').replace(/[^0-9.\-]/g, ''));
    const rawPhase = cells[phaseIndex]?.trim().toLowerCase();
    const phase: Phase | undefined = rawPhase
      ? rawPhase === 'cut' ? 'Cut'
      : ['maintain', 'maintenance', 'maintaining'].includes(rawPhase) ? 'Maintain'
      : ['gain', 'gaining', 'grow', 'growing', 'bulk', 'bulking'].includes(rawPhase) ? 'Gain'
      : undefined
      : undefined;
    const notes = notesIndex >= 0 ? (cells[notesIndex]?.trim() || undefined) : undefined;
    return { date, weight, phase, notes };
  }).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.weight) && item.weight > 0);
}

function normalizeDate(value = '') {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return localIsoDate(parsed);
}

export default App;
