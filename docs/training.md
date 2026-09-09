# Školení / Odborná příprava

Modul používá stávající členy podle memberId a je nezávislý na plánování služeb. Školení může kombinovat libovolný počet témat z různých kategorií, interního nebo externího školitele a evidenci přítomných, nepřítomných i omluvených členů. Nový formulář načte aktivní nesystémové členy jako nepřítomné; skutečnou docházku potvrdí administrátor.

## Nasazení a knihovna

Po nasazení migrace spusťte `npm run training:topics:import`. Railway provede migraci i import v pre-deploy krocích z railway.toml. Při ručním přepsání konfigurace Railway zachovejte pořadí obou kroků.

Import obsahuje 273 témat ve 31 kategoriích ze zadání jednotky. Stabilní kód zahrnuje kategorii i název: stejnojmenné téma a specializační kurz zůstávají samostatnými položkami. Opakované spuštění pouze doplní chybějící kódy; nemění existující názvy, zdroje, pořadí ani aktivní stav. Celé texty metodik nejsou součástí knihovny. Vlastní témata se spravují v záložce Témata.

## Evidence a archiv

Vyberte Nové školení, datum, volitelné časy, délku v minutách, témata, formu, místo a školitele. Časy se interpretují v Europe/Prague, včetně letního času. Časová dotace se při zadání od–do vypočítá a lze ji ručně upravit. Aktuální formulář pracuje s časy v jednom dni; délku bez časů lze zadat samostatně.

Návrh lze uložit i bez účastníků. Dokončení vyžaduje alespoň jednoho evidovaného účastníka. Úprava dokončeného záznamu vyžaduje výslovné potvrzení; stejně tak trvalé odstranění. Přítomnost není automaticky odvozována ze služeb, DT ani kondičních jízd a jejich evidenci nemění.

Archiv filtruje rok, měsíc, kategorii, téma, školitele, formu, stav a hledaný název tématu. Historie člena používá jeho memberId. Souhrny započítávají dokončená školení v aktuálním roce a pouze skutečně přítomné účasti; poslední školení je poslední dokončený záznam napříč roky.

Názvy témat, jména a funkce účastníků jsou zachyceny při přidání do záznamu. Pozdější změna knihovny nebo profilu člena proto nepřepíše archivní dokument. Použité téma se při odstranění pouze deaktivuje. Smazání školení odstraní vazby témat a účastníků, ale zachová AuditLog.

## Prezenční listina

Tlačítko Prezenční listina PDF vytváří A4 dokument s tématy, školitelem a podpisovými poli. Podpis se doplňuje fyzicky; elektronické podpisy se neshromažďují. Návrh je v dokumentu viditelně označený. Více stran opakuje hlavičku tabulky a obsahuje číslování stran.

PDF se generuje na serveru z uloženého záznamu pomocí pdf-lib a lokálně vloženého fontu Noto Sans (licence OFL v assets/fonts/OFL.txt). Font je součástí produkčního balíčku, nevyžaduje síť ani fonty operačního systému. PDF se vrací s private/no-store. Dokument netvrdí úřední schválení ani certifikaci.

## API a ověření

Všechny /api/training endpointy vyžadují současnou administrátorskou session. U dokončeného záznamu předá PATCH příznak completedAcknowledged=true. DELETE vyžaduje confirmed=true a u dokončeného záznamu také completedAcknowledged=true. Změny i audit jsou v transakci; editace stejného školení se serializují databázovým zámkem.

Testy pokrývají validaci, migraci v izolovaném PostgreSQL enginu PGlite, duplicity knihovny, API s mockovanou databází a autentizací, ochranu dokončených záznamů, docházku a vícestránkové PDF. Žádná skutečná data členů se nepoužívají ani nevkládají do seedu. Spuštění: npm test, npm run lint, npm run build.

Obsah školení, přílohy, roční plány ani AI generování nejsou v této verzi implementovány.
