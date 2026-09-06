"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Gauge,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  UserX,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { MemberRow } from "@/lib/member-data";
import {
  formatServiceDateTime,
  fromLocalDateTimeInput,
  nextServiceWeek,
  planningServiceWeek,
  serviceOperationalState,
  serviceTimeline,
  toLocalDateTimeInput,
  type ServiceTimeSettings,
} from "@/lib/service";
import type {
  DashboardReplacement,
  DashboardService,
} from "@/lib/weekly-service-data";
import {
  buildMonthlyWhatsAppMessage,
  createWhatsAppShareUrl,
} from "@/lib/whatsapp";

type Props = {
  settings: ServiceTimeSettings;
  members: MemberRow[];
  initialService: DashboardService | null;
  onServiceChange: (service: DashboardService | null) => void;
  onShare: (service: DashboardService, updated?: boolean) => void;
  notify: (message: string) => void;
};
type Interval = { from: string; to: string };
type CrewCandidate = {
  id: string;
  name: string;
  primaryRole: string;
  permissions: string[];
  dt: boolean;
  medicalValidUntil: string;
  available: boolean;
  warnings: string[];
};
type ReplacementInput = {
  assignmentId: string;
  from: string;
  to: string;
  reason: string;
};

const monthValue = (date = new Date(), timeZone = "Europe/Prague") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).format(date);
const monthTitle = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("cs-CZ", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Prague",
  }).format(new Date(Date.UTC(year, month - 1, 2)));
};

export function WeeklyPlanningModule({
  settings,
  members,
  initialService,
  onServiceChange,
  onShare,
  notify,
}: Props) {
  const initialInterval = initialService
    ? { start: new Date(initialService.from), end: new Date(initialService.to) }
    : planningServiceWeek(new Date(), settings);
  const [mode, setMode] = useState<"week" | "month">("week");
  const [week, setWeek] = useState<Interval>({
    from: initialInterval.start.toISOString(),
    to: initialInterval.end.toISOString(),
  });
  const [service, setService] = useState(initialService);
  const [busy, setBusy] = useState(false);
  const [monthDialog, setMonthDialog] = useState(false);
  const [month, setMonth] = useState(monthValue(new Date(), settings.timezone));
  const [monthServices, setMonthServices] = useState<DashboardService[]>([]);
  const [monthIntervals, setMonthIntervals] = useState<Interval[]>([]);
  const [monthErrors, setMonthErrors] = useState<
    { from: string; error: string }[]
  >([]);
  const [updatedConfirmed, setUpdatedConfirmed] = useState<Set<string>>(
    new Set(),
  );
  const [manualAfterGenerate, setManualAfterGenerate] = useState(false);
  const memberOptions = useMemo(
    () => members.map((item) => ({ id: item[5], name: item[0] })),
    [members],
  );
  const publish = (next: DashboardService | null) => {
    setService(next);
    const now = new Date();
    if (
      next &&
      next.status !== "CANCELLED" &&
      new Date(next.from) <= now &&
      now < new Date(next.to)
    )
      onServiceChange(next);
    else if (next?.status === "CANCELLED" && service?.id === next.id)
      onServiceChange(null);
  };
  const replaceEverywhere = (next: DashboardService) => {
    publish(next);
    setMonthServices((items) =>
      items.map((item) => (item.id === next.id ? next : item)),
    );
  };

  const loadWeek = async (reference: Date) => {
    setBusy(true);
    try {
      const response = await fetch(
          `/api/services?reference=${encodeURIComponent(reference.toISOString())}`,
        ),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setWeek(body.interval);
      publish(body.service ?? null);
      setMode("week");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Týden se nepodařilo načíst.",
      );
    } finally {
      setBusy(false);
    }
  };
  const generate = async (
    reference = new Date(week.from),
    confirmed = false,
    prepareManually = false,
  ) => {
    if (
      confirmed &&
      !window.confirm(
        "Opravdu chcete přelosovat již potvrzenou službu? Služba zůstane potvrzená.",
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch("/api/services/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reference: reference.toISOString() }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setWeek({ from: body.service.from, to: body.service.to });
      setManualAfterGenerate(prepareManually);
      replaceEverywhere(body.service);
      if (body.service.status === "CONFIRMED")
        setUpdatedConfirmed((ids) => new Set(ids).add(body.service.id));
      notify(
        prepareManually
          ? "Výchozí sestava je připravena k ruční úpravě."
          : service
            ? "Služba byla přelosována a znovu ověřena."
            : "Návrh služby byl vytvořen.",
      );
      if (mode === "month") await loadMonth(month);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Posádku se nepodařilo sestavit.",
      );
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (target: DashboardService) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/services/${target.id}/confirm`, {
          method: "POST",
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      replaceEverywhere(body.service);
      notify("Týdenní posádka byla potvrzena.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Posádku se nepodařilo potvrdit.",
      );
    } finally {
      setBusy(false);
    }
  };
  const loadMonth = async (value = month) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/services?month=${value}`),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMonthServices(body.services);
      setMonthIntervals(body.intervals);
      setMonthErrors([]);
      setMode("month");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Měsíční plán se nepodařilo načíst.",
      );
    } finally {
      setBusy(false);
    }
  };
  const createMonth = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/services/month-plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ month }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMonthServices(body.services);
      setMonthErrors(body.errors);
      setMonthDialog(false);
      setMode("month");
      notify(
        `Měsíční plán je připraven. Vytvořeno ${body.created} nových návrhů.`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Měsíční plán se nepodařilo vytvořit.",
      );
    } finally {
      setBusy(false);
    }
  };
  const removeService = async (
    target: DashboardService,
    confirmedAcknowledged: boolean,
  ) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/services/${target.id}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmedAcknowledged }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMonthServices((items) =>
        items.filter((item) => item.id !== target.id),
      );
      setUpdatedConfirmed((ids) => {
        const next = new Set(ids);
        next.delete(target.id);
        return next;
      });
      if (service?.id === target.id) {
        setService(null);
        onServiceChange(null);
      }
      notify("Celá týdenní služba byla odstraněna.");
      return true;
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Službu se nepodařilo odstranit.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const cancelService = async (target: DashboardService) => {
    if (
      !window.confirm(
        "Opravdu chcete zrušit tuto službu? Záznam zůstane v historii.",
      )
    )
      return;
    const reason = window.prompt("Důvod zrušení (nepovinný):", "") ?? "";
    setBusy(true);
    try {
      const response = await fetch(`/api/services/${target.id}/cancel`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      replaceEverywhere(body.service);
      notify("Služba byla zrušena a zůstává v historii.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Službu se nepodařilo zrušit.",
      );
    } finally {
      setBusy(false);
    }
  };
  const rerollMember = async (
    target: DashboardService,
    role: string,
    slot: number,
  ) => {
    if (
      target.status === "CONFIRMED" &&
      !window.confirm("Přelosovat tuto pozici v potvrzené službě?")
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(`/api/services/${target.id}/reroll-member`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role, slot }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      replaceEverywhere(body.service);
      if (body.updatedConfirmed)
        setUpdatedConfirmed((ids) => new Set(ids).add(target.id));
      notify("Člen byl přelosován a posádka znovu ověřena.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Člena se nepodařilo přelosovat.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveCrew = async (
    target: DashboardService,
    assignments: { role: string; slot: number; memberId: string }[],
  ) => {
    const changes = assignments.flatMap((item) => {
      const old = target.crew.find(
          (member) => member.roleKey === item.role && member.slot === item.slot,
        ),
        next = memberOptions.find((member) => member.id === item.memberId);
      return old && next && old.memberId !== next.id
        ? [`${old.role}: ${old.name} → ${next.name}`]
        : [];
    });
    if (!changes.length) {
      notify("Sestava neobsahuje žádnou změnu.");
      return false;
    }
    if (
      target.status === "CONFIRMED" &&
      !window.confirm(
        `Upravujete již potvrzenou službu.\n\n${changes.join("\n")}\n\nUložit změnu?`,
      )
    )
      return false;
    setBusy(true);
    try {
      const response = await fetch(`/api/services/${target.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assignments }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      replaceEverywhere(body.service);
      if (body.updatedConfirmed)
        setUpdatedConfirmed((ids) => new Set(ids).add(target.id));
      notify("Sestava byla uložena a záskoky přepočítány.");
      return true;
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Sestavu se nepodařilo uložit.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const addReplacement = async (
    target: DashboardService,
    input: ReplacementInput,
    replacementId?: string,
  ) => {
    setBusy(true);
    try {
      const url = replacementId
          ? `/api/services/${target.id}/replacements/${replacementId}`
          : `/api/services/${target.id}/replacements`,
        response = await fetch(url, {
          method: replacementId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      replaceEverywhere(body.service);
      if (target.status === "CONFIRMED")
        setUpdatedConfirmed((ids) => new Set(ids).add(target.id));
      notify(
        body.resolved
          ? "Časový záskok byl uložen."
          : "Výpadek byl uložen, ale zatím chybí vhodný náhradník.",
      );
      return true;
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Záskok se nepodařilo uložit.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const removeReplacement = async (
    target: DashboardService,
    replacement: DashboardReplacement,
  ) => {
    if (!window.confirm("Opravdu chcete tento časový záskok odstranit?"))
      return;
    setBusy(true);
    try {
      const response = await fetch(
          `/api/services/${target.id}/replacements/${replacement.id}`,
          { method: "DELETE" },
        ),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      replaceEverywhere(body.service);
      if (target.status === "CONFIRMED")
        setUpdatedConfirmed((ids) => new Set(ids).add(target.id));
      notify("Časový záskok byl odstraněn.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Záskok se nepodařilo odstranit.",
      );
    } finally {
      setBusy(false);
    }
  };
  const confirmMonth = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/services/confirm-month", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ month }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMonthServices(body.services);
      setMonthErrors(body.errors);
      notify(
        `Potvrzeno ${body.confirmed} služeb, neplatných ${body.errors.length}.`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Hromadné potvrzení se nepodařilo.",
      );
    } finally {
      setBusy(false);
    }
  };
  const shareMonth = () => {
    const confirmed = monthServices.filter(
      (item) => item.status === "CONFIRMED" && item.crew.length === 4,
    );
    if (!confirmed.length) {
      notify("Měsíční plán zatím neobsahuje žádnou potvrzenou službu.");
      return;
    }
    const message = buildMonthlyWhatsAppMessage(
      monthTitle(month),
      confirmed.map((item) => {
        const commander = item.crew.find(
            (member) => member.roleKey === "COMMANDER",
          )!,
          driver = item.crew.find((member) => member.roleKey === "DRIVER")!,
          firefighters = item.crew.filter(
            (member) => member.roleKey === "FIREFIGHTER",
          );
        return {
          from: formatServiceDateTime(
            new Date(item.from),
            settings.timezone,
          ).slice(0, 10),
          to: formatServiceDateTime(new Date(item.to), settings.timezone).slice(
            0,
            10,
          ),
          commander: commander.name,
          driver: driver.name,
          firefighters: [firefighters[0].name, firefighters[1].name] as [
            string,
            string,
          ],
        };
      }),
    );
    window.open(
      createWhatsAppShareUrl(message),
      "_blank",
      "noopener,noreferrer",
    );
  };
  const openDetail = (item: DashboardService) => {
    setWeek({ from: item.from, to: item.to });
    publish(item);
    setMode("week");
  };
  const cardProps = (item: DashboardService) => ({
    service: item,
    settings,
    busy,
    members: memberOptions,
    updated: updatedConfirmed.has(item.id),
    startInEdit:
      mode === "week" && manualAfterGenerate && item.id === service?.id,
    onDetail: mode === "month" ? () => openDetail(item) : undefined,
    onReroll: () =>
      void generate(new Date(item.from), item.status === "CONFIRMED"),
    onDelete: (confirmedAcknowledged: boolean) =>
      removeService(item, confirmedAcknowledged),
    onCancel: () => void cancelService(item),
    onConfirm: () => void confirm(item),
    onShare: () => onShare(item, updatedConfirmed.has(item.id)),
    onRerollMember: (role: string, slot: number) =>
      void rerollMember(item, role, slot),
    onSaveCrew: (
      assignments: { role: string; slot: number; memberId: string }[],
    ) => saveCrew(item, assignments),
    onSaveReplacement: (input: ReplacementInput, replacementId?: string) =>
      addReplacement(item, input, replacementId),
    onRemoveReplacement: (replacement: DashboardReplacement) =>
      void removeReplacement(item, replacement),
  });
  const interval = { start: new Date(week.from), end: new Date(week.to) };

  if (mode === "month")
    return (
      <div className="module-stack">
        <div className="module-title">
          <div>
            <span className="section-kicker">Plánování dopředu</span>
            <h2>{monthTitle(month)}</h2>
          </div>
          <div className="module-actions">
            <Button variant="outline" onClick={() => setMode("week")}>
              Jeden týden
            </Button>
            <Button variant="outline" onClick={shareMonth}>
              <Share2 size={15} /> Sdílet měsíční plán
            </Button>
            <Button
              className="primary-action compact"
              onClick={() => setMonthDialog(true)}
            >
              <CalendarDays size={16} /> Naplánovat měsíc
            </Button>
          </div>
        </div>
        {monthErrors.map((error) => (
          <div className="planning-error" key={error.from}>
            ⚠ {formatServiceDateTime(new Date(error.from), settings.timezone)}:{" "}
            {error.error}
          </div>
        ))}
        <div className="month-plan-grid">
          {monthIntervals.map((intervalItem) => {
            const item = monthServices.find(
              (candidate) => candidate.from === intervalItem.from,
            );
            return item ? (
              <WeekCard key={intervalItem.from} {...cardProps(item)} />
            ) : (
              <article
                className="panel month-week-card"
                key={intervalItem.from}
              >
                <div>
                  <strong>
                    {formatServiceDateTime(
                      new Date(intervalItem.from),
                      settings.timezone,
                    )}{" "}
                    →{" "}
                    {formatServiceDateTime(
                      new Date(intervalItem.to),
                      settings.timezone,
                    )}
                  </strong>
                  <span>Nenaplánovaný týden</span>
                </div>
                <Button
                  disabled={busy}
                  onClick={() => void generate(new Date(intervalItem.from))}
                >
                  Vygenerovat tento týden znovu
                </Button>
              </article>
            );
          })}
        </div>
        <div className="actions month-actions">
          <Button variant="outline" onClick={() => setMonthDialog(true)}>
            Změnit měsíc
          </Button>
          <Button
            className="primary-action compact"
            disabled={
              busy || !monthServices.some((item) => item.status === "DRAFT")
            }
            onClick={() => void confirmMonth()}
          >
            Potvrdit všechny platné služby
          </Button>
        </div>
        <MonthDialog
          open={monthDialog}
          onOpenChange={setMonthDialog}
          month={month}
          onMonth={setMonth}
          busy={busy}
          onCreate={() => void createMonth()}
        />
      </div>
    );
  return (
    <div className="module-stack">
      <div className="module-title">
        <div>
          <span className="section-kicker">Plánování 3+1</span>
          <h2>Týdenní služba</h2>
        </div>
        <div className="module-actions">
          <Button variant="outline" onClick={() => void loadMonth(month)}>
            <CalendarDays size={15} /> Měsíční plán
          </Button>
          {!service && (
            <Button
              className="primary-action compact"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? "Sestavuji…" : "Vytvořit návrh"}
            </Button>
          )}
        </div>
      </div>
      <div className="week-switcher">
        <button
          disabled={busy}
          onClick={() => {
            const previous = nextServiceWeek(
              new Date(interval.start.getTime() - 14 * 86400000),
              settings,
            );
            void loadWeek(previous.start);
          }}
        >
          ←
        </button>
        <div>
          <strong>
            {formatServiceDateTime(interval.start, settings.timezone)} →{" "}
            {formatServiceDateTime(interval.end, settings.timezone)}
          </strong>
          <span>Pondělí 06:00 – pondělí 06:00</span>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            void loadWeek(nextServiceWeek(interval.start, settings).start)
          }
        >
          →
        </button>
      </div>
      {service ? (
        <WeekCard {...cardProps(service)} />
      ) : (
        <article className="panel empty-week">
          <CalendarDays />
          <h2>Pro tento týden není připravena služba.</h2>
          <p>
            Nová sestava se vypočítá z aktuálních členů, pravidel, dostupnosti a
            historie.
          </p>
          <div className="actions">
            <Button
              className="primary-action compact"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? "Sestavuji…" : "Vygenerovat sestavu"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void generate(new Date(week.from), false, true)}
            >
              Připravit ručně
            </Button>
          </div>
        </article>
      )}
      <MonthDialog
        open={monthDialog}
        onOpenChange={setMonthDialog}
        month={month}
        onMonth={setMonth}
        busy={busy}
        onCreate={() => void createMonth()}
      />
    </div>
  );
}

type WeekCardProps = {
  service: DashboardService;
  settings: ServiceTimeSettings;
  busy: boolean;
  members: { id: string; name: string }[];
  updated: boolean;
  startInEdit: boolean;
  onDetail?: () => void;
  onReroll: () => void;
  onDelete: (confirmedAcknowledged: boolean) => Promise<boolean>;
  onCancel: () => void;
  onConfirm: () => void;
  onShare: () => void;
  onRerollMember: (role: string, slot: number) => void;
  onSaveCrew: (
    assignments: { role: string; slot: number; memberId: string }[],
  ) => Promise<boolean>;
  onSaveReplacement: (
    input: ReplacementInput,
    replacementId?: string,
  ) => Promise<boolean>;
  onRemoveReplacement: (replacement: DashboardReplacement) => void;
};

function WeekCard({
  service,
  settings,
  busy,
  members,
  updated,
  startInEdit,
  onDetail,
  onReroll,
  onDelete,
  onCancel,
  onConfirm,
  onShare,
  onRerollMember,
  onSaveCrew,
  onSaveReplacement,
  onRemoveReplacement,
}: WeekCardProps) {
  const [editing, setEditing] = useState(startInEdit);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<{
    role: string;
    slot: number;
    label: string;
  } | null>(null);
  const [candidates, setCandidates] = useState<CrewCandidate[]>([]);
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [outage, setOutage] = useState<{
    assignmentId: string;
    mode: "CUSTOM" | "UNTIL_END" | "REPLACE";
    replacementId?: string;
  } | null>(null);
  const [outageFrom, setOutageFrom] = useState("");
  const [outageTo, setOutageTo] = useState("");
  const [outageReason, setOutageReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmedAcknowledged, setConfirmedAcknowledged] = useState(false);
  const [knownDt, setKnownDt] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(service.crew.map((item) => [item.memberId, item.dt])),
  );
  const key = (role: string, slot: number) => `${role}-${slot}`;
  const startEdit = () => {
    setDraft(
      Object.fromEntries(
        service.crew.map((item) => [
          key(item.roleKey, item.slot),
          item.memberId,
        ]),
      ),
    );
    setEditing(true);
  };
  const openCandidates = async (member: DashboardService["crew"][number]) => {
    setTarget({ role: member.roleKey, slot: member.slot, label: member.role });
    setCandidateBusy(true);
    try {
      const response = await fetch(
          `/api/services/${service.id}/candidates?role=${member.roleKey}`,
        ),
        body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setCandidates(body.candidates);
      setKnownDt((current) => ({
        ...current,
        ...Object.fromEntries(
          (body.candidates as CrewCandidate[]).map((item) => [
            item.id,
            item.dt,
          ]),
        ),
      }));
    } finally {
      setCandidateBusy(false);
    }
  };
  const openOutage = (
    assignmentId = service.crew[0]?.assignmentId,
    replacement?: DashboardReplacement,
  ) => {
    if (!assignmentId) return;
    const now = new Date(),
      start =
        now > new Date(service.from) && now < new Date(service.to)
          ? now
          : new Date(service.from);
    setOutage({ assignmentId, mode: "CUSTOM", replacementId: replacement?.id });
    setOutageFrom(
      toLocalDateTimeInput(
        replacement ? new Date(replacement.from) : start,
        settings.timezone,
      ),
    );
    setOutageTo(
      toLocalDateTimeInput(
        replacement
          ? new Date(replacement.to)
          : new Date(
              Math.min(
                start.getTime() + 12 * 3600000,
                new Date(service.to).getTime(),
              ),
            ),
        settings.timezone,
      ),
    );
    setOutageReason(replacement?.reason ?? "");
  };
  const ids = service.crew.map(
      (item) => draft[key(item.roleKey, item.slot)] ?? item.memberId,
    ),
    duplicate = new Set(ids).size !== ids.length,
    dtCount = ids.filter((id) => knownDt[id]).length,
    invalid = duplicate || dtCount < settings.minimumDt;
  const crewValid =
    service.crew.length === 4 &&
    new Set(service.crew.map((item) => item.memberId)).size === 4 &&
    service.crew.filter((item) => item.dt).length >= settings.minimumDt;
  const state = serviceOperationalState(
    service.status,
    crewValid,
    service.replacements,
  );
  const timeline = serviceTimeline(
    new Date(service.from),
    new Date(service.to),
    service.crew.map((item) => ({
      assignmentId: item.assignmentId,
      role: item.roleKey,
      memberId: item.memberId,
      name: item.name,
    })),
    service.replacements.map((item) => ({
      ...item,
      from: new Date(item.from),
      to: new Date(item.to),
    })),
  );
  const save = async () => {
    const success = await onSaveCrew(
      service.crew.map((item) => ({
        role: item.roleKey,
        slot: item.slot,
        memberId: draft[key(item.roleKey, item.slot)] ?? item.memberId,
      })),
    );
    if (success) setEditing(false);
  };
  const choose = (candidate: CrewCandidate) => {
    if (!candidate.available) return;
    setDraft((current) => ({
      ...current,
      [key(target!.role, target!.slot)]: candidate.id,
    }));
    setTarget(null);
  };
  const submitOutage = async () => {
    if (!outage) return;
    if (outage.mode === "REPLACE") {
      const member = service.crew.find(
        (item) => item.assignmentId === outage.assignmentId,
      );
      setOutage(null);
      if (member) {
        startEdit();
        await openCandidates(member);
      }
      return;
    }
    const from = fromLocalDateTimeInput(outageFrom, settings.timezone),
      to =
        outage.mode === "UNTIL_END"
          ? new Date(service.to)
          : fromLocalDateTimeInput(outageTo, settings.timezone);
    if (!from || !to || from >= to) {
      return;
    }
    const success = await onSaveReplacement(
      {
        assignmentId: outage.assignmentId,
        from: from.toISOString(),
        to: to.toISOString(),
        reason: outageReason,
      },
      outage.replacementId,
    );
    if (success) setOutage(null);
  };
  const selectedOutageMember = service.crew.find(
    (item) => item.assignmentId === outage?.assignmentId,
  );

  return (
    <>
      <article className={`panel month-week-card service-state-${state.kind}`}>
        <div className="panel-head">
          <div>
            <span className="section-kicker">
              {formatServiceDateTime(new Date(service.from), settings.timezone)}{" "}
              → {formatServiceDateTime(new Date(service.to), settings.timezone)}
            </span>
            <h2>Posádka 3+1</h2>
          </div>
          <Badge
            className={state.kind === "confirmed" ? "status-badge" : ""}
            variant={state.kind === "draft" ? "outline" : undefined}
          >
            {state.kind === "confirmed" && <Check size={13} />}{" "}
            {state.kind === "cancelled" && <XCircle size={13} />} {state.label}
          </Badge>
        </div>
        {service.status === "CANCELLED" && service.cancellationReason && (
          <div className="planning-error">
            Důvod zrušení: {service.cancellationReason}
          </div>
        )}
        <div className="crew-list">
          {service.crew.map((member, index) => {
            const selectedId =
                draft[key(member.roleKey, member.slot)] ?? member.memberId,
              selectedName =
                members.find((item) => item.id === selectedId)?.name ??
                member.name,
              replacements = service.replacements.filter(
                (item) => item.assignmentId === member.assignmentId,
              );
            return (
              <div
                className="planning-member-block"
                key={`${member.roleKey}-${member.slot}`}
              >
                <div className="crew-row planning-crew-row">
                  <span className={`role-index ${index === 0 ? "lead" : ""}`}>
                    {index + 1}
                  </span>
                  <div className="crew-copy">
                    <span>{member.role}</span>
                    <strong>{selectedName}</strong>
                  </div>
                  {knownDt[selectedId] && (
                    <span className="dt-tag">
                      <Gauge size={14} /> DT
                    </span>
                  )}
                  {service.status !== "CANCELLED" &&
                    (editing ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void openCandidates(member)}
                      >
                        Změnit
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            onRerollMember(member.roleKey, member.slot)
                          }
                          title="Přelosovat člena"
                        >
                          <RefreshCw size={14} />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openOutage(member.assignmentId)}
                        >
                          <UserX size={14} /> Člen vypadl
                        </Button>
                      </>
                    ))}
                  {replacements.length > 0 && (
                    <Badge variant="outline">
                      {replacements.length} záskoky
                    </Badge>
                  )}
                </div>
                {replacements.length > 0 && (
                  <div className="replacement-details">
                    {replacements.map((item) => (
                      <div key={item.id}>
                        <span>
                          {formatServiceDateTime(
                            new Date(item.from),
                            settings.timezone,
                          )}{" "}
                          →{" "}
                          {formatServiceDateTime(
                            new Date(item.to),
                            settings.timezone,
                          )}
                          {item.reason && <small>{item.reason}</small>}
                        </span>
                        <strong>
                          {item.replacementName ??
                            item.issue ??
                            "Nenalezen vhodný náhradník"}
                        </strong>
                        {item.source === "MANUAL" &&
                          service.status !== "CANCELLED" && (
                            <span className="record-actions">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  openOutage(item.assignmentId, item)
                                }
                              >
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="delete-action"
                                onClick={() => onRemoveReplacement(item)}
                              >
                                <Trash2 />
                              </Button>
                            </span>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {service.status !== "CANCELLED" &&
          (invalid ? (
            <div className="validation-box invalid">
              <span>⚠</span>
              <div>
                <strong>Posádku zatím nelze uložit</strong>
                <span>
                  {duplicate
                    ? "Stejná osoba je vybrána vícekrát."
                    : `Posádka nemá požadovaný počet ${settings.minimumDt} DT.`}
                </span>
              </div>
            </div>
          ) : service.replacements.some((item) => !item.valid) ? (
            <div className="validation-box invalid">
              <span>⚠</span>
              <div>
                <strong>Vyžaduje záskok</strong>
                <span>
                  {service.replacements
                    .filter((item) => !item.valid)
                    .map((item) => `${item.originalName}: ${item.issue}`)
                    .join(" · ")}
                </span>
              </div>
            </div>
          ) : (
            <div className="validation-box">
              <Check size={18} />
              <div>
                <strong>Posádka splňuje pravidla</strong>
                <span>
                  4 různé osoby · role 1+1+2 · oprávnění · zdraví · dostupnost ·
                  minimálně {settings.minimumDt} DT
                </span>
              </div>
            </div>
          ))}
        <details className="service-timeline">
          <summary>Časový průběh služby</summary>
          {timeline.map((segment) => (
            <div key={segment.from.toISOString()}>
              <strong>
                {formatServiceDateTime(segment.from, settings.timezone)} →{" "}
                {formatServiceDateTime(segment.to, settings.timezone)}
              </strong>
              {segment.crew.map((member) => (
                <span key={member.assignmentId}>
                  {member.role === "COMMANDER"
                    ? "Velitel"
                    : member.role === "DRIVER"
                      ? "Strojník"
                      : "Hasič"}
                  :{" "}
                  {member.replaced
                    ? `${member.originalName} → ${member.name}`
                    : member.name}
                </span>
              ))}
            </div>
          ))}
        </details>
        <div className="actions planning-card-actions">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Zrušit změny
              </Button>
              <Button
                className="primary-action compact"
                disabled={busy || invalid}
                onClick={() => void save()}
              >
                Uložit sestavu
              </Button>
            </>
          ) : (
            <>
              {onDetail && (
                <Button variant="outline" onClick={onDetail}>
                  Detail
                </Button>
              )}
              {service.status !== "CANCELLED" && (
                <>
                  <Button variant="outline" onClick={startEdit}>
                    Upravit sestavu
                  </Button>
                  <Button variant="outline" onClick={() => openOutage()}>
                    <Plus size={14} /> Přidat záskok
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={onReroll}>
                    <RefreshCw size={14} /> Přelosovat
                  </Button>
                  {service.status === "CONFIRMED" && (
                    <Button variant="outline" onClick={onShare}>
                      <Share2 size={14} />{" "}
                      {updated ? "Sdílet aktualizaci" : "Sdílet"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="delete-action"
                    disabled={busy}
                    onClick={onCancel}
                  >
                    <XCircle size={14} /> Zrušit službu
                  </Button>
                  {(service.status === "DRAFT" ||
                    service.status === "CONFIRMED") && (
                    <Button
                      variant="outline"
                      className="danger-button"
                      disabled={busy}
                      onClick={() => {
                        setConfirmedAcknowledged(false);
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 size={14} /> Smazat službu
                    </Button>
                  )}
                  {service.status === "DRAFT" && (
                    <Button
                      className="primary-action compact"
                      disabled={
                        busy || service.replacements.some((item) => !item.valid)
                      }
                      onClick={onConfirm}
                    >
                      Potvrdit
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </article>
      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <DialogContent className="candidate-dialog">
          <DialogHeader>
            <DialogTitle>Změnit člena – {target?.label}</DialogTitle>
            <DialogDescription>
              Nejprve jsou zobrazeni platní kandidáti. Výběr se uloží až
              tlačítkem „Uložit sestavu“.
            </DialogDescription>
          </DialogHeader>
          <div className="candidate-list">
            {candidateBusy ? (
              <p>Načítám kandidáty…</p>
            ) : (
              candidates.map((candidate) => (
                <button
                  type="button"
                  disabled={!candidate.available}
                  className={candidate.available ? "" : "unsuitable"}
                  key={candidate.id}
                  onClick={() => choose(candidate)}
                >
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>
                      {candidate.primaryRole} ·{" "}
                      {candidate.permissions.join(", ") || "bez oprávnění"}
                    </small>
                    <small>
                      Zdravotní do {candidate.medicalValidUntil} · DT{" "}
                      {candidate.dt ? "ano" : "ne"}
                    </small>
                  </span>
                  <span>
                    {candidate.warnings.length
                      ? candidate.warnings.join(" · ")
                      : "Vhodný kandidát"}
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!outage}
        onOpenChange={(open) => {
          if (!open) setOutage(null);
        }}
      >
        <DialogContent className="planning-dialog emergency-dialog">
          <DialogHeader>
            <DialogTitle>
              {outage?.replacementId ? "Upravit časový záskok" : "Člen vypadl"}
            </DialogTitle>
            <DialogDescription>
              {selectedOutageMember?.name} · {selectedOutageMember?.role}.
              Základní člen zůstane v sestavě, pokud nezvolíte úplnou změnu.
            </DialogDescription>
          </DialogHeader>
          <div className="emergency-form">
            <label>
              Člen služby
              <select
                value={outage?.assignmentId ?? ""}
                disabled={!!outage?.replacementId}
                onChange={(event) =>
                  setOutage((current) =>
                    current
                      ? { ...current, assignmentId: event.target.value }
                      : current,
                  )
                }
              >
                {service.crew.map((member) => (
                  <option key={member.assignmentId} value={member.assignmentId}>
                    {member.role}: {member.name}
                  </option>
                ))}
              </select>
            </label>
            {!outage?.replacementId && (
              <div className="choice-row">
                <button
                  type="button"
                  className={outage?.mode === "CUSTOM" ? "selected" : ""}
                  onClick={() =>
                    setOutage((current) =>
                      current ? { ...current, mode: "CUSTOM" } : current,
                    )
                  }
                >
                  Jen určitý čas
                </button>
                <button
                  type="button"
                  className={outage?.mode === "UNTIL_END" ? "selected" : ""}
                  onClick={() =>
                    setOutage((current) =>
                      current ? { ...current, mode: "UNTIL_END" } : current,
                    )
                  }
                >
                  Do konce služby
                </button>
                <button
                  type="button"
                  className={outage?.mode === "REPLACE" ? "selected" : ""}
                  onClick={() =>
                    setOutage((current) =>
                      current ? { ...current, mode: "REPLACE" } : current,
                    )
                  }
                >
                  Nahradit úplně
                </button>
              </div>
            )}
            {outage?.mode !== "REPLACE" && (
              <>
                <label>
                  Od
                  <input
                    type="datetime-local"
                    value={outageFrom}
                    onChange={(event) => setOutageFrom(event.target.value)}
                  />
                </label>
                {outage?.mode === "CUSTOM" && (
                  <label>
                    Do
                    <input
                      type="datetime-local"
                      value={outageTo}
                      onChange={(event) => setOutageTo(event.target.value)}
                    />
                  </label>
                )}
                <label>
                  Důvod (nepovinný)
                  <input
                    value={outageReason}
                    onChange={(event) => setOutageReason(event.target.value)}
                    placeholder="Např. nemoc"
                  />
                </label>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutage(null)}>
              Zrušit
            </Button>
            <Button
              className="primary-action compact"
              onClick={() => void submitOutage()}
            >
              {outage?.mode === "REPLACE"
                ? "Vybrat nového člena"
                : outage?.replacementId
                  ? "Uložit změny"
                  : "Najít a uložit náhradníka"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setConfirmedAcknowledged(false);
        }}
      >
        <AlertDialogContent className="service-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Opravdu chcete smazat celou službu?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Odstranění se provede pro celý uvedený interval.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="service-delete-copy">
            <strong>
              {formatServiceDateTime(new Date(service.from), settings.timezone)}
              <br />→<br />
              {formatServiceDateTime(new Date(service.to), settings.timezone)}
            </strong>
            <p>
              Budou odstraněni všichni členové této sestavy, časové záskoky a
              související plánování pro tento týden.
            </p>
            <b>Tuto akci nelze vrátit zpět.</b>
            {service.status === "CONFIRMED" && (
              <label>
                <input
                  type="checkbox"
                  checked={confirmedAcknowledged}
                  onChange={(event) =>
                    setConfirmedAcknowledged(event.target.checked)
                  }
                />{" "}
                Rozumím, že mažu potvrzenou službu.
              </label>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="danger-button"
              disabled={
                busy ||
                (service.status === "CONFIRMED" && !confirmedAcknowledged)
              }
              onClick={(event) => {
                event.preventDefault();
                void onDelete(confirmedAcknowledged).then((success) => {
                  if (success) setDeleteOpen(false);
                });
              }}
            >
              Smazat službu
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MonthDialog({
  open,
  onOpenChange,
  month,
  onMonth,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  month: string;
  onMonth: (value: string) => void;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="planning-dialog">
        <DialogHeader>
          <DialogTitle>Naplánovat celý měsíc</DialogTitle>
          <DialogDescription>
            Vytvoří se pouze chybějící návrhy. Existující návrhy ani potvrzené
            služby se nepřepíší.
          </DialogDescription>
        </DialogHeader>
        <label className="planning-month-label">
          Měsíc
          <input
            type="month"
            value={month}
            onChange={(event) => onMonth(event.target.value)}
          />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            className="primary-action compact"
            disabled={busy || !month}
            onClick={onCreate}
          >
            {busy ? "Plánuji…" : "Vytvořit měsíční plán"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
