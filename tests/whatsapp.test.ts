import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsAppMessage, createWhatsAppShareUrl } from '../lib/whatsapp.ts';

void test('WhatsApp zpráva zachová emoji a neobsahuje náhradní otazníky', () => {
  const message = buildWhatsAppMessage({ from:'7. 9. 06:00', to:'13. 9. 06:00 2026', commander:'Test Velitel', driver:'Test Strojník', firefighters:['Test Hasič A','Test Hasič B'], dt:['Test Velitel'] });
  const url = createWhatsAppShareUrl(message);
  const decoded = decodeURIComponent(new URL(url).searchParams.get('text') ?? '');
  assert.match(decoded, /🚒 JSDH NEHVIZDY/);
  assert.match(decoded, /👨‍🚒 Velitel/);
  assert.match(decoded, /🫁 DT/);
  assert.doesNotMatch(decoded, /�/);
});
