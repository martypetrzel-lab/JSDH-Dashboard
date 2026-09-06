import { hash } from 'bcryptjs';

const password = process.env.JSDH_PASSWORD;
if (!password) {
  console.error('Chybí dočasná proměnná JSDH_PASSWORD. Postup je uveden v README.');
  process.exit(1);
}

console.log(await hash(password, 12));
