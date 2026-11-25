# Document retention policy

How long the Document Vault keeps each kind of document, why, and what happens when the time is
up. It records the decisions taken on 2026-11-25 and the legal sources they rest on. It
complements the [DPIA note](document-vault-dpia-note.md) and answers open question 1 of
[ADR 0008](../architecture/adr/0008-document-vault.md). The rules as built are in
[vault-service.md](../specs/vault-service.md), "Document types" and "Retention".

- **Status:** decided and built (migration `0066_vault_retention`,
  `internal/vault/types.go`, `internal/vault/document/retention.go`).
- **To confirm:** the data protection officer (DPO). Points the DPO must answer are marked **DPO**.
- **Scope:** documents in the Document Vault. Other records the app keeps, and their own periods,
  are listed at the end; most of them are outside this policy.
- **Not legal advice.** The periods come from the sources below as read on 2026-11-25. Section 7
  lists what was read from secondary sources only.

## 1. Sources

| # | Source | What it gives |
| --- | --- | --- |
| S1 | *Vidaus administravimo dokumentų saugojimo terminų rodyklė* ("VAD"), the index of minimum retention periods for internal administration records, approved by order of the Chief Archivist of Lithuania (amending order No. V-100), in force from 2024-10-01. It replaced the *Bendrųjų dokumentų saugojimo terminų rodyklė* (BDSTR). | The minimum periods per kind of document (items quoted below). |
| S2 | Chief Archivist's table linking BDSTR items to VAD items ([archyvai.lrv.lt](https://archyvai.lrv.lt/public/canonical/1727927150/414/VAD%20ir%20BDSTR%20s%C4%85sajos.pdf)). | The VAD items as quoted here, read in full on 2026-11-25. |
| S3 | Law on Value Added Tax (*PVM įstatymas*), art. 78 ([VMI](https://www.vmi.lt/evmi/apskaita-pvm-s%C4%85skait%C5%B3-fakt%C5%ABr%C5%B3-registras-78-str.-); [VMI on keeping VAT invoices](https://www.vmi.lt/cms/teises-aktai-ir-komentarai15/-/asset_publisher/LqhxhbycFAx3/content/apskaitos-dokumentu-pvm-saskaitu-fakturu-saugojimas/10174)). | VAT invoices are kept 10 years from their issue, authentic, whole and legible. |
| S4 | Regulation (EU) 2016/679, the GDPR. | Storage limitation and minimisation (art. 5(1)(c), (e)); legal obligation as the basis (art. 6(1)(c)); telling people the period (art. 13(2)(a)); exceptions to erasure (art. 17(3)(b), (e)); protection by design (art. 25); the records of processing (art. 30(1)(f)); security (art. 32); the DPIA (art. 35). |
| S5 | State Data Protection Inspectorate (VDAI), guidance for employers ([data protection in employment](https://vdai.lrv.lt/uploads/vdai/documents/files/el_ASMENS%20DUOMEN%C5%B2%20APSAUGA%20DARBO%20SANTYKI%C5%B2%20KONTEKSTE%20Gair%C4%97s%20smulkiajam%20ir%20vidutiniam%20verslui.pdf); [for small and medium businesses](https://vdai.lrv.lt/uploads/vdai/documents/files/01_%20SolPriPa%20Asmens%20duomenu%20apsaugos%20gaires%20SMULKIAJAM%20IR%20VIDUTINIAM%20VERSLUI%202019-11-08.pdf)). | Where no law sets a period, the employer sets a proportionate one and reviews it; a period told to a person is not extended without reason. |
| S6 | Secondary summaries of S1 and of the archives' counting rule ([Legiscope](https://www.legiscope.com/blog/lietuva-dokumentu-rodykles-taikymas.html), [Sintelitika](https://sintelitika.lt/apskaitos-dokumentu-saugojimo-terminai/), [Verslo pamatas](https://www.verslopamatas.lt/naujas-dokumentu-saugojimo-terminu-reglamentavimas)). | VAD's scope (private legal entities' records that legal acts require) and its periods being minimums; periods counted from 1 January of the next year. |

### The VAD items this policy uses (S1, S2)

| VAD item | Documents | Minimum period |
| --- | --- | --- |
| 1.15 | Consents to the processing of personal data | 2 years after the data the consent covers is no longer kept |
| 1.16, 1.17, 1.18 | DPIA documents; legitimate-interest tests; records of processing | 2 years after a new assessment or the record's last update |
| 2.1.1 | Decisions on hiring, transfer, dismissal, pay, parental leave | 50 years |
| 2.2 | Personal file documents (*asmens bylos dokumentai*) | 3 years after employment ends |
| 2.3 | Employment contracts and their annexes, agreements on additional terms included | 50 years after the contract ends; a contract that never took effect 3 years |
| 2.6, 2.12 | Warnings of termination; employees' requests about their work | 3 years |
| 2.14 | Employees' training plans and reports | 3 years |
| 2.23 | Records of occupational safety and health instruction | 3 years |
| 2.28 | Periodic health check documents | 3 years after employment ends |
| 2.30 | Records of personal protective equipment issued to employees | 1 year after the item's period of use ends |
| 3.15 | Primary accounting documents (invoices, payment orders, cash records) | 10 years |
| 3.20 | Payroll calculation documents | 50 years for one of them, 10 for the rest |
| 3.24 | Purchase and service contracts, acceptance acts | 10 years after the contract is fulfilled |
| 11.5 | Inventory documents | 10 years |
| 11.6 | Asset management documents: receipt, issue, write-off, transfer and destruction acts | 10 years |
| 11.11 | Equipment checks, calibration certificates | 3 years after the last check |

## 2. Decisions

**R1. Lithuania's minimum periods are the vault's periods.** Each document type keeps its documents
for the VAD minimum that fits it (R3), and no longer. A legal obligation is the basis for keeping
them while the period runs (S4 art. 6(1)(c)). Keeping a kind of document longer needs a stated
reason, written in the records of processing (S4 art. 5(1)(e), 30(1)(f); S5).

**R2. A period counts from 1 January of the year after its day**, as the archives count retention
(S6). The day is the rule's event: employment ended, the document's date, the asset returned, the
items' service ended. Counting so is never shorter than counting from the day itself. *Example:* a
contract whose employment ended on 2026-01-31 is kept until 2077-01-01.

**R3. The periods per type.**

| Vault type | Rule | Period | VAD item | Notes |
| --- | --- | --- | --- | --- |
| `employment.contract` | after employment ends | 50 years (600 months) | 2.3 | |
| `employment.annex` | after employment ends | 50 years | 2.3 | an annex follows its contract |
| `employment.nda` | after employment ends | 50 years | 2.3 | confidentiality and non-compete agreements are agreements on additional terms of the contract |
| `employment.other` | after employment ends | 3 years (36 months) | 2.2 | decisions on hiring, transfer, dismissal or pay need 50 years (2.1.1): see Q1 |
| `employee.certificate` | after employment ends | 3 years | 2.2 | part of the personal file |
| `employee.training` | after employment ends | 3 years | 2.2, 2.14, 2.23 | |
| `invoice` | after the document's date | 10 years (120 months) | 3.15; S3 | no date: kept until one is given |
| `asset.document` | after the document's date | 10 years | 11.6 | |
| `asset.signed_form` | after the asset is returned | 10 years | 11.6 | the signed assignment form |
| `asset.assignment_form` | after the asset is returned | 10 years | 11.6 | the archived form |
| `order.record` | after the order's longest service period ends | 1 year (12 months) | 2.30 | the archived Items Given Record |
| `other` | until removed | — | none | no law sets a period |

**R4. Every type with a period is shredded when due, sealed or not.** The API's hourly upkeep
computes each document's day (`retain_until`) and, once it has passed, shreds it through the
database owner's function `vault.shred_document`. A sealed document's key goes with it; for every
document its versions, files, read text and links are deleted, and its title and search words
emptied. A tombstone row stays, with the type, number and dates, so the audit trail and a source
still name it; an archived record whose tombstone stays is never archived again. The files are
then deleted from the store. The event `vault.document_shredded` is recorded with no actor. (Before
2026-11-25 only sealed documents were shredded; migration 0066 extended it.)

**R5. A day that cannot be known keeps the document.** While the employee is employed (or never
was, or is not found), the document has no date, the asset is still held or marked Not Returned,
or the order is not given, no day is set and nothing is shredded. Missing data never shortens a
period.

**R6. Removing a document.** A sealed document a user removes is shredded at the next upkeep: its
purpose has ended and it is sealed for erasure. A document that is not sealed is soft-deleted and
waits for its type's day, as if it had stayed; `other` documents removed stay soft-deleted.
Archived and migrated documents cannot be removed: their source owns them.

**R7. Legal Hold.** A dispute, inspection or claim keeps a document past its day (S4 art. 17(3)(e)).
A hold has a last day and a reason, both recorded (`vault.hold_set`, `vault.hold_cleared`); until the
day after it, the document is neither shredded (the SQL function refuses too) nor removed. It is
set by whoever may change the type, or with `vault.manage` for types no one manages in the vault
(signed copies, archived forms and records); only types with a period take one.

**R8. The periods are code.** They are in `vault.Types()`, so changing one is a release, reviewed
with this policy and the DPIA note. They are not settings: a period set by law is not chosen per
installation.

**R9. People are told.** The privacy notice for employees names each kind of document and its
period (S4 art. 13(2)(a)); the records of processing list the same (S4 art. 30(1)(f)). A period
told to people is not lengthened without a reason (S5).

**R10. What remains elsewhere.** Database backups keep shredded rows until they expire (14 days,
`DBBACKUP_KEEP_DAYS`), and the files store's versioning keeps deleted objects for its own period;
a sealed document's copies there open with no key. The audit trail keeps the events about a
document (type, number, dates; never a sealed document's title, file name or values) for
`API_AUDIT_RETENTION` (10 years). Erasure answers say "within 14 days" (DPIA note).

## 3. Not decided yet

- **Q1 (DPO).** Decisions on hiring, transfer, dismissal or pay (VAD 2.1.1, 50 years) have no type
  of their own and fall under `employment.other` (3 years). Add a type for them, or keep them out of
  the vault?
- **Q2.** A contract that never took effect needs only 3 years (VAD 2.3); the vault keeps it as any
  contract, 50 years after employment ends. A longer period than required: acceptable until the
  vault knows a contract never took effect.
- **Q3.** A certificate valid after its holder leaves (rare) goes 3 years after employment ends,
  even if still valid. Keep the later of the two days?
- **Q4 (DPO).** Workwear's orders and Company Assets' assignments hold the same data as their
  archived PDFs and are kept until removed. VAD 2.30 and 11.6 apply to them too; their own periods
  are a change to those domains, not decided here.
- **Q5.** The counting rule (R2) and VAD's scope for private companies come from secondary sources
  (S6). Confirm them against the official text on e-tar.lt.

## 4. Other records the app keeps

Outside this policy, with their own settings (CLAUDE.md, the specs):

| Records | Period | Where set |
| --- | --- | --- |
| Identity documents (Personnel files) | 36 months after employment ends, then shredded (VAD 2.2 fits) | `API_PERSONNEL_RETENTION_MONTHS` |
| Kept scans (Import Documents) | 3 days | `API_PERSONNEL_SCAN_DAYS` |
| Audit trail | 10 years, purged by sealed day | `API_AUDIT_RETENTION` |
| Security log (sign-ins) | 180 days | `API_AUTH_EVENTS_RETENTION` |
| System's error list | 30 days | `internal/system` |
| Worker jobs | done 7 days, failed 90 | `outbox.purge_jobs` |
| Database backups | 14 days, newest 7 always | `DBBACKUP_KEEP_DAYS`, `DBBACKUP_KEEP_LAST` |
| Workwear orders, asset assignments | until removed | Q4 |

## 5. Where it is built

- `internal/vault/types.go`: each type's `Retention` (rules `AfterDocDate`, `AfterEmploymentEnd`,
  `AfterSourceEnds`, `Keep`, `Forever`) with its VAD item.
- `internal/vault/document/retention.go`: `ShredDue` (the upkeep), `dueDay`, `retainFrom` (R2),
  `holdable` (R7).
- `cmd/api/wire_vault.go`: `vaultEmployments` (employment ended), `vaultRecords.Ended` (the asset's
  return; the order's longest service period).
- `internal/db/migrations/0066_vault_retention.up.sql`: `vault.shred_document` for every document,
  the tombstone's empty title.
- Tests: `TestRetentionPeriods`, `TestRetainFrom`, `TestRetentionOfTypesNotSealed`,
  `TestHoldNeedsATimedType`, `TestRetentionShredsWhatIsDue`, `TestPostgresRetentionNotSealed`,
  `TestPostgresSealedDocuments` (docs/testing.md, "Document Vault").

## 6. Changes

| Date | Change |
| --- | --- |
| 2026-11-25 | First version: VAD minimums for every type (contracts, annexes and NDAs from 10 to 50 years); retention and shredding for types that are not sealed; counting from 1 January after; Legal Hold for every type with a period. |

## 7. How the sources were read

S1 was read through S2, the Chief Archivist's table, in full on 2026-11-25; the order's text on
e-tar.lt was not reachable then. S3 was read on VMI's pages. S5 and S6 were read as search
results and summaries. Every period in R3 is from S2; R2's counting rule and VAD's scope are from
S6 only (Q5).
