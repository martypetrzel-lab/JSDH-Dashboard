# JSDH Nehvizdy – týdenní služba

Interní webová aplikace pro plánování výjezdové posádky 3+1, evidenci členů, zdravotních prohlídek, nedostupností, historie a auditu. Aplikace běží na Next.js, používá Prisma ORM a ukládá trvalá data do PostgreSQL.

Na stránce **Členové** je dostupný hromadný import z Excelu, Google Sheets i CSV. Před uložením zobrazí kontrolovaný náhled, dopočítá dvouletou platnost zdravotní prohlídky a umožní rozhodnout o pravděpodobných duplicitách. Zápis proběhne až po potvrzení, serverově a v jedné databázové transakci. Prázdnou CSV šablonu lze stáhnout přímo z importního dialogu.

## Časové pravidlo služby

Týdenní služba začíná v **pondělí v 06:00** a končí v **následující pondělí v 06:00** v časovém pásmu `Europe/Prague`. Časové hranice se počítají v pražském pásmu včetně změn letního a zimního času. Intervaly nedostupnosti jsou polouzavřené: záznam končící přesně na začátku služby už tuto službu neblokuje.

Nedostupnost se eviduje včetně přesného času. Lze zvolit celý den, aktuální či příští službu nebo vlastní interval. Jakýkoli překryv se službou vyřadí člena z automatického výběru pro celý daný týden.

Požadavek na nositele dýchací techniky se kontroluje pro celou čtyřčlennou posádku. Náhradník nemusí mít DT, pokud výsledná sestava stále splňuje hodnotu `Settings.minimumDt` (výchozí hodnota je `1`).

Tlačítko **Navrhnout posádku** na stránce Týdenní služba načítá členy, oprávnění, zdravotní platnost, přesné nedostupnosti a historii služeb přímo z PostgreSQL. Návrh ukládá jako `DRAFT`; při potvrzení se všechna pravidla znovu kontrolují nad aktuálními databázovými údaji.

Stránka **Týdenní služba** umožňuje plánovat jeden vybraný týden, příští týden i všechny služby začínající ve zvoleném kalendářním měsíci. Měsíční generování postupuje chronologicky a každou nově navrženou posádku zahrne do férovosti následujících týdnů. Existující návrhy zachová a potvrzené služby nikdy nepřepisuje. Návrhy lze po týdnech upravit, přelosovat, odstranit a jednotlivě nebo hromadně potvrdit po nové serverové validaci.

Opakované pracovní směny se evidují pomocí kotvy, délky a periody. Člena nevyřazují ze základní týdenní posádky; aplikace pro každý skutečný překryv dopočítá konkrétní časový záskok, preferuje stejného platného náhradníka pro více výpadků a kontroluje oprávnění, zdraví, dostupnost i DT celé výsledné čtveřice. Náhradníkovi se eviduje počet a délka záskoků, nikoli celá týdenní služba.

Tlačítko **Upravit sestavu** zpřístupní ruční výběr kandidátů pro každou pozici ve stavu `DRAFT` i `CONFIRMED`. Změny se nejprve drží pouze v editoru a ukládají se společně až po serverové validaci celé čtveřice. Změněné pozice dostanou `selectionMode=MANUAL`, ostatním zůstane původní režim. Potvrzená služba zůstává po platné úpravě potvrzená a AuditLog uchová původního i nového člena s časem změny.

## Kondice a povinnosti

Modul **Kondice a povinnosti** eviduje použití dýchací techniky aktivních členů s `dt=true` a měsíční jízdy všech aktivních členů s `canDrive=true`. Kondiční i zásahová událost se započítává stejně. Další termín DT je přesně tři kalendářní měsíce od nejnovější události; upozornění se standardně zobrazí 30 dní předem. Jízdy se vyhodnocují podle aktuálního kalendářního měsíce v `Europe/Prague`.

Záznamy lze vytvářet, upravovat i odstraňovat a každá změna vzniká společně se záznamem v AuditLogu. Ruční WhatsApp sdílení potvrzené služby obsahuje pouze povinnosti, které vyžadují pozornost, nikoli kompletní seznam členů.

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

Aplikace vždy zachovává nouzový superadmin účet s uživatelským jménem z `ADMIN_USERNAME` a heslem z `ADMIN_PASSWORD`. Další administrátorské účty jsou uložené v PostgreSQL jako `AppUser`; jejich hesla se na serveru hashují pomocí bcrypt a nikdy se neposílají do frontendového JavaScriptu ani se nelogují.

Na Railway nastavte:

```text
ADMIN_USERNAME=HasiciNehvizdy
ADMIN_PASSWORD=<vaše zvolené heslo>
```

Heslo je uložené pouze jako Railway environment variable a nikdy nesmí být součástí Git repository. Pro `SESSION_SECRET` použijte jiný náhodný řetězec o délce alespoň 32 znaků. Přihlašovací cookie je `HttpOnly`, v produkci `Secure`, používá `SameSite=Lax` a serverové relace jsou uložené v PostgreSQL. Opakované neúspěšné pokusy omezuje databázová ochrana `LoginAttempt`.

## Databáze a soukromí

Schéma je v `prisma/schema.prisma` a produkční migrace v `prisma/migrations/`. Obsahuje mimo jiné modely `Member`, `Unavailability`, `WeeklyService`, `WeeklyServiceAssignment`, `AppUser`, `AuditLog`, `Settings`, `AdminSession`, `LoginAttempt` a `MedicalTemplate`.

`npm run db:seed` vytvoří pouze technická nastavení a žádné členy. Projekt neobsahuje demonstrační členy ani ukázkovou posádku; přehled zobrazuje výhradně potvrzenou službu uloženou v PostgreSQL. Reálná jména, data narození, zdravotní údaje a dokumenty patří pouze do neveřejné PostgreSQL databáze.

Vzor lékařského posudku se nahrává v aplikaci v části **Zdravotní prohlídky**. Obsah souboru je uložený v PostgreSQL, nikoli v lokálním souborovém systému.

## Správa týdenní služby

Návrh služby lze úplně smazat. Potvrzená služba se kvůli historii nemaže, ale přepne do stavu `CANCELLED` s volitelným důvodem a auditním záznamem. Administrátor může u aktivní služby upravit základní sestavu, přelosovat ji nebo přes akci **Člen vypadl** vytvořit časový záskok na část týdne či přesně do konce služby. Ruční záskoky se ukládají odděleně od záskoků odvozených z opakovaných pracovních směn, takže se při jejich přepočtu neztratí.

Časový průběh v detailu služby vzniká vždy z aktuálních záznamů `WeeklyService`, `WeeklyServiceAssignment` a `ServiceReplacement`. Nevyřešený výpadek se zobrazí jako **Vyžaduje záskok** a DRAFT s chybějícím náhradníkem nelze potvrdit. Každé zrušení, změna základního člena a vytvoření, úprava či odstranění ručního záskoku se zapisuje do `AuditLog`.

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

### Jednorázové vytvoření databázových uživatelů

Pro počáteční vytvoření účtů nastavte dočasně u služby JSDH-Dashboard v Railway:

```text
BOOTSTRAP_MARTINB_PASSWORD=<heslo>
BOOTSTRAP_MILANH_PASSWORD=<heslo>
```

Potom jednorázově spusťte:

```bash
npm run users:bootstrap
```

Příkaz bezpečně vytvoří nebo aktualizuje administrátorské účty `MartinB` (Martin Bradáč) a `MilanH` (Milan Hél). Do výstupu, auditu ani zdrojových souborů nezapisuje hesla nebo jejich hashe. Po úspěšném dokončení obě proměnné `BOOTSTRAP_MARTINB_PASSWORD` a `BOOTSTRAP_MILANH_PASSWORD` z Railway odstraňte; běžná aplikace je nepotřebuje. Další účty lze spravovat přímo v sekci **Nastavení → Uživatelé**.
