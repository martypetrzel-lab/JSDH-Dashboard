import test from 'node:test';
import assert from 'node:assert/strict';
import { addTwoCalendarYears, importRoleDetails, parseMemberTable, probableDuplicateKey } from '../lib/member-import.ts';

void test('načte tabulátory bez hlavičky a dopočítá zdravotní platnost', () => {
  const [row] = parseMemberTable('Novák Adam\t1.2.1990\tVelitel jednotky\t20.11.2025');
  assert.equal(row.name, 'Novák Adam');
  assert.equal(row.birthDate, '01.02.1990');
  assert.equal(row.medicalValidUntil, '20.11.2027');
  assert.equal(row.permissions, 'Velitel · Hasič');
});

void test('načte středníkovou CSV s hlavičkou', () => {
  const rows = parseMemberTable('Jméno;Datum narození;Funkce;Poslední zdravotní prohlídka\nSvoboda Petr;;Strojník;1.3.2026');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'Strojník');
  assert.equal(rows[0].birthDate, '');
});

void test('načte čárkovou CSV a respektuje uvozovky', () => {
  const [row] = parseMemberTable('"Jméno",Funkce,Datum narození,Poslední zdravotní prohlídka\n"Černý, Adam",Hasič,,');
  assert.equal(row.name, 'Černý, Adam');
  assert.equal(row.errors.length, 0);
});

void test('odhalí neplatné datum a neznámou funkci', () => {
  const [row] = parseMemberTable('Test Osoba;31.2.2000;Pilot;');
  assert.equal(row.errors.length, 2);
});

void test('přestupný den se po dvou letech uzavře na konec února', () => {
  assert.equal(addTwoCalendarYears('29.2.2024'), '28.02.2026');
});

void test('Poplachový uživatel je vždy neurčený bez oprávnění', () => {
  const [row] = parseMemberTable('Poplachový uživatel;;;');
  assert.equal(row.role, 'Neurčeno');
  assert.equal(row.permissions, '—');
});

void test('mapování funkcí odpovídá oprávněním', () => {
  assert.deepEqual(importRoleDetails('Strojník'), { primaryRole: 'DRIVER', canCommand: false, canDrive: true, canFight: true });
});

void test('pravděpodobná duplicita toleruje pořadí jména a diakritiku', () => {
  assert.equal(probableDuplicateKey('Novák Adam', '01.02.1990'), probableDuplicateKey('Adam Novak', '01. 02. 1990'));
});
