# Billing Software

**Developer:** Akshat Shah

**Status:** v0.4: payment receipts, statements of account, fees report, client groups, payments, credit notes, PDF bills, exports and off-PC backups (backend, frontend and automated tests)

## Description

A billing software for an accountancy firm to manage clients, services and bills.

## Features (v0.1)

- Login and logout (no public sign-up: an admin creates the staff accounts)
- Staff management (admin): create accounts, reset passwords, deactivate / reactivate
- Add client, update client details (including **Referred by**), delete client (soft delete, with restore)
- A **folder per client on the PC**, named after the client, holding their details and a printable copy of every bill
  (updated automatically; see "Client folders" below)
- Add service (with a description), update service, deactivate service
- Create bill with several line items and a live total preview. Each line shows the service's description
  as entered in the service, copied onto the bill
- Update bill
- Search bills by client name or bill number, newest first, paginated, with a **financial year dropdown**
  (Indian FY, April to March, e.g. 2026-27)
- Print-friendly bill view (prints without the browser's date, title and address header)
- Organisation settings (admin): firm details, **logo upload**, **payment details** (bank account, IFSC, UPI ID and
  instructions, so clients know where to pay), and a GST on/off toggle with a configurable rate. The logo and
  payment details print on every bill and in the client-folder copies

## New in v0.2

- **Gap-free bill numbers per financial year**: `2026-27/0001`, `2026-27/0002`, ... A failed save never uses up a number.
  Credit notes have their own series (`CN/2026-27/0001`).
- **Financial year chosen separately from the bill date**: the New bill form starts with a financial year dropdown
  (2026-2027, 2025-2026, ... back to 2000-2001), so a bill made today can be for an earlier year's work, and old bills can
  be entered. The bill is numbered in, listed under and exported with that year; the bill date is just the date printed on it.
- **Professional invoice layout** (v0.2.1): bills, PDFs and client-folder copies are titled *PROFESSIONAL INVOICE* and show the
  firm's name, the line under it (e.g. *Tax Consultants*), address and mobile number; Bill No., Date and the client's File No.;
  Sr. / services rendered / Year (*FY 2025-2026*) / Amount; the total in words (*Four Thousand Rupees Only*) with *E.& O.E.*;
  the due date under *Remarks*; *For, firm name* with the signatory and the firm's state (*GUJARAT(24)*); and *Subject to
  Ahmedabad jurisdiction*. The mobile number, line under the name, state, signatory and jurisdiction city are set in Settings.
- **Mobile numbers are checked**: a client's mobile (and the firm's) must be 10 digits; "+91 98250 12345" and "098250-12345" are
  tidied to "9825012345".
- **Financial year per item**: each line of a bill has its own financial year, shown in an FY column on the bill (in place of
  a quantity), so one bill can cover e.g. *Income Tax Return 2023-24* and *2024-25*.
- **Payments**: record full or part payments (UPI, bank transfer, cash, cheque, card) with a reference. A wrong payment is
  *voided* (kept, crossed out, with who and why), never deleted.
- **Due dates and status**: each bill gets a due date from your payment terms. Bills show *Unpaid*, *Part paid*, *Overdue*,
  *Paid*, *Credited* or *Cancelled*, and the Bills page shows totals billed, received, to collect and overdue.
- **Client paid less (haggling)**: bills always go out at the full amount. If a client pays less and the firm accepts it,
  tick *settle the bill* when recording the payment (or use *Settle the bill* later). On a GST bill this issues a **credit note**
  for the shortfall, split exactly into fee + GST at the bill's rate, so the GST owed comes down to what was received (report it
  in GSTR-1). After the credit note deadline for that year (30 November after it ends) only a plain **discount** is possible,
  which leaves the GST unchanged. Bills without GST are settled with a discount. Totals and exports show discounts separately.
- **Credit notes** correct an issued bill without editing it. Once a bill has a payment or credit note its client, date
  and items are locked.
- **Cancel** a bill issued by mistake (admin, with a reason). The bill and its number are kept.
- **Change history** on every bill: who created, edited, paid, credited or cancelled it, and when.
- **PDF** of every bill and credit note, and **Send on WhatsApp** (opens the chat with the message ready; attach the PDF).
- **CSV exports** that open in Excel: the bills register (with the current filters) and a client statement with a running balance.
- **Backups that survive the PC failing**: a second backup location (USB, network share or cloud-synced folder) set in
  Settings, plus **Back up now**.
- **Redesigned interface** following Apple's Human Interface Guidelines (see "Look and feel").
- **Installer** for every Windows 10 (1607+) and Windows 11 PC: 64-bit, ARM and 32-bit, with a port check and a start-up check.

## New in v0.3

- **Paid on the client's behalf**: a bill line can be money the firm paid for the client (e.g. income tax paid from the firm's
  account, with the challan details). It carries no GST and is not counted as fees; the bill shows it in its own section and
  the total payable includes it. Payments go towards it first; a short payment is settled from the fees, never from it.
- **Client groups**: a family (or any related clients, e.g. an HUF and its members) can be grouped. Clients and bills can be
  filtered by group, and the group gets one combined statement.
- **Statement of account** (Clients → Ledger, or Groups → Ledger) for any period, as a PDF in the firm's format: opening
  balance, every bill and receipt with a running balance, Total, OUTSTANDING BALANCE, the bills still pending (receipts applied
  to the oldest bill first), and a closing request with the bank details.
- **Fees report** (Reports, administrators): every bill in a period in brief with a summary and a month-by-month table, on
  screen, as Excel (Summary, Month by month and Bills sheets) and as PDF. Fees are kept apart from GST and amounts paid on behalf.
- **Forgot password** for administrators: a link on the login page sends a one-time reset link (valid 30 minutes) to the
  admin's email address. Set up the mail server under Settings → Email and add each admin's email under Staff → Edit.
  Changing a password logs that account out everywhere else. Staff passwords are still reset by an administrator.

## New in v0.4

- **Payment receipts**: every payment recorded, full or part, gets an acknowledgement receipt with its own gap-free number
  per financial year of the date the money came in (`RCT/2026-27/0001`). The receipt says who paid, how much (in figures and
  words), how and when, against which bill, and what is still due on that bill after it, marked *FULL PAYMENT* or
  *PART PAYMENT* (a cheque receipt adds "subject to realisation"). Payments recorded before v0.4 are numbered when updating,
  in the order they were received.
- **Send it to the client** straight after recording the payment: the receipt opens with **View PDF**, **Download PDF**,
  **Send email** (the PDF attached, to the client's saved email or any address typed in, through the mail server under
  Settings → Email) and **Open WhatsApp** (the message ready; attach the PDF). Every receipt can be opened again from the
  bill's Payments list. A voided payment keeps its number and its receipt is stamped *VOID*.
- **Payment dates everywhere**: receipt numbers and dates on the bill PDF and the client-folder copies; a `receipts` folder
  in each client's folder; the receipt number as the reference on the statement of account; *Last paid* on the Bills page
  and a *Last paid on* column in the bills register CSV; receipt numbers in the client statement CSV.
- **Fees report**: a **Receipts** list of the money received in the period by the date it came in (on screen, a Receipts sheet in
  Excel and a section in the PDF), *Collected in period* in the summary, a *Collected* column month by month, and the last
  payment date of each bill.

## Tech Stack

| Area | Technology |
|---|---|
| Language | TypeScript |
| Frontend | React (with Vite), React Router |
| Backend | Node.js + Express 5, Zod validation |
| Database | PostgreSQL (plain SQL migrations, `pg` driver) |
| Auth | JWT + bcrypt, roles: admin / staff |
| Tests | Vitest + Supertest |
| Version control | Git + GitHub |
| Project management | GitHub Projects |

## Project structure

```
billing-software/
├── server/              Express API
│   ├── migrations/      SQL files, applied in order at startup
│   ├── src/routes/      auth, users, clients, services, settings, bills
│   ├── src/lib/         money maths, paging, error handling
│   ├── src/scripts/     seed.ts (creates the first admin), restore.ts (restores a backup)
│   └── test/            automated tests
├── client/              React app
│   └── src/pages/       one file per screen
├── installer/           Windows installer (Inno Setup script, build script, wizard text)
├── .github/workflows/   CI tests and the release build
└── docs/decisions.md    why things are the way they are
```

## Documentation

| Document | For |
|---|---|
| [User guide](docs/user-guide.md) | Staff and administrators: every screen, step by step, backups and troubleshooting |
| [API reference](docs/api.md) | Every endpoint, field limit, status code and the GST/financial-year rules |
| [Architecture and development](docs/architecture.md) | How it is built, data model, configuration, tests, installer and releases |
| [Decision records](docs/decisions.md) | Why each important choice was made |
| [Test catalogue](docs/tests.md) | Every automated test, the latest results, the checks done by hand, and what is not tested yet |

**PDF copies** of all of these are in [docs/pdf](docs/pdf): one PDF per document, plus `Billing-Software-Documentation.pdf`,
which has everything in one file with a cover page and clickable contents. They are built from the Markdown files, so after
editing the docs regenerate them (needs Microsoft Edge or Google Chrome installed):

```bash
cd docs/pdf-build
npm install
npm run build
```

## Installing on a new computer (Windows)

For an office, use the installer. It needs nothing installed beforehand.

1. Open the project's **Releases** page on GitHub and download `BillingSoftware-Setup-<version>.exe`
   (the `.sha256` file next to it lets you verify the download).
   It works on any Windows 10 (version 1607 or newer) or Windows 11 PC: 64-bit Intel/AMD, ARM (Snapdragon) and 32-bit.
   The installer picks the right Node.js for the machine.
2. Run it. Windows may say "unknown publisher" because the installer is not code-signed:
   choose **More info > Run anyway**.
3. The wizard explains what it will do, then asks for a network port (default 4000, and it warns if another program
   already uses it), where to keep client folders, and the first administrator's name, username and password.
   It shows a full summary before it installs anything.
4. When it finishes, the software is already running as a Windows service (the wizard waits until it answers). Open
   `http://localhost:4000` on that PC, and `http://<that-pc-name>:4000` from the other office PCs.

What the installer sets up: the program in `C:\Program Files\Billing Software`, a Windows service that
starts with Windows, a firewall rule for private/domain networks only, and a data folder
`C:\ProgramData\BillingSoftware` holding the database, daily backups (last 14 kept) and logs.
Running the installer again upgrades the program and keeps all data. Restoring a backup:
`"C:\Program Files\Billing Software\tools\restore.cmd" "<backup file>"` from an administrator prompt.
The wizard's own pages ([before](installer/info-before.txt), [after](installer/info-after.txt)) cover this in more detail.

### Publishing a new installer (for the developer)

Either push a version tag from your PC:

```bash
git tag v0.3.1
git push origin v0.3.1
```

or create the release on GitHub's website: **Releases → Draft a new release**, choose the tag (e.g. `v0.3.1`,
"Create new tag on publish"), target `main`, write the notes and **Publish release**.

Either way, the workflow in `.github/workflows/release.yml` runs the tests, builds the app, bundles Node.js and the
service wrapper, compiles the installer with Inno Setup and attaches `BillingSoftware-Setup-<version>.exe` and its
`.sha256` to the release (a release made on the website keeps its title and notes). To rebuild a release's installer,
use **Actions → Release installer → Run workflow** and type its tag.
To build locally, run `installer\build.ps1`, then compile `installer\billing.iss` with Inno Setup 6.3+.
The icon and wizard pictures in `installer/assets` are drawn by `installer\make-art.ps1` (run it again only if the artwork changes).

## Getting started (for development)

You need Node.js 22 or newer. For a real database you also need PostgreSQL.

### 1. Backend

```bash
cd server
npm install
cp .env.example .env
```

Open `server/.env` and set:

- `DATABASE_URL`. Use your PostgreSQL connection string, for example
  `postgres://postgres:YOURPASSWORD@localhost:5432/billing` (create an empty `billing` database first).
  The default, `pglite:./.data`, is an embedded Postgres that needs no setup, which is handy for a quick try.
- `JWT_SECRET`. Any long random string.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`. The first admin account. Change the password from the example.

Then create the tables and the first admin, and start the API:

```bash
npm run seed
npm run dev
```

The API runs on http://localhost:4000.

### 2. Frontend

In a second terminal:

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173 and log in with the admin you seeded.

### 3. Tests

```bash
cd server
npm test
```

The tests use an in-memory Postgres (PGlite), so they need no database setup.

### Running as one server

`npm run build` in `client/` creates `client/dist`. When that folder exists, the Express server serves it too,
so the whole app runs from http://localhost:4000.

## Key design rules

- **Money is whole paise** (integer), never floating point. The screens convert to rupees.
- **GST is a snapshot.** A bill stores the rate and amount it was created with. Changing the setting later
  never changes old bills, and editing a bill recalculates with that bill's own rate.
- **Soft delete** for clients and staff, so old bills always point at a real record.
- A bill line keeps a **copy** of the service's description, so editing the service later never changes old bills.
- A bill's **financial year** (1 April to 31 March) is chosen when it is made and stored on the bill. It is not taken from
  the bill date. If no year is given (e.g. through the API), the year of the bill date is used.
- Each bill records who created it and who last edited it, and when.
- Deactivated staff lose access immediately, not when their login token expires.

See [docs/decisions.md](docs/decisions.md) for the reasoning behind these choices.

## Look and feel

- **Apple Human Interface Guidelines**, as summarised in [dickwu/apple-design-skill](https://github.com/dickwu/apple-design-skill):
  semantic colour roles with light, dark and increased-contrast values; the system font with HIG text styles and no light weights;
  a translucent sidebar and sheets (the "functional layer") over opaque content (lists, tables and bills); one prominent button per
  view; actions in sheets with a visible Cancel; history behind a disclosure; status always shown as words plus a shape, never colour
  alone; respects reduced motion, reduced transparency and increased contrast.
- **Light, dark and system themes.** A three-way switch in the top bar (and on the login page): *device setting*, *light*,
  *dark*. The choice is remembered in the browser and applied before the page paints, so there is no white flash.
  Bills stay a white sheet of paper in dark mode, exactly as they print, so any logo reads correctly.
- **Restrained motion**: this is a tool used all day, so clicks, row selection and filter changes do not animate. Only sheets
  fade in, and messages fade. Hover effects only on devices that can hover; tabular figures for amounts.
- **Phone friendly.** The Bills list and the bill form become card layouts on narrow screens, inputs are 16px so iPhones do not
  zoom in, tap targets are at least 44px on touch screens, and safe-area insets are respected.
- **Plain-language errors and enforced limits.** Forms stop you typing past a field's limit, and messages read like
  "Phone is too long (at most 20 characters)".

## Client folders

For every client the server keeps a normal folder, named after the client, as a human-readable second copy:

```
Client Files/
  Rajesh Patel/
    client-details.txt        details and a list of the client's bills
    client-data.json          the same data in full, for other programs
    bills/INV-000007_2026-11-05.html     each bill, printable in any browser
```

- Updated whenever a client or bill is saved, and checked again every time the server starts.
- Two clients with the same name: the second folder gets the client number added, e.g. `Rajesh Patel (2)`.
- Renaming a client renames the folder. Deleting a client keeps the folder and marks its details file as deleted.
  Folders are never deleted by the software.
- Location: `CLIENT_FILES_DIR` in `server/.env` (default `server/client-files` in development, the folder chosen
  in the installer wizard when installed). Admins can see the location, the last error, and press
  **Rebuild all client folders now** under Settings.
- If the disk cannot be written to, bills still save and Settings shows the error.

## Known limitations (ideas for v0.3)

- GST is one flat rate (no CGST/SGST/IGST split, HSN/SAC codes or GST reports).
- WhatsApp sending opens the chat with the message ready; the PDF has to be attached by hand (a link cannot attach files).
- No email sending.
- The login rate limit is in memory, so it resets when the server restarts.
- The installer is not code-signed, so Windows SmartScreen shows "unknown publisher".
