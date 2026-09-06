# JSDH Nehvizdy – týdenní služba

Interní webová aplikace pro plánování výjezdové posádky 3+1, evidenci členů, zdravotních prohlídek, nedostupností, historie a auditu. Aplikace běží na Next.js, používá Prisma ORM a ukládá trvalá data do PostgreSQL.

Na stránce **Členové** je dostupný hromadný import z Excelu, Google Sheets i CSV. Před uložením zobrazí kontrolovaný náhled, dopočítá dvouletou platnost zdravotní prohlídky a umožní rozhodnout o pravděpodobných duplicitách. Zápis proběhne až po potvrzení, serverově a v jedné databázové transakci. Prázdnou CSV šablonu lze stáhnout přímo z importního dialogu.

## Časové pravidlo služby

Týdenní služba začíná v **pondělí v 06:00** a končí v **neděli v 06:00** v časovém pásmu `Europe/Prague`. Časové hranice se počítají v pražském pásmu včetně změn letního a zimního času. Intervaly nedostupnosti jsou polouzavřené: záznam končící přesně na začátku služby už tuto službu neblokuje.

Nedostupnost se eviduje včetně přesného času. Lze zvolit celý den, aktuální či příští službu nebo vlastní interval. Jakýkoli překryv se službou vyřadí člena z automatického výběru pro celý daný týden.

Požadavek na nositele dýchací techniky se kontroluje pro celou čtyřčlennou posádku. Náhradník nemusí mít DT, pokud výsledná sestava stále splňuje hodnotu `Settings.minimumDt` (výchozí hodnota je `1`).

## Požadavky

- Node.js 22 LTS nebo 24
- PostgreSQL
- npm

## Lokální spuštění

1. Nainstalujte balíčky: `npm install`.
2. Zkopírujte `.env.example` do `.env.local` a doplňte vlastní lokální hodnoty.
3. Vytvořte schéma databáze příkazem `npx prisma migrate deploy`.
4. Vložte pouze technická nastavení příkazem `npm run db:seed`.
5. Spusťte aplikaci příkazem `npm run dev`.

Lokální adresa je `http://localhost:3000`. Soubor `.env.local` je ignorovaný Gitem a nesmí se commitovat.

## Přihlášení administrátora

Aplikace používá uživatelské jméno z `ADMIN_USERNAME` a heslo z `ADMIN_PASSWORD`. Obě hodnoty načítá a porovnává výhradně server; heslo se neposílá do frontendového JavaScriptu ani se neloguje.

Na Railway nastavte:

```text
ADMIN_USERNAME=HasiciNehvizdy
ADMIN_PASSWORD=<vaše zvolené heslo>
```

Heslo je uložené pouze jako Railway environment variable a nikdy nesmí být součástí Git repository. Pro `SESSION_SECRET` použijte jiný náhodný řetězec o délce alespoň 32 znaků. Přihlašovací cookie je `HttpOnly`, v produkci `Secure`, používá `SameSite=Lax` a serverové relace jsou uložené v PostgreSQL. Opakované neúspěšné pokusy omezuje databázová ochrana `LoginAttempt`.

## Databáze a soukromí

Schéma je v `prisma/schema.prisma` a produkční migrace v `prisma/migrations/`. Obsahuje modely `Member`, `Unavailability`, `WeeklyService`, `WeeklyServiceAssignment`, `AuditLog`, `Settings`, `AdminSession`, `LoginAttempt` a `MedicalTemplate`.

`npm run db:seed` vytvoří pouze technická nastavení a žádné členy. Volitelný příkaz `npm run db:seed:demo` vloží výhradně fiktivní osoby a je určený jen pro prázdnou vývojovou databázi. Reálná jména, data narození, zdravotní údaje a dokumenty patří pouze do neveřejné PostgreSQL databáze.

Vzor lékařského posudku se nahrává v aplikaci v části **Zdravotní prohlídky**. Obsah souboru je uložený v PostgreSQL, nikoli v lokálním souborovém systému.

## Kontroly kvality

```bash
npx prisma generate
npm test
npm run lint
npm run build
```

Health check je dostupný na `/api/health`. Vrací pouze stav služby a žádné osobní údaje, přihlašovací údaje ani informace o databázi.

## Nasazení na Railway

1. Použijte GitHub repository `martypetrzel-lab/JSDH-Dashboard` a větev `main`.
2. V Railway vytvořte nový projekt z tohoto GitHub repository.
3. Do projektu přidejte službu PostgreSQL.
4. U webové služby nastavte `DATABASE_URL` jako referenci na připojovací URL PostgreSQL.
5. Nastavte `ADMIN_USERNAME`.
6. Nastavte `ADMIN_PASSWORD` na zvolené heslo prostřednictvím Railway Variables.
7. Nastavte náhodný `SESSION_SECRET` o délce alespoň 32 znaků.
8. Nastavte `TZ=Europe/Prague`.
9. Jako **Pre-deploy Command** ponechte `npx prisma migrate deploy`.
10. Spusťte deploy.
11. V části Networking zvolte **Generate Domain**.

Soubor `railway.toml` nastavuje Railpack, build, bezpečné nasazení migrací, start aplikace a health check. `prisma migrate deploy` pouze aplikuje dosud chybějící verzované migrace; neresetuje a nemaže existující produkční data. Next.js automaticky respektuje proměnnou `PORT`, kterou přiděluje Railway.

### Povinné proměnné prostředí

- `DATABASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `TZ`

Aplikace bez těchto hodnot nepoužije nebezpečné výchozí přihlašovací údaje a vrátí srozumitelnou serverovou chybu.
