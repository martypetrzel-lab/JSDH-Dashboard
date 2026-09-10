'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  attendanceLabels,
  topicMatchesSearch,
  trainingStatuses,
  trainingTypes,
  type TrainingSessionRow,
  type TrainingTopicRow,
  type TrainingMember,
} from '@/lib/training';
import { fromLocalDateTimeInput, toLocalDateTimeInput } from '@/lib/service';

const name = (m: TrainingMember) =>
  [m.firstName, m.lastName === '—' ? '' : m.lastName].filter(Boolean).join(' ');
const day = (s: string) =>
  new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'UTC',
    dateStyle: 'medium',
  }).format(new Date(s));
const clock = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat('cs-CZ', {
        timeZone: 'Europe/Prague',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(s))
    : '—';
async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    ...(body
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Operace se nezdařila.');
  return data as T;
}
async function downloadPdf(id: string) {
  const response = await fetch(
    '/api/training/sessions/' + id + '/attendance-sheet',
  );
  if (!response.ok)
    throw new Error(
      (await response.json()).error || 'PDF se nepodařilo vytvořit.',
    );
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'prezencni-listina.pdf';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
type Data = {
  sessions: TrainingSessionRow[];
  members: TrainingMember[];
  summary: {
    count: number;
    minutes: number;
    attendances: number;
    last: string | null;
  };
};
const emptyFilters = {
  year: '',
  month: '',
  category: '',
  topicId: '',
  instructor: '',
  trainingType: '',
  status: '',
  search: '',
};

export function TrainingModule({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<'HOME' | 'TOPICS' | 'ARCHIVE'>('HOME');
  const [data, setData] = useState<Data | null>(null),
    [topics, setTopics] = useState<TrainingTopicRow[]>([]);
  const [filters, setFilters] = useState(emptyFilters),
    [revision, setRevision] = useState(0),
    [error, setError] = useState('');
  const [editor, setEditor] = useState<TrainingSessionRow | 'NEW' | null>(null),
    [detail, setDetail] = useState<TrainingSessionRow | null>(null);
  const [topicEditor, setTopicEditor] = useState<
    TrainingTopicRow | 'NEW' | null
  >(null);
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams(
    Object.entries(view === 'ARCHIVE' ? filters : {}).filter(
      ([, value]) => value,
    ),
  ).toString();
  useEffect(() => {
    let current = true;
    Promise.all([
      api<Data>('/api/training/sessions?' + query),
      api<TrainingTopicRow[]>('/api/training/topics'),
    ])
      .then(([nextData, nextTopics]) => {
        if (current) {
          setData(nextData);
          setTopics(nextTopics);
          setError('');
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [query, revision]);
  const refresh = () => {
    setRevision((r) => r + 1);
  };
  const action = async (run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Operace se nezdařila.');
    } finally {
      setBusy(false);
    }
  };
  const edit = (s: TrainingSessionRow) => {
    if (
      s.status === 'COMPLETED' &&
      !window.confirm(
        'Upravujete již dokončený záznam odborné přípravy. Pokračovat?',
      )
    )
      return;
    setDetail(null);
    setEditor(s);
  };
  const remove = (s: TrainingSessionRow) => {
    if (
      !window.confirm(
        s.status === 'COMPLETED'
          ? 'Trvale odstranit dokončený záznam odborné přípravy?\n' +
              day(s.date) +
              '\nTuto akci nelze vrátit zpět.'
          : 'Odstranit návrh školení z ' + day(s.date) + '?',
      )
    )
      return;
    void action(async () => {
      await api('/api/training/sessions/' + s.id, 'DELETE', {
        confirmed: true,
        completedAcknowledged: s.status === 'COMPLETED',
      });
      setDetail(null);
      refresh();
      notify('Školení bylo odstraněno.');
    });
  };
  const categories = [...new Set(topics.map((t) => t.category))].sort((a, b) =>
    a.localeCompare(b, 'cs'),
  );
  const sessions =
    view === 'HOME' ? data?.sessions.slice(0, 8) : data?.sessions;
  return (
    <div className="module-stack training-module">
      <div className="module-title">
        <div>
          <span className="section-kicker">Evidence jednotky</span>
          <h2>Školení / Odborná příprava</h2>
        </div>
        <Button
          className="primary-action"
          disabled={!data}
          onClick={() => setEditor('NEW')}
        >
          + Nové školení
        </Button>
      </div>
      <div className="training-summary">
        <article>
          <span>Školení letos</span>
          <strong>{data?.summary.count ?? '—'}</strong>
          <small>Dokončená školení</small>
        </article>
        <article>
          <span>Celková časová dotace letos</span>
          <strong>
            {data
              ? (data.summary.minutes / 60).toLocaleString('cs-CZ', {
                  maximumFractionDigits: 1,
                }) + ' h'
              : '—'}
          </strong>
        </article>
        <article>
          <span>Počet účastí členů</span>
          <strong>{data?.summary.attendances ?? '—'}</strong>
          <small>Přítomní na dokončených školeních letos</small>
        </article>
        <article>
          <span>Poslední školení</span>
          <strong>{data?.summary.last ? day(data.summary.last) : '—'}</strong>
        </article>
      </div>
      <div className="training-tabs">
        {(
          [
            ['HOME', 'Přehled'],
            ['TOPICS', 'Témata'],
            ['ARCHIVE', 'Archiv školení'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={view === key ? 'default' : 'outline'}
            onClick={() => setView(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="training-error">
          {error}
        </p>
      )}
      {!data && !error && <p>Načítám školení…</p>}
      {view === 'TOPICS' ? (
        <TopicLibrary
          topics={topics}
          onEdit={setTopicEditor}
          onDelete={(topic) => {
            if (
              !window.confirm(
                'Odstranit téma „' +
                  topic.name +
                  '“? Použité téma bude pouze deaktivováno.',
              )
            )
              return;
            void action(async () => {
              const result = await api<{ deactivated: boolean }>(
                '/api/training/topics/' + topic.id,
                'DELETE',
              );
              refresh();
              notify(
                result.deactivated
                  ? 'Téma bylo deaktivováno.'
                  : 'Téma bylo odstraněno.',
              );
            });
          }}
        />
      ) : (
        <article className="panel">
          <h3>{view === 'HOME' ? 'Poslední školení' : 'Archiv školení'}</h3>
          {view === 'ARCHIVE' && (
            <div className="training-filters">
              <label>
                Rok
                <input
                  type="number"
                  min="2000"
                  max="2200"
                  placeholder="Všechny roky"
                  value={filters.year}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      year: e.target.value,
                      month: e.target.value ? filters.month : '',
                    })
                  }
                />
              </label>
              <label>
                Měsíc
                <select
                  disabled={!filters.year}
                  value={filters.month}
                  onChange={(e) =>
                    setFilters({ ...filters, month: e.target.value })
                  }
                >
                  <option value="">Celý rok</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {new Intl.DateTimeFormat('cs-CZ', {
                        month: 'long',
                      }).format(new Date(2026, i, 1))}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kategorie
                <select
                  value={filters.category}
                  onChange={(e) =>
                    setFilters({ ...filters, category: e.target.value })
                  }
                >
                  <option value="">Všechny kategorie</option>
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Téma
                <select
                  value={filters.topicId}
                  onChange={(e) =>
                    setFilters({ ...filters, topicId: e.target.value })
                  }
                >
                  <option value="">Všechna témata</option>
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.category} / {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Školitel
                <input
                  value={filters.instructor}
                  onChange={(e) =>
                    setFilters({ ...filters, instructor: e.target.value })
                  }
                />
              </label>
              <label>
                Forma
                <select
                  value={filters.trainingType}
                  onChange={(e) =>
                    setFilters({ ...filters, trainingType: e.target.value })
                  }
                >
                  <option value="">Všechny formy</option>
                  {Object.entries(trainingTypes).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Stav
                <select
                  value={filters.status}
                  onChange={(e) =>
                    setFilters({ ...filters, status: e.target.value })
                  }
                >
                  <option value="">Všechny stavy</option>
                  {Object.entries(trainingStatuses).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hledat téma
                <input
                  value={filters.search}
                  onChange={(e) =>
                    setFilters({ ...filters, search: e.target.value })
                  }
                />
              </label>
            </div>
          )}
          <div className="training-session-list">
            {sessions?.map((s) => (
              <article key={s.id}>
                <div>
                  <strong>{day(s.date)}</strong>
                  <span className={'training-status ' + s.status}>
                    {trainingStatuses[s.status]}
                  </span>
                </div>
                <div className="training-session-info">
                  <strong>
                    {s.topics.map((t) => t.nameSnapshot).join(' + ')}
                  </strong>
                  <span>
                    {s.instructorName} · {trainingTypes[s.trainingType]} ·{' '}
                    {s.durationMinutes} min · Přítomní{' '}
                    {
                      s.participants.filter((p) => p.status === 'PRESENT')
                        .length
                    }{' '}
                    / {s.participants.length}
                  </span>
                </div>
                <div className="training-actions">
                  <Button variant="outline" onClick={() => setDetail(s)}>
                    Detail
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void action(() => downloadPdf(s.id))}
                  >
                    Prezenční listina PDF
                  </Button>
                  <Button variant="ghost" onClick={() => edit(s)}>
                    Upravit
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {data && !sessions?.length && (
            <p className="panel-help">
              Zatím zde není žádné školení odpovídající výběru.
            </p>
          )}
        </article>
      )}
      {editor && data && (
        <SessionEditor
          key={editor === 'NEW' ? 'new' : editor.id}
          session={editor === 'NEW' ? null : editor}
          topics={topics}
          members={data.members}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
            notify('Školení bylo uloženo.');
          }}
        />
      )}
      {topicEditor && (
        <TopicEditor
          key={topicEditor === 'NEW' ? 'new' : topicEditor.id}
          topic={topicEditor === 'NEW' ? null : topicEditor}
          onClose={() => setTopicEditor(null)}
          onSaved={() => {
            setTopicEditor(null);
            refresh();
            notify('Téma bylo uloženo.');
          }}
        />
      )}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="training-dialog">
          <DialogHeader>
            <DialogTitle>Detail školení</DialogTitle>
            <DialogDescription>
              Evidence odborné přípravy a docházky.
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <dl className="training-detail">
                <dt>Datum</dt>
                <dd>{day(detail.date)}</dd>
                <dt>Čas</dt>
                <dd>
                  {clock(detail.startTime)} – {clock(detail.endTime)}
                </dd>
                <dt>Dotace</dt>
                <dd>{detail.durationMinutes} min</dd>
                <dt>Místo</dt>
                <dd>{detail.location || '—'}</dd>
                <dt>Forma</dt>
                <dd>{trainingTypes[detail.trainingType]}</dd>
                <dt>Školitel</dt>
                <dd>{detail.instructorName}</dd>
                <dt>Stav</dt>
                <dd>{trainingStatuses[detail.status]}</dd>
              </dl>
              <h3>Témata odborné přípravy</h3>
              <TrainingTopicGroups topics={detail.topics} />
              {detail.notes && <p className="training-notes">{detail.notes}</p>}
              <h3>Účastníci</h3>
              <div className="training-attendance">
                {detail.participants.map((p) => (
                  <div key={p.memberId}>
                    <strong>{p.nameSnapshot}</strong>
                    <span className={'attendance-' + p.status}>
                      {attendanceLabels[p.status]}
                    </span>
                    {p.note && <small>{p.note}</small>}
                  </div>
                ))}
              </div>
              <div className="training-actions">
                <Button
                  disabled={busy}
                  onClick={() => void action(() => downloadPdf(detail.id))}
                >
                  Vygenerovat prezenční listinu
                </Button>
                <Button variant="outline" onClick={() => edit(detail)}>
                  Upravit
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => remove(detail)}
                >
                  Smazat školení
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TrainingTopicGroups({
  topics,
}: {
  topics: TrainingSessionRow['topics'];
}) {
  return (
    <div className="training-topic-groups">
      {[...new Set(topics.map((topic) => topic.categorySnapshot))].map(
        (category) => (
          <section key={category}>
            <strong>{category}</strong>
            {[
              ...new Set(
                topics
                  .filter((topic) => topic.categorySnapshot === category)
                  .map((topic) => topic.subcategorySnapshot),
              ),
            ].map((subcategory) => (
              <div key={subcategory}>
                <b>{subcategory}</b>
                <ul>
                  {topics
                    .filter(
                      (topic) =>
                        topic.categorySnapshot === category &&
                        topic.subcategorySnapshot === subcategory,
                    )
                    .map((topic) => (
                      <li key={topic.topicId}>{topic.nameSnapshot}</li>
                    ))}
                </ul>
              </div>
            ))}
          </section>
        ),
      )}
    </div>
  );
}

function TopicLibrary({
  topics,
  onEdit,
  onDelete,
}: {
  topics: TrainingTopicRow[];
  onEdit: (t: TrainingTopicRow | 'NEW') => void;
  onDelete: (t: TrainingTopicRow) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = topics.filter((t) => topicMatchesSearch(t, search));
  return (
    <article className="panel">
      <div className="training-actions">
        <h3>Knihovna témat · Témat: {topics.length}</h3>
        <input
          aria-label="Hledat téma"
          placeholder="Hledat téma nebo kategorii"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {!topics.length && (
        <p>
          Knihovna zatím neobsahuje témata. Spusťte připravený import knihovny
          při nasazení.
        </p>
      )}
      {[...new Set(filtered.map((t) => t.category))].map((category) => (
        <details
          key={category}
          className="training-category"
          open={search ? true : undefined}
        >
          <summary>
            {category.toLocaleUpperCase('cs-CZ')} (
            {filtered.filter((t) => t.category === category).length})
          </summary>
          {[
            ...new Set(
              filtered
                .filter((t) => t.category === category)
                .map((t) => t.subcategory),
            ),
          ].map((subcategory) => (
            <details
              key={subcategory}
              className="training-subcategory"
              open={search ? true : undefined}
            >
              <summary>
                {subcategory} (
                {
                  filtered.filter(
                    (t) =>
                      t.category === category && t.subcategory === subcategory,
                  ).length
                }
                )
              </summary>
              {filtered
                .filter(
                  (t) =>
                    t.category === category && t.subcategory === subcategory,
                )
                .map((t) => (
                  <div className="training-topic" key={t.id}>
                    <div>
                      <strong>{t.name}</strong>
                      <small>
                        {t.code} · {t.source}
                      </small>
                      {t.sourceUrl && (
                        <a href={t.sourceUrl} target="_blank" rel="noreferrer">
                          Zdroj
                        </a>
                      )}
                    </div>
                    <div className="training-actions">
                      <Button variant="outline" onClick={() => onEdit(t)}>
                        Upravit
                      </Button>
                      <Button variant="ghost" onClick={() => onDelete(t)}>
                        Deaktivovat
                      </Button>
                    </div>
                  </div>
                ))}
            </details>
          ))}
        </details>
      ))}
    </article>
  );
}

function TopicEditor({
  topic,
  onClose,
  onSaved,
}: {
  topic: TrainingTopicRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    code: topic?.code ?? '',
    name: topic?.name ?? '',
    category: topic?.category ?? '',
    subcategory: topic?.subcategory ?? '',
    description: topic?.description ?? '',
    source: topic?.source ?? '',
    sourceUrl: topic?.sourceUrl ?? '',
    sourceType: topic?.sourceType ?? 'INTERNAL',
    active: topic?.active ?? true,
    sortOrder: topic?.sortOrder ?? 0,
  });
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api(
        '/api/training/topics' + (topic ? '/' + topic.id : ''),
        topic ? 'PATCH' : 'POST',
        form,
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="training-dialog">
        <DialogHeader>
          <DialogTitle>{topic ? 'Upravit téma' : 'Nové téma'}</DialogTitle>
          <DialogDescription>
            Použité názvy zůstanou zachované v archivu školení.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="training-form"
        >
          {(
            [
              ['name', 'Název'],
              ['code', 'Stabilní kód'],
              ['category', 'Kategorie'],
              ['subcategory', 'Podkategorie'],
              ['source', 'Zdroj'],
              ['sourceUrl', 'URL zdroje'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                required={['name', 'code', 'category', 'subcategory'].includes(
                  key,
                )}
                type={key === 'sourceUrl' ? 'url' : 'text'}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            Typ zdroje
            <select
              value={form.sourceType}
              onChange={(e) =>
                setForm({
                  ...form,
                  sourceType: e.target.value as typeof form.sourceType,
                })
              }
            >
              <option value="INTERNAL">Interní</option>
              <option value="HASICI_VZDELAVANI">HasičiVzdělávání</option>
              <option value="OTHER">Jiný</option>
            </select>
          </label>
          <label>
            Pořadí
            <input
              type="number"
              value={form.sortOrder}
              onChange={(e) =>
                setForm({ ...form, sortOrder: Number(e.target.value) })
              }
            />
          </label>
          <label className="training-check">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Aktivní téma
          </label>
          <label className="training-wide">
            Stručná poznámka
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          {error && (
            <p role="alert" className="training-error training-wide">
              {error}
            </p>
          )}
          <div className="training-actions training-wide">
            <Button type="button" variant="outline" onClick={onClose}>
              Zrušit
            </Button>
            <Button type="submit" disabled={saving}>
              Uložit téma
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SessionEditor({
  session,
  topics,
  members,
  onClose,
  onSaved,
}: {
  session: TrainingSessionRow | null;
  topics: TrainingTopicRow[];
  members: TrainingMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(
    session?.date.slice(0, 10) ?? toLocalDateTimeInput(new Date()).slice(0, 10),
  );
  const [start, setStart] = useState(
    session?.startTime
      ? toLocalDateTimeInput(new Date(session.startTime)).slice(11)
      : '',
  );
  const [end, setEnd] = useState(
    session?.endTime
      ? toLocalDateTimeInput(new Date(session.endTime)).slice(11)
      : '',
  );
  const [duration, setDuration] = useState(session?.durationMinutes ?? 120);
  const [type, setType] = useState(session?.trainingType ?? 'THEORY'),
    [location, setLocation] = useState(session?.location ?? ''),
    [notes, setNotes] = useState(session?.notes ?? '');
  const [instructorId, setInstructorId] = useState(
      session?.instructorMemberId ?? '',
    ),
    [instructor, setInstructor] = useState(session?.instructorName ?? '');
  const [selected, setSelected] = useState(
    session?.topics.map((t) => t.topicId) ?? [],
  );
  const [participants, setParticipants] = useState(
    session?.participants.map((p) => ({
      memberId: p.memberId,
      status: p.status,
      note: p.note ?? '',
      name: p.nameSnapshot,
    })) ??
      members.map((m) => ({
        memberId: m.id,
        status: 'ABSENT' as keyof typeof attendanceLabels,
        note: '',
        name: name(m),
      })),
  );
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const updateTime = (nextStart: string, nextEnd: string, nextDate = date) => {
    setStart(nextStart);
    setEnd(nextEnd);
    const from = nextStart
        ? fromLocalDateTimeInput(nextDate + 'T' + nextStart)
        : null,
      to = nextEnd ? fromLocalDateTimeInput(nextDate + 'T' + nextEnd) : null;
    if (from && to && to > from)
      setDuration((to.getTime() - from.getTime()) / 60000);
  };
  const save = async (status: 'DRAFT' | 'COMPLETED') => {
    setSaving(true);
    setError('');
    try {
      const from = start ? fromLocalDateTimeInput(date + 'T' + start) : null,
        to = end ? fromLocalDateTimeInput(date + 'T' + end) : null;
      if (
        (start &&
          (!from || toLocalDateTimeInput(from) !== date + 'T' + start)) ||
        (end && (!to || toLocalDateTimeInput(to) !== date + 'T' + end))
      )
        throw new Error('Zadaný čas v Europe/Prague neexistuje.');
      await api(
        '/api/training/sessions' + (session ? '/' + session.id : ''),
        session ? 'PATCH' : 'POST',
        {
          date,
          startTime: from?.toISOString() ?? null,
          endTime: to?.toISOString() ?? null,
          durationMinutes: duration,
          location,
          trainingType: type,
          instructorName: instructor,
          instructorMemberId: instructorId || null,
          notes,
          status,
          topicIds: selected,
          participants: participants.map(({ memberId, status, note }) => ({
            memberId,
            status,
            note,
          })),
          completedAcknowledged: session?.status === 'COMPLETED',
        },
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const visibleTopics = topics.filter(
    (t) =>
      (t.active || selected.includes(t.id)) &&
      (!category || t.category === category) &&
      topicMatchesSearch(t, search),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="training-dialog training-editor">
        <DialogHeader>
          <DialogTitle>
            {session ? 'Upravit školení' : 'Nové školení'}
          </DialogTitle>
          <DialogDescription>
            Vyberte témata a zaznamenejte skutečnou účast členů. Podpisy se
            doplňují na vytištěný dokument.
          </DialogDescription>
        </DialogHeader>
        <div className="training-form">
          <label>
            Datum
            <input
              type="date"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                updateTime(start, end, e.target.value);
              }}
            />
          </label>
          <label>
            Čas od
            <input
              type="time"
              value={start}
              onChange={(e) => updateTime(e.target.value, end)}
            />
          </label>
          <label>
            Čas do
            <input
              type="time"
              value={end}
              onChange={(e) => updateTime(start, e.target.value)}
            />
          </label>
          <label>
            Časová dotace (minuty)
            <input
              type="number"
              min="1"
              required
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
            <small>
              {(duration / 60).toLocaleString('cs-CZ', {
                maximumFractionDigits: 2,
              })}{' '}
              hodin · lze upravit ručně
            </small>
          </label>
          <label>
            Forma
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              {Object.entries(trainingTypes).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Místo
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label>
            Školitel z jednotky
            <select
              value={instructorId}
              onChange={(e) => {
                setInstructorId(e.target.value);
                setInstructor(
                  e.target.value
                    ? name(members.find((m) => m.id === e.target.value)!)
                    : '',
                );
              }}
            >
              <option value="">Externí školitel / zadat jméno</option>
              {session?.instructorMemberId &&
                !members.some((m) => m.id === session.instructorMemberId) && (
                  <option value={session.instructorMemberId}>
                    {session.instructorName}
                  </option>
                )}
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {name(m)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Jméno školitele
            <input
              required
              readOnly={!!instructorId}
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
            />
          </label>
          <section className="training-wide">
            <h3>Vybraná témata: {selected.length}</h3>
            <div className="training-topic-selection">
              {selected.map((id) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setSelected(selected.filter((s) => s !== id))}
                >
                  {topics.find((t) => t.id === id)?.name ??
                    session?.topics.find((t) => t.topicId === id)
                      ?.nameSnapshot}{' '}
                  ×
                </button>
              ))}
            </div>
            <div className="training-filters">
              <label>
                Hledat téma
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                Kategorie
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Všechny kategorie</option>
                  {[...new Set(topics.map((t) => t.category))].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="training-topic-picker">
              {[...new Set(visibleTopics.map((t) => t.category))].map((c) => (
                <details key={c} open={!!search || !!category}>
                  <summary>
                    {c.toLocaleUpperCase('cs-CZ')} (
                    {visibleTopics.filter((t) => t.category === c).length})
                  </summary>
                  {[
                    ...new Set(
                      visibleTopics
                        .filter((t) => t.category === c)
                        .map((t) => t.subcategory),
                    ),
                  ].map((subcategory) => {
                    const group = visibleTopics.filter(
                      (t) => t.category === c && t.subcategory === subcategory,
                    );
                    const allSelected = group.every((t) =>
                      selected.includes(t.id),
                    );
                    return (
                      <details
                        key={subcategory}
                        className="training-subcategory"
                        open={!!search || !!category}
                      >
                        <summary>
                          <span>
                            {subcategory} ({group.length})
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setSelected(
                                allSelected
                                  ? selected.filter(
                                      (id) =>
                                        !group.some((topic) => topic.id === id),
                                    )
                                  : [
                                      ...new Set([
                                        ...selected,
                                        ...group.map((topic) => topic.id),
                                      ]),
                                    ],
                              );
                            }}
                          >
                            {allSelected ? 'Odebrat vše' : 'Vybrat vše'}
                          </button>
                        </summary>
                        {group.map((t) => (
                          <label className="training-check" key={t.id}>
                            <input
                              type="checkbox"
                              checked={selected.includes(t.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, t.id]
                                    : selected.filter((id) => id !== t.id),
                                )
                              }
                            />
                            {t.name}
                          </label>
                        ))}
                      </details>
                    );
                  })}
                </details>
              ))}
            </div>
            {!topics.length && (
              <p>Knihovna témat zatím nebyla načtena z databáze.</p>
            )}
          </section>
          <section className="training-wide">
            <h3>Účastníci</h3>
            <div className="training-actions">
              <Button
                variant="outline"
                onClick={() =>
                  setParticipants(
                    participants.map((p) => ({ ...p, status: 'PRESENT' })),
                  )
                }
              >
                Označit všechny přítomné
              </Button>
              {members.some(
                (m) => !participants.some((p) => p.memberId === m.id),
              ) && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setParticipants([
                      ...participants,
                      ...members
                        .filter(
                          (m) => !participants.some((p) => p.memberId === m.id),
                        )
                        .map((m) => ({
                          memberId: m.id,
                          name: name(m),
                          status: 'ABSENT' as const,
                          note: '',
                        })),
                    ])
                  }
                >
                  Doplnit aktivní členy
                </Button>
              )}
            </div>
            <div className="training-attendance">
              {participants.map((p, index) => (
                <div key={p.memberId}>
                  <strong>{p.name}</strong>
                  <select
                    aria-label={'Účast ' + p.name}
                    value={p.status}
                    onChange={(e) =>
                      setParticipants(
                        participants.map((p, i) =>
                          i === index
                            ? {
                                ...p,
                                status: e.target.value as typeof p.status,
                              }
                            : p,
                        ),
                      )
                    }
                  >
                    {Object.entries(attendanceLabels).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={'Poznámka ' + p.name}
                    placeholder="Poznámka k účasti"
                    value={p.note}
                    onChange={(e) =>
                      setParticipants(
                        participants.map((p, i) =>
                          i === index ? { ...p, note: e.target.value } : p,
                        ),
                      )
                    }
                  />
                  <button
                    aria-label={'Odebrat ' + p.name}
                    onClick={() =>
                      setParticipants(
                        participants.filter(
                          (p) => p.memberId !== participants[index].memberId,
                        ),
                      )
                    }
                  >
                    Odebrat
                  </button>
                </div>
              ))}
            </div>
          </section>
          <label className="training-wide">
            Obsah / poznámka
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="training-error training-wide">
              {error}
            </p>
          )}
          <div className="training-actions training-wide">
            <Button variant="outline" disabled={saving} onClick={onClose}>
              Zrušit
            </Button>
            {session?.status !== 'COMPLETED' && (
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => void save('DRAFT')}
              >
                Uložit jako návrh
              </Button>
            )}
            <Button disabled={saving} onClick={() => void save('COMPLETED')}>
              {saving
                ? 'Ukládám…'
                : session?.status === 'COMPLETED'
                  ? 'Uložit změny'
                  : 'Dokončit školení'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MemberTrainingHistory({ memberId }: { memberId: string }) {
  const [sessions, setSessions] = useState<TrainingSessionRow[] | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    api<Data>('/api/training/sessions?memberId=' + encodeURIComponent(memberId))
      .then((data) => {
        if (current) setSessions(data.sessions);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [memberId]);
  return (
    <section className="detail-section training-history">
      <span className="section-kicker">Odborná příprava</span>
      {error ? (
        <p role="alert">{error}</p>
      ) : sessions === null ? (
        <p>Načítám odbornou přípravu…</p>
      ) : !sessions.length ? (
        <p>Dosud bez záznamu odborné přípravy.</p>
      ) : (
        sessions.map((s) => (
          <div key={s.id}>
            <strong>
              {day(s.date)} · {trainingStatuses[s.status]}
            </strong>
            <span>{s.topics.map((t) => t.nameSnapshot).join(' + ')}</span>
            <small>
              {s.durationMinutes} min ·{' '}
              {
                attendanceLabels[
                  s.participants.find((p) => p.memberId === memberId)!.status
                ]
              }
            </small>
          </div>
        ))
      )}
    </section>
  );
}
