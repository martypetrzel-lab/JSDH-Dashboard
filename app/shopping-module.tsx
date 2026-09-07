'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, Pencil, ShoppingCart, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { shoppingDeadlineState, shoppingSummary, sortShoppingItems, type ShoppingRow } from '@/lib/shopping';

const money = (value: number) => `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`;
const czechDate = (value: string | null) => value ? value.split('-').reverse().join('.') : '—';
const empty = { name: '', estimatedPrice: '', purchaseDeadline: '', store: '', url: '', note: '' };

type Props = {
  initialItems: ShoppingRow[];
  onChange: (items: ShoppingRow[]) => void;
  notify: (message: string) => void;
};

export function ShoppingModule({ initialItems, onChange, notify }: Props) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<'ALL' | 'PLANNED' | 'PURCHASED'>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ShoppingRow | null | undefined>(undefined);
  const [form, setForm] = useState(empty);
  const [purchasing, setPurchasing] = useState<ShoppingRow | null>(null);
  const [purchasedPrice, setPurchasedPrice] = useState('');
  const [busy, setBusy] = useState(false);

  const publish = (next: ShoppingRow[]) => {
    setItems(next);
    onChange(next);
  };
  const summary = shoppingSummary(items);
  const visible = useMemo(
    () => sortShoppingItems(items).filter((item) =>
      (filter === 'ALL' || item.status === filter)
      && `${item.name} ${item.store}`.toLocaleLowerCase('cs').includes(search.toLocaleLowerCase('cs')),
    ),
    [items, filter, search],
  );
  const actualPrice = purchasedPrice.trim() === '' ? null : Number(purchasedPrice);
  const actualPriceValid = actualPrice !== null && Number.isInteger(actualPrice) && actualPrice >= 0;

  const open = (item?: ShoppingRow) => {
    setEditing(item ?? null);
    setForm(item ? {
      name: item.name,
      estimatedPrice: item.estimatedPrice?.toString() ?? '',
      purchaseDeadline: item.purchaseDeadline ?? '',
      store: item.store,
      url: item.url,
      note: item.note,
    } : empty);
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        ...form,
        estimatedPrice: form.estimatedPrice === '' ? null : Number(form.estimatedPrice),
        purchaseDeadline: form.purchaseDeadline || null,
      };
      const response = await fetch(editing ? `/api/shopping/${editing.id}` : '/api/shopping', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      publish(editing ? items.map((item) => item.id === editing.id ? body.item : item) : [...items, body.item]);
      setEditing(undefined);
      notify(editing ? 'Položka byla upravena.' : 'Položka byla přidána do seznamu.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Položku se nepodařilo uložit.');
    } finally {
      setBusy(false);
    }
  };

  const confirmPurchase = async () => {
    if (!purchasing || !actualPriceValid) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/shopping/${purchasing.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'PURCHASED', purchasedPrice: actualPrice }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      publish(items.map((item) => item.id === purchasing.id ? body.item : item));
      setPurchasing(null);
      setPurchasedPrice('');
      notify('Nákup byl potvrzen včetně skutečné ceny.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Nákup se nepodařilo potvrdit.');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (item: ShoppingRow) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/shopping/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'PLANNED' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      publish(items.map((value) => value.id === item.id ? body.item : value));
      notify('Položka byla vrácena do plánu.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Položku se nepodařilo vrátit do plánu.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: ShoppingRow) => {
    if (!window.confirm(`Opravdu chcete odstranit položku ${item.name}?`)) return;
    const response = await fetch(`/api/shopping/${item.id}`, { method: 'DELETE' });
    if (!response.ok) {
      notify('Položku se nepodařilo odstranit.');
      return;
    }
    publish(items.filter((value) => value.id !== item.id));
    notify('Položka byla odstraněna.');
  };

  return <div className="module-stack">
    <div className="module-title">
      <div><span className="section-kicker">Evidence vybavení</span><h2>Seznam nákupu</h2></div>
      <Button className="primary-action compact" onClick={() => open()}>+ Přidat položku</Button>
    </div>
    <div className="shopping-summary">
      <article><span>K nákupu</span><strong>{summary.count} položek</strong></article>
      <article><span>Orientační cena celkem</span><strong>{money(summary.total)}</strong></article>
      <article><span>Utraceno celkem</span><strong>{money(summary.spent)}</strong></article>
      <article><span>Po termínu</span><strong>{summary.overdue}</strong></article>
      <article><span>Nejbližší nákup</span><strong>{czechDate(summary.nearest)}</strong></article>
    </div>
    <article className="panel shopping-panel">
      <div className="shopping-toolbar">
        <div className="shopping-filters">
          {([['ALL', 'Vše'], ['PLANNED', 'K nákupu'], ['PURCHASED', 'Zakoupeno']] as const).map(([key, label]) =>
            <Button key={key} variant={filter === key ? 'default' : 'outline'} size="sm" onClick={() => setFilter(key)}>{label}</Button>,
          )}
        </div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hledat položku nebo obchod…" />
      </div>
      {visible.length ? <div className="shopping-list">{visible.map((item) => {
        const deadline = shoppingDeadlineState(item);
        return <div className={`shopping-item ${item.status === 'PURCHASED' ? 'purchased' : ''}`} key={item.id}>
          <div className="shopping-main"><ShoppingCart /><span>
            <strong>{item.name}</strong>
            {item.status === 'PURCHASED' ? <>
              <small className="shopping-paid-price">Nakoupeno za: {item.purchasedPrice === null ? 'Cena neuvedena' : money(item.purchasedPrice)}</small>
              <small>Zakoupeno dne: {czechDate(item.purchasedAt)}</small>
              {item.store && <small>{item.store}</small>}
              {item.estimatedPrice !== null && <small>Původní odhad: {money(item.estimatedPrice)}</small>}
            </> : <small>{item.estimatedPrice === null ? 'Cena neuvedena' : money(item.estimatedPrice)} · Termín: {czechDate(item.purchaseDeadline)}{item.store ? ` · ${item.store}` : ''}</small>}
            {item.note && <small>{item.note}</small>}
          </span></div>
          <div className="shopping-state">{item.status === 'PURCHASED'
            ? <Badge>Zakoupeno</Badge>
            : deadline === 'overdue' ? <Badge className="shopping-overdue">PO TERMÍNU</Badge>
              : deadline === 'soon' ? <Badge className="shopping-soon">Blíží se termín</Badge>
                : <Badge variant="outline">Plánováno</Badge>}</div>
          <div className="shopping-actions">
            {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink />Otevřít odkaz</a>}
            <Button variant="ghost" size="sm" onClick={() => open(item)}><Pencil />Upravit</Button>
            {item.status === 'PLANNED'
              ? <Button variant="outline" size="sm" onClick={() => { setPurchasing(item); setPurchasedPrice(''); }}>Zakoupeno</Button>
              : <Button variant="outline" size="sm" disabled={busy} onClick={() => void reopen(item)}>Vrátit do plánu</Button>}
            <Button variant="ghost" size="sm" className="delete-action" onClick={() => void remove(item)}><Trash2 />Smazat</Button>
          </div>
        </div>;
      })}</div> : <div className="empty-absence"><ShoppingCart /><strong>{summary.count === 0 ? 'Seznam nákupu je prázdný' : 'Žádné položky neodpovídají filtru'}</strong></div>}
    </article>

    <Dialog open={editing !== undefined} onOpenChange={(isOpen) => { if (!isOpen) setEditing(undefined); }}>
      <DialogContent className="shopping-dialog">
        <DialogHeader><DialogTitle>{editing ? 'Upravit položku' : 'Přidat položku'}</DialogTitle><DialogDescription>Evidence plánovaného nákupu pro jednotku.</DialogDescription></DialogHeader>
        <div className="shopping-form">
          <label>Položka *<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Proudnice" /></label>
          <label>Orientační cena<input type="number" min="0" step="1" value={form.estimatedPrice} onChange={(event) => setForm({ ...form, estimatedPrice: event.target.value })} placeholder="1000" /></label>
          <label>Termín nákupu<input type="date" value={form.purchaseDeadline} onChange={(event) => setForm({ ...form, purchaseDeadline: event.target.value })} /></label>
          <label>Kde<input value={form.store} onChange={(event) => setForm({ ...form, store: event.target.value })} placeholder="Výzbrojna" /></label>
          <label>Odkaz<input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://…" /></label>
          <label>Poznámka<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setEditing(undefined)}>Zrušit</Button><Button disabled={busy} onClick={() => void save()}>{editing ? 'Uložit změny' : 'Přidat do seznamu'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={purchasing !== null} onOpenChange={(isOpen) => { if (!isOpen) { setPurchasing(null); setPurchasedPrice(''); } }}>
      <DialogContent className="shopping-purchase-dialog">
        <DialogHeader><DialogTitle>Potvrdit nákup</DialogTitle><DialogDescription>Zadejte skutečnou cenu, za kterou byla položka nakoupena.</DialogDescription></DialogHeader>
        {purchasing && <div className="shopping-purchase-form">
          <div><span>Položka</span><strong>{purchasing.name}</strong></div>
          <div><span>Orientační cena</span><strong>{purchasing.estimatedPrice === null ? 'Neuvedena' : money(purchasing.estimatedPrice)}</strong></div>
          <label>Skutečně nakoupeno za:<span className="price-input"><input required type="number" min="0" step="1" inputMode="numeric" value={purchasedPrice} onChange={(event) => setPurchasedPrice(event.target.value)} placeholder="0" /><b>Kč</b></span></label>
          {purchasedPrice !== '' && !actualPriceValid && <small className="field-error">Zadejte celé nezáporné číslo.</small>}
        </div>}
        <DialogFooter><Button variant="outline" onClick={() => { setPurchasing(null); setPurchasedPrice(''); }}>Zrušit</Button><Button disabled={busy || !actualPriceValid} onClick={() => void confirmPurchase()}>Potvrdit nákup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
