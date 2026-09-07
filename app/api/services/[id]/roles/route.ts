import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { syncServiceReplacements } from '@/lib/service-replacements-server';
import { serializeWeeklyService } from '@/lib/weekly-service-data';

export const runtime = 'nodejs';

const roleSchema = z.enum(['COMMANDER', 'DRIVER', 'FIREFIGHTER']);
const inputSchema = z.object({
  assignments: z
    .array(
      z.object({
        memberId: z.string().min(1),
        role: roleSchema,
        slot: z.number().int().min(1).max(2),
      }),
    )
    .length(4),
  forceManualOverride: z.boolean().optional().default(false),
  confirmedServiceAcknowledged: z.boolean().optional().default(false),
});

const expectedPositions = new Set([
  'COMMANDER-1',
  'DRIVER-1',
  'FIREFIGHTER-1',
  'FIREFIGHTER-2',
]);
const roleLabel = (role: string) =>
  role === 'COMMANDER' ? 'Velitel' : role === 'DRIVER' ? 'Strojník' : 'Hasič';
const memberName = (member: { firstName: string; lastName: string }) =>
  `${member.firstName} ${member.lastName === '—' ? '' : member.lastName}`.trim();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdminApi()))
    return NextResponse.json(
      { error: 'Nepřihlášený přístup.' },
      { status: 401 },
    );
  try {
    const { id } = await context.params;
    const input = inputSchema.parse(await request.json());
    const prisma = getPrisma();
    const service = await prisma.weeklyService.findUnique({
      where: { id },
      include: {
        assignments: {
          include: { member: true },
          orderBy: [{ role: 'asc' }, { slot: 'asc' }],
        },
      },
    });
    if (!service)
      return NextResponse.json(
        { error: 'Služba nebyla nalezena.' },
        { status: 404 },
      );
    if (service.status === 'CANCELLED')
      return NextResponse.json(
        { error: 'Zrušenou službu nelze upravit.' },
        { status: 409 },
      );

    const positionKeys = input.assignments.map(
      (item) => `${item.role}-${item.slot}`,
    );
    if (
      new Set(positionKeys).size !== expectedPositions.size ||
      positionKeys.some((item) => !expectedPositions.has(item))
    ) {
      return NextResponse.json(
        {
          error:
            'Rozdělení musí obsahovat právě velitele, strojníka a dva hasiče.',
        },
        { status: 422 },
      );
    }
    const currentMemberIds = new Set(
      service.assignments.map((item) => item.memberId),
    );
    const proposedMemberIds = new Set(
      input.assignments.map((item) => item.memberId),
    );
    if (
      proposedMemberIds.size !== 4 ||
      currentMemberIds.size !== 4 ||
      [...proposedMemberIds].some((memberId) => !currentMemberIds.has(memberId))
    ) {
      return NextResponse.json(
        {
          error:
            'Funkce lze přehodit pouze mezi stejnými čtyřmi členy základní posádky a každý musí být použit právě jednou.',
        },
        { status: 422 },
      );
    }

    const proposed = input.assignments.map((item) => {
      const saved = service.assignments.find(
        (assignment) => assignment.memberId === item.memberId,
      );
      if (!saved) throw new Error('Člen základní posádky nebyl nalezen.');
      if (saved.member.systemAccount)
        throw new Error('Systémový účet nelze použít v posádce.');
      const permitted =
        item.role === 'COMMANDER'
          ? saved.member.canCommand
          : item.role === 'DRIVER'
            ? saved.member.canDrive
            : saved.member.canFight;
      return { ...item, saved, name: memberName(saved.member), permitted };
    });
    const changes = proposed.filter(
      (item) => item.saved.role !== item.role || item.saved.slot !== item.slot,
    );
    if (!changes.length)
      return NextResponse.json(
        { error: 'Rozdělení funkcí neobsahuje žádnou změnu.' },
        { status: 400 },
      );

    const warnings = proposed
      .filter((item) => !item.permitted)
      .map(
        (item) =>
          `${item.name} nemá standardní oprávnění ${roleLabel(item.role)}.`,
      );
    const requiresConfirmedAcknowledgement =
      service.status === 'CONFIRMED' && !input.confirmedServiceAcknowledged;
    const requiresRoleOverride =
      warnings.length > 0 && !input.forceManualOverride;
    if (requiresConfirmedAcknowledgement || requiresRoleOverride) {
      return NextResponse.json(
        {
          requiresOverrideConfirmation: true,
          requiresConfirmedAcknowledgement,
          warning: requiresConfirmedAcknowledgement
            ? 'Měníte funkce v již potvrzené službě. Pokračovat?'
            : 'Vybraná funkce neodpovídá standardnímu oprávnění člena.',
          warnings,
        },
        { status: 409 },
      );
    }

    const description =
      changes
        .map(
          (item) =>
            `${item.name}: ${roleLabel(item.saved.role)} → ${roleLabel(item.role)}`,
        )
        .join('; ') + '.';
    await prisma.$transaction(async (tx) => {
      for (const [index, assignment] of service.assignments.entries()) {
        await tx.weeklyServiceAssignment.update({
          where: { id: assignment.id },
          data: { slot: 100 + index },
        });
      }
      for (const item of proposed) {
        await tx.weeklyServiceAssignment.update({
          where: { id: item.saved.id },
          data: {
            role: item.role,
            slot: item.slot,
            roleSnapshot: item.role,
            selectionMode: 'MANUAL',
          },
        });
        await tx.serviceReplacement.updateMany({
          where: { assignmentId: item.saved.id },
          data: { role: item.role },
        });
      }
      await tx.serviceReplacement.deleteMany({
        where: { serviceId: id, source: 'RECURRING' },
      });
      await tx.serviceTemporaryAssignment.deleteMany({
        where: { serviceId: id, source: 'RECURRING' },
      });
      await tx.auditLog.create({
        data: {
          action: 'CREW_ROLES_MANUALLY_CHANGED',
          entity: 'WeeklyService',
          entityId: id,
          description,
          actor: 'Administrátor',
        },
      });
    });

    await syncServiceReplacements(id);
    const updated = await prisma.weeklyService.findUniqueOrThrow({
      where: { id },
      include: {
        assignments: { orderBy: [{ role: 'asc' }, { slot: 'asc' }] },
        replacements: {
          include: { originalMember: true, replacementMember: true },
          orderBy: { from: 'asc' },
        },
        temporaryAssignments: {
          include: { member: true },
          orderBy: [{ from: 'asc' }, { role: 'asc' }, { slot: 'asc' }],
        },
      },
    });
    return NextResponse.json({
      service: serializeWeeklyService(updated),
      warnings,
      updatedConfirmed: service.status === 'CONFIRMED',
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Funkce posádky se nepodařilo změnit.',
      },
      { status: 400 },
    );
  }
}
