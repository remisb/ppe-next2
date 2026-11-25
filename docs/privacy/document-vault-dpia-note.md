# Document Vault: note for the DPIA

Input for the data protection impact assessment, for the DPO. It describes what personal data
the Document Vault ([ADR 0008](../architecture/adr/0008-document-vault.md)) processes, where it
is kept, for how long and who reaches it. Questions the DPO must answer are marked **DPO**. It
complements the DPIA that ADR 0007 requires for Personnel files; identity documents are not
processed again here (the vault only lists their kind, issuing state and expiry).

## What is processed

| Data | Where it comes from | Kept as | Who sees it |
| --- | --- | --- | --- |
| Employment contracts, annexes, NDAs, other employment papers: names, personal code, address, pay, terms, signatures | generated from a template, or uploaded as scans | **sealed** (AES-256-GCM, a key per document under `API_VAULT_KEY`) in the database and the files store | the role **Employment Documents** only; each opening recorded |
| Certificates, training records | uploaded | plain files in the private files store; their text in the database | `vault.read` (Administrator, Manager) |
| Invoices, asset documents, other | uploaded | as certificates | `vault.read` |
| Assignment forms, Items Given Records, signed copies | the app's own records, copied as PDFs; signed copies moved from Company Assets | plain files; their text | as their source: the asset kind's permission, every signed-in user for orders |
| Names of linked employees and companies | People | labels and search words on the document | as the document |
| Text read from files (OCR) | the worker, from the files above | for types that are not sealed, the text; for sealed types, search words only, every word with a digit removed | as the document |
| Who did what | the audit trail | events with type, number, dates, sizes; for sealed types never a title, file name, value or text | `audit.read` |

## Purposes and legal basis

- **Employment documents:** keeping the employment contract and its changes, as employment law
  requires; legal obligation (GDPR Art. 6(1)(c)). Generating them from templates is the same
  purpose. **DPO:** confirm the basis and whether an NDA's is the contract or legitimate interest.
- **Certificates and training:** proving qualifications to clients and inspectors; legal
  obligation or legitimate interest. **DPO.**
- **Records of things given:** already processed by Workwear and Company Assets; the vault keeps
  a PDF of the same record. No new purpose.
- **Search over read text:** finding a document; part of the same purposes. It makes data
  easier to find, which is a risk (below).

## Retention

Each type has a rule, applied hourly by the API: when it is due a document is **shredded**,
sealed or not (a sealed one's key, and every document's files, text and links deleted; only
type, number and dates remain in a tombstone row and the audit trail). Lithuania's minimum
periods since 2026-11-25, in code (ADR 0008, open question 1):

| Type | Period | **DPO** |
| --- | --- | --- |
| Employment contract, annex, NDA | 50 years after employment ends (VAD 2.3) | confirm |
| Other employment papers | 3 years after employment ends (VAD 2.2) | decisions on hiring, transfer, dismissal or pay are 50 years (VAD 2.1.1): should they be a type of their own? |
| Certificates, training | 3 years after employment ends (VAD 2.2, 2.14, 2.23) | |
| Invoices | 10 years after the document's date (VAD 3.15; VAT Law art. 78) | |
| Asset documents | 10 years after the document's date (VAD 11.6) | |
| Assignment forms, signed copies | 10 years after the asset's return (VAD 11.6) | |
| Items Given Records | 1 year after the items' service period ends (VAD 2.30) | Workwear's orders hold the same data, kept until removed: set their period |
| Other | until removed | |

Each period counts from 1 January of the year after its day, as the archives' rules count them,
and is Lithuania's minimum (VAD: the index of retention periods for internal records, in force
from 2024-10-01). Keeping a document longer needs a reason stated in the records of processing.
The decisions and their sources: [document-retention-policy.md](document-retention-policy.md).

A **Legal Hold** (a date and reason, recorded) stops the shredding for a dispute or inspection.

## Risks and measures

| Risk | Measures |
| --- | --- |
| A contract read by someone who should not | sealed per document; its own add-on role, Administrator not included; a recent sign-in to open; every opening recorded before the file is sent; never in a URL, log line or error |
| Text read from scans exposes more than the document's title (pay, codes) | sealed types keep no text and no word with a digit; other types' text is reachable only by those who may read the document; search is a POST, so searched names are not logged |
| Search makes it easy to collect everything about a person | results filtered in the database by the reader's permissions; Export needs `data.export`; sealed types show only type and number in results |
| Erasure is incomplete | shredding deletes the key, so the sealed files and values are unreadable at once; the database backups still hold the sealed rows and the key until they expire (14 days today), and the files store's versioning keeps sealed objects that no key opens. Text and search words of types that are not sealed are in the backups for 14 days too. **The DPIA and every erasure answer say "within 14 days".** |
| The worker (OCR) is a second program with the data | the same server, no network beyond the database and the files store, read-only container, no capabilities, a temp folder per job deleted after it; nothing leaves the organisation's servers; no AI is used |
| A key is lost | `API_VAULT_KEY` kept offline as the other keys (`docs/backups.md`); losing it loses every sealed document |
| A template prints a wrong value | Preview before Generate; Generate refused when a value changed after the preview; the hash in the footer proves which values were used |

## Rights of the person

- **Access:** the person's documents are found from their employee page; an export for a
  request is made by a holder of the role and recorded.
- **Rectification:** a new version (a corrected or signed document); earlier versions stay, as
  the record of what was signed.
- **Erasure:** by the retention rule; earlier only where no legal obligation keeps the
  document. **DPO:** decide which types may be erased on request.

## Before go-live

1. The DPO answers the questions above and sets each type's retention.
2. Employees are told that employment documents are kept in the app, sealed, and for how long.
3. The droplet's capacity for the worker is measured (ADR 0008, open question 3).
4. `API_VAULT_KEY` is generated and stored offline before the first sealed document.
