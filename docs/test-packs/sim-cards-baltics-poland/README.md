# SIM card test pack: Lithuania, Latvia, Estonia, Poland

A demo and a test pack for PPE's SIM cards (Company Assets → SIM Cards, Scan SIMs), with
the mobile operators of the four countries, their prepaid brands, plans, prepaid offers,
services and prices.

> **Demo data.** Operator and brand names are real. Every plan, price, SIM No., phone
> number, PIN and PUK is invented. SIM Nos. are in a test range (`…99…` after the
> operator's code) and pass the Luhn check. Phone numbers are random: never call or text
> them. Provider e-mails are `…@example.com`, so Prepare Activation Email and Prepare
> Blocking Email never reach an operator. Brand colours and logo notes must be checked on
> each operator's own brand or press page before any use; logos are not included.

Everything is made by `generate.py` (fixed seed, so the same files every run):

```bash
python3 -I docs/test-packs/sim-cards-baltics-poland/generate.py docs/test-packs/sim-cards-baltics-poland
```

## What is in it

| File | Rows | What |
| --- | ---: | --- |
| `operators.csv` | 13 | The network operators: legal entity, MCC-MNC, website, VAT, currency, ICCID prefix, provider name in PPE |
| `brands.csv` | 27 | Main brands, prepaid brands and sub-brands, with branding notes and a demo badge colour |
| `plans.csv` | 91 | Postpaid plans per operator: business S/M/L, data-only, IoT/M2M, consumer (prices with and without VAT) |
| `prepaid_offers.csv` | 65 | Prepaid starter packs, bundles and top-ups per prepaid brand |
| `services.csv` | 156 | Add-ons and fees: extra data, roaming, calls abroad, eSIM, SIM replacement, blocking, MultiSIM, private APN |
| `settings_sim_providers.csv` | 26 | Providers for Administration → Settings, with e-mail and default plan |
| `settings_sim_providers.request.json` | – | The same as the body of `PUT /api/v1/settings/sim-providers` |
| `sim_cards.csv` | 91 | Every imported card with its plan, PIN, PUK and expected result |
| `import/sim-import-{lt,lv,ee,pl,all}.csv` | 91 | The import files, in the import's 5 columns |
| `import/sim-import-all-semicolon-bom.csv` | 91 | The same, with semicolons, an Excel byte order mark and the columns in another order |
| `import/sim-import-errors.csv` | 6 | A file that must be refused (`.expected.csv` says why, per line) |
| `scan_cards.csv`, `scan_cards.html` | 60 | Printable test carriers for Scan SIMs: 52 valid, 8 made to be marked |
| `add_sim_manual.csv` | 26 | One SIM No. per provider for Add SIM by hand |
| `sim_samples.csv`, `sim_samples.html` | 48 | A sample SIM card for each of the 27 brands, and an eSIM for the 21 whose plan or offer has one: SIM No., phone, PIN, PUK, PIN2, PUK2, IMSI, eSIM activation code, plan and price; the page prints them at card size (85.6 × 54 mm) with barcodes and QR codes |
| `import/sim-import-samples.csv` | 48 | The samples as an import file, all Not Activated and in the Office |
| `test_cases.csv` | 26 | The test cases: steps, expected result, data file, priority, role |
| `json/` | – | Every dataset as JSON, and `all-data.json` with all of them |
| `sql/sim_testpack.sql` | – | Every dataset as tables in a standalone schema `sim_testpack` (for reports; PPE never reads it) |

The countries' VAT: Lithuania 21 %, Latvia 21 %, Estonia 24 %, Poland 23 %. Polish prices
are in PLN, the others in EUR.

SIM No. blocks keep the files apart, so they never collide: `…1 99…` import files,
`…2 99…` scan cards, `…3 99…` Add SIM by hand, `…4 99…` sample SIM cards, `…9 99…` negative tests.
The samples' eSIM activation codes point at `smdp.example.com`, and their IMSIs have `99` after the network code.

## Setting up

1. A database with the demo employees: `make db-up && make migrate && make seed-demo`
   (the import's holders are the demo's six employees).
2. Settings: add the 26 providers from `settings_sim_providers.csv` on Administration →
   Settings, or send `settings_sim_providers.request.json` with
   `PUT /api/v1/settings/sim-providers`. This replaces the demo's three providers.
3. Import the SIM list (check first, then commit):

```bash
make import-sims FILE=docs/test-packs/sim-cards-baltics-poland/import/sim-import-all.csv
```

```bash
make import-sims FILE=docs/test-packs/sim-cards-baltics-poland/import/sim-import-all.csv COMMIT=yes
```

4. For Scan SIMs, open `scan_cards.html` in a browser and print it on A4 at 100 %, or show
   it on a second screen.

## Demo script (15 minutes)

1. **Settings.** Show the 26 providers: an operator per country and its prepaid brands,
   each with its own e-mail and default plan.
2. **SIM Cards.** Open the register: the tabs' counts, a Latvian, an Estonian and a Polish
   number, a prepaid Labas card and a held Bitė card. Find a card with ⌘K by its last digits.
3. **Give and return.** Give an Active card to Ona Kazlauskienė against the printed form,
   upload the signed copy, then Return it.
4. **E-mails.** Prepare Activation Email for a Not Activated card: the provider's address,
   the card's numbers, Send Email opening the mail app.
5. **Scan SIMs.** Scan four valid test cards (front and back), then SC-053 to SC-060: the
   review list marks the check digit, the duplicate, the `…5F` filler, the PIN, the PUK and
   the registered card. Add the valid ones; Show PIN and PUK for one of them.
6. **Audit log.** Filter `asset.*`: every step above is there, with who and when.

## Test pack

`test_cases.csv` holds 26 cases (P0 must pass before a release, P1 should, P2 nice to
have), each with its role, preconditions, steps, expected result and data file. Testers
fill in a copy with their result; the Data artifact shows the same cases.

What the import does with `sim-import-errors.csv` (checked against the dev database):
the first pass names lines 2–4 (Available with a holder, an unknown employee, an unknown
status) and writes nothing. Delete those lines and run again: the unknown provider is only
noted, line 6 is refused (not a phone number) and, after the good import, line 5 too
(SIM No. already registered).

## Branding

`brands.csv` has, per brand: its kind (main, prepaid, sub-brand, digital), website, the
brand colour where it is widely documented (Telia purple `#990AE3`, Orange `#FF7900`,
T-Mobile magenta `#E20074`, Tele2's black and white), a status saying what still needs
checking, a short logo description and a trademark note. Brands are trademarks of their
operators: take logo files from the operator's own website or press page, use them only to
name the provider, and never redraw them. `demo_badge_color` and `demo_badge_text` are this
pack's own neutral badges for mock-ups, not the brands' colours.

Open points to check before relying on them: Telia merged its Estonian prepaid brands in
2024 (the pack calls it "Telia kõnekaart"); Elisa's and Bite Latvija's prepaid brand names;
the official colours left blank in `brands.csv`.
