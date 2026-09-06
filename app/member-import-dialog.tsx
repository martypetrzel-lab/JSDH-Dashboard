'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MemberRow } from '@/lib/member-data';
import { parseMemberTable } from '@/lib/member-import';

type Duplicate = { kind: 'database' | 'input'; memberId?: string; name: string };
type DuplicateAction = 'skip' | 'update' | 'create';

export function MemberImportDialog({ open, onOpenChange, onImported, notify }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (members: MemberRow[]) => void;
  notify: (message: string) => void;
}) {
  const [source, setSource] = useState('');
  const [duplicates, setDuplicates] = useState<Record<string, Duplicate>>({});
  const [actions, setActions] = useState<Record<string, DuplicateAction>>({});
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const rows = useMemo(() => parseMemberTable(source), [source]);

  useEffect(() => {
    if (!open || !rows.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/members/import/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows }),
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setDuplicates(body.duplicates ?? {});
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) notify('Kontrola duplicit se nepodařila.');
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, source]); // eslint-disable-line react-hooks/exhaustive-deps

  const actionFor = (clientId: string) => actions[clientId] ?? (duplicates[clientId] ? 'skip' : 'create');
  const importCount = rows.filter((row) => !row.errors.length && actionFor(row.clientId) !== 'skip').length;
  const errorCount = rows.filter((row) => row.errors.length).length;

  const close = (nextOpen: boolean) => {
    if (!nextOpen && !importing) { setSource(''); setDuplicates({}); setActions({}); setChecking(false); }
    onOpenChange(nextOpen);
  };

  const downloadTemplate = () => {
    const content = '\uFEFFJméno;Datum narození;Funkce;Poslední zdravotní prohlídka\r\n';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sablona-import-clenu.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const response = await fetch('/api/members/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: rows.map((row) => ({ ...row, duplicateAction: actionFor(row.clientId) })) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      onImported(body.members as MemberRow[]);
      notify(`Importováno ${body.imported} členů, přeskočeno ${body.skipped}, chyb ${body.errors}.`);
      setSource(''); setDuplicates({}); setActions({});
      onOpenChange(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Import se nepodařilo dokončit.');
    } finally { setImporting(false); }
  };

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="member-import-dialog sm:!max-w-[min(1180px,calc(100vw-2rem))]">
      <DialogHeader>
        <DialogTitle>Hromadný import členů</DialogTitle>
        <DialogDescription>Vložte čtyři sloupce z Excelu nebo Google Sheets, případně CSV oddělené středníkem či čárkou. Hlavička je nepovinná.</DialogDescription>
      </DialogHeader>
      <div className="import-dialog-body">
        <div className="import-toolbar">
          <span><FileSpreadsheet size={18}/> Pořadí: jméno, narození, funkce, poslední zdravotní prohlídka</span>
          <Button variant="outline" size="sm" onClick={downloadTemplate}><Download/> Stáhnout CSV šablonu</Button>
        </div>
        <label className="import-source">
          <span><Upload size={16}/> Vložte tabulku pomocí Ctrl+V</span>
          <textarea value={source} onChange={(event) => { const value = event.target.value; setSource(value); setDuplicates({}); setActions({}); setChecking(Boolean(parseMemberTable(value).length)); }} placeholder={'Jméno\tDatum narození\tFunkce\tPoslední zdravotní prohlídka'} />
        </label>
        <div className="import-summary">
          <span>{rows.length} {rows.length === 1 ? 'řádek' : 'řádků'} v náhledu</span>
          {checking && <span>Kontroluji duplicity…</span>}
          {!!errorCount && <span className="import-error"><AlertTriangle/> {errorCount} {errorCount === 1 ? 'chyba' : 'chyby'}</span>}
        </div>
        <div className="import-preview" aria-live="polite">
          <table>
            <thead><tr><th>Jméno</th><th>Datum narození</th><th>Hlavní funkce</th><th>Poslední zdravotní prohlídka</th><th>Zdravotní platná do</th><th>Oprávnění</th><th>DT</th><th>Stav importu</th></tr></thead>
            <tbody>{rows.length ? rows.map((row) => {
              const duplicate = duplicates[row.clientId];
              return <tr key={row.clientId} className={row.errors.length ? 'import-invalid-row' : ''}>
                <td><strong>{row.name || '—'}</strong></td><td>{row.birthDate || '—'}</td><td>{row.role || '—'}</td><td>{row.medicalExamAt || '—'}</td><td>{row.medicalValidUntil || '—'}</td><td>{row.permissions || '—'}</td><td>Ne</td>
                <td>{row.errors.length ? <span className="import-status error"><AlertTriangle/>{row.errors.join(' ')}</span> : duplicate ? <div className="duplicate-choice"><span className="import-status warning"><AlertTriangle/>Možná duplicita: {duplicate.name}</span><select aria-label={`Postup při duplicitě ${row.name}`} value={actionFor(row.clientId)} onChange={(event) => setActions((current) => ({ ...current, [row.clientId]: event.target.value as DuplicateAction }))}><option value="skip">Přeskočit</option>{duplicate.kind === 'database' && <option value="update">Aktualizovat existujícího</option>}<option value="create">Importovat jako nového</option></select></div> : <span className="import-status ready"><Check/>Připraveno</span>}</td>
              </tr>;
            }) : <tr><td colSpan={8} className="import-empty">Po vložení dat se zde zobrazí kontrolovaný náhled. Import se nespustí automaticky.</td></tr>}</tbody>
          </table>
        </div>
      </div>
      <DialogFooter className="import-dialog-footer">
        <Button variant="outline" onClick={() => close(false)} disabled={importing}>Zrušit</Button>
        <Button className="primary-action compact" onClick={() => void runImport()} disabled={!importCount || checking || importing}>{importing ? 'Importuji…' : `Importovat ${importCount} členů`}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
