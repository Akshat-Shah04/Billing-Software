# Test catalogue

Every automated test the app has, grouped by test file and area, with the result of the latest run. It also lists the
checks that were done by hand in a running copy of the app, and what has **not** been tested yet.

## Latest run

- **Date:** 07 Nov 2026, 20:29
- **Result:** 112 of 112 tests passed, 0 failed
- **Command:** `cd server && npm test` (Vitest + Supertest). Each test file starts its own in-memory PostgreSQL
  (PGlite), so no database setup is needed and tests never touch real data.
- **Also checked:** `npm run typecheck` in `server/` and `npm run build` in `client/` (TypeScript and production build) both pass.

| Test file | Area | Tests | Result |
|---|---|---:|---|
| [`server/test/money.test.ts`](../server/test/money.test.ts) | Money maths | 4 | 4 passed |
| [`server/test/api.test.ts`](../server/test/api.test.ts) | Core API (v0.1) | 37 | 37 passed |
| [`server/test/clientFiles.test.ts`](../server/test/clientFiles.test.ts) | Client folders on disk | 15 | 15 passed |
| [`server/test/v02.test.ts`](../server/test/v02.test.ts) | v0.2 features | 56 | 56 passed |
| **Total** | | **112** | **112 passed** |

## Money maths: `money.test.ts`

Integer paise and GST rounding, used by every amount in the app.

### calculateTotals

- ✅ Adds up line items with no GST
- ✅ Applies 18% GST exactly
- ✅ Rounds half a paisa up
- ✅ Handles fractional rates without floating point drift

## Core API (v0.1): `api.test.ts`

Logins, staff, clients, services, settings, logo, bills, GST and financial years.

### Auth

- ✅ Rejects wrong passwords and unknown users the same way
- ✅ Requires a token for protected routes
- ✅ Returns the current user

### Staff management (admin only)

- ✅ Blocks staff from user and settings changes
- ✅ Rejects duplicate usernames and short passwords
- ✅ Deactivated staff lose access immediately and cannot log in
- ✅ Stops an admin deactivating themselves

### Clients

- ✅ Validates input
- ✅ Normalises PAN and GSTIN, and stores empty text as null
- ✅ Searches by name and phone, and soft delete hides a client
- ✅ Treats % in a search as a normal character

### Organisation payment details and logo

- ✅ Saves payment details (admin) and any logged-in user can read them
- ✅ Stops staff changing payment details, the logo, or removing it
- ✅ Returns 404 before any logo exists
- ✅ Accepts a PNG logo, serves it back to everyone, and removes it again
- ✅ Refuses SVG, fake images, empty uploads and files over 1 MB
- ✅ Detects the real image type from its contents, not the label

### Validation messages a person can act on

- ✅ Says what is wrong in plain words, never database or library jargon
- ✅ Names the item and the field when a bill line is wrong
- ✅ Explains username and password rules in full sentences

### Unrealistic bill totals

- ✅ Refuses quantity x price that is too large to add up exactly, instead of storing a wrong total
- ✅ Still accepts a very large but realistic bill, and shows it exactly
- ✅ Applies the same limit when editing a bill

### Client referred_by

- ✅ Stores, updates and searches the referrer

### Bill line details (service description)

- ✅ Keeps the service description on the bill even if the service is edited later

### Financial years

- ✅ Puts 31 March and 1 April in different financial years
- ✅ Lists the financial years that have bills, newest first, with labels
- ✅ Rejects a nonsense year

### Services

- ✅ Creates, updates and deactivates a service
- ✅ Rejects fractional paise (money must be whole paise)

### Bills

- ✅ Creates a bill with no GST by default and assigns sequential numbers
- ✅ Rejects empty bills, bad quantities, missing and deleted clients
- ✅ Snapshots GST on each bill: changing the setting never alters old bills
- ✅ Records who last edited a bill and replaces its items
- ✅ Keeps old bills visible after their client is soft-deleted
- ✅ Searches by client name or bill number, newest first, with paging
- ✅ Returns 404 for unknown bills and 400 for bad ids in filters

## Client folders on disk: `clientFiles.test.ts`

The folder per client with their details and a printable copy of every bill.

### folderBase

- ✅ Makes safe Windows folder names

### Client folders

- ✅ Creates a folder named after the client with their details
- ✅ Writes every bill as a readable file, including the service description and GST
- ✅ Escapes HTML in client-entered text
- ✅ Gives clients with the same name separate folders
- ✅ Removes characters Windows does not allow from the folder name
- ✅ Renames the folder (keeping its bills) when the client is renamed
- ✅ Replaces the bill file when the bill date changes, and moves it when the client changes
- ✅ Keeps the folder when a client is deleted, and marks it
- ✅ Rebuilds missing folders for every client (admin only)
- ✅ Reports the folder and status

### Logo and payment details on bill copies

- ✅ Embeds the logo and shows where to pay, and escapes the text
- ✅ Refreshes existing bill copies automatically when the settings change
- ✅ Leaves the payment box out when no payment details are filled in

### When the folder cannot be written

- ✅ Still saves the client and bill, and reports the problem

## v0.2 features: `v02.test.ts`

Numbering, financial year, due dates, payments, credit notes, settling short payments, exports, PDFs and backups.

### Gap-free numbering, restarting each financial year

- ✅ Numbers bills 0001, 0002, 0003 within a financial year
- ✅ Starts again at 0001 in the next financial year (31 March and 1 April are different years)
- ✅ Gives a back-dated bill the next number of ITS OWN year's series
- ✅ Does not use up a number when a save fails (the counter rolls back with it)
- ✅ Does not use up a number when a bill is rejected
- ✅ Gives every bill saved at the same moment a different, consecutive number
- ✅ Keeps the bill number and financial year when a bill is edited, and refuses to change the year

### Financial year chosen separately from the bill date

- ✅ Numbers, files and filters a bill by the year chosen, not by its date
- ✅ Uses the bill date's year when no year is given, and refuses a year too far ahead or too old

### Financial year on each bill line

- ✅ Keeps a year per line, so one bill can cover several years
- ✅ Records a change of a line's year as an edit, and keeps lines' years when editing
- ✅ Refuses a nonsense year on a line

### Due dates

- ✅ Defaults to the bill date plus the payment terms, and follows a changed setting
- ✅ Accepts a chosen due date and refuses one before the bill date
- ✅ Validates the new settings

### Payments

- ✅ Tracks part payments, the balance and when a bill is paid
- ✅ Refuses overpayment, nothing-left bills, bad methods, zero and future dates
- ✅ Voids a wrong payment (admin only), keeping it on the record but not counting it
- ✅ Lists bills by status and totals what is outstanding and overdue

### Change history and edit rules

- ✅ Records who changed a bill and how, and keeps the version before each edit
- ✅ Records nothing when an edit changes nothing
- ✅ Locks the client, date and items once a payment or credit note exists, but allows notes and due date
- ✅ Cancels a bill (admin only, with a reason), keeping its number and removing it from the totals
- ✅ Will not cancel a bill that has payments or credit notes

### Credit notes

- ✅ Issues a credit note that reduces the balance, with its own consecutive number
- ✅ Uses the GST rate of the bill it corrects, not today's setting
- ✅ Cannot credit more than is still unpaid, and cannot credit a paid-up or cancelled bill
- ✅ Validates dates and content, and a fully credited bill shows as credited
- ✅ Records the credit note in the bill's history

### CSV exports for filing

- ✅ Exports the bills register in Excel-friendly form, honouring the filters
- ✅ Stops a client name from being run as a spreadsheet formula
- ✅ Exports a client statement with a running balance that matches what is owed

### Discounts: the client pays less and the firm agrees to settle

- ✅ Leaves a bill paid in full exactly as it was: no discount is ever assumed
- ✅ Keeps the rest due when the client pays less and nobody settles
- ✅ Settles 15,000 paid with 12,000: the 3,000 becomes a discount and the bill itself is unchanged
- ✅ Uses a default reason, and does nothing extra when the payment already covers the balance
- ✅ Can let go of the rest later, on its own, but never more than is due
- ✅ Lets an admin void a wrong discount, so the amount is owed again
- ✅ Shows a bill settled only by a discount as written off, and blocks cancelling while a discount stands
- ✅ Puts discounts in the totals, the register and the client statement

### Settling a GST bill: a credit note brings the GST down to what was received

- ✅ Splits a shortfall back into fee + GST that add up exactly
- ✅ Issues a credit note for the shortfall by default on a GST bill (17,700 paid with 14,000)
- ✅ Can still settle a GST bill with a plain discount when the user chooses it
- ✅ Refuses a credit note after the 30 November deadline for that year, and says to use a discount
- ✅ Settles whatever is left later, without a new payment

### PDF of a bill or credit note

- ✅ Downloads a real PDF named after the bill
- ✅ Copes with Gujarati and Hindi names, the rupee sign, emoji and very long text without failing
- ✅ Flows a long bill over several pages
- ✅ Makes PDFs for cancelled bills, bills with payments, and credit notes
- ✅ Needs a login and returns 404 for unknown documents

### Backups to a second location

- ✅ Backs up the database locally, copies it to the second location, and mirrors the client folders
- ✅ Keeps only the 14 newest database backups in each place
- ✅ Still backs up locally, and reports the problem, when the second location cannot be written
- ✅ Rejects second locations that would not work
- ✅ Is off, with a clear message, when no backup folder is set up
- ✅ Is controlled by admins only, over the API

## Checks done by hand in the running app

Done in a throwaway preview copy (its own database, sample clients and bills), not on real data.

| Area | What was checked |
|---|---|
| Login page | Renders in light and dark themes; theme switch works. |
| Bills list | Totals tiles (billed, received, to collect, overdue) match the sample data; status filter, year filter and search work; desktop sidebar layout and phone layout (375 px wide, no sideways scrolling). |
| Bill page | Document matches the print layout; balance, due date and overdue state shown; side panel actions open their sheets. |
| Record payment | Sheet opens with the balance and today's date filled in; Cancel always visible. |
| Client paid less, GST bill | ₹20,000 paid on ₹23,350 due with "settle the bill" ticked: credit note CN/2026-27/0003 issued for ₹3,350 (fee ₹2,838.98 + GST ₹511.02), bill kept at its full ₹38,350, status Paid, balance ₹0. |
| WhatsApp | Opens WhatsApp with the client's number (+91 prefix added) and the bill message filled in. |
| PDF | Bill PDF downloads and reads correctly: ₹ sign, Noto Sans fonts, totals, payments received and payment details. |
| Client statement CSV | Downloads; running balance matches the bill. |
| Financial year chosen separately | Bill dated 07 Nov 2026 for FY 2023-24 was numbered 2023-24/0001 and listed under 2023-24. |
| Financial year per item | Bill form has a Financial year column instead of Qty; the bill page and PDF show an FY column, no financial year line at the top, and "x 3" under the price only for an older line with a quantity. |
| Bills totals after settling | Billed tile and Total column show the net amount after credit notes and discounts (e.g. 2,950.00 bill settled at 590.00 shows "590.00 of 2,950.00"). |
| Settings | Backups section (location, second copy warning, Back up now) and client folders section render; long folder paths wrap. |
| Clients | List, Bills and Statement links, add/edit sheet. |
| Installer artwork | Icon frames (16 to 256 px) read back correctly; wizard picture checked visually. |

## Not tested yet

- **The React screens have no automated tests.** They were checked by hand (above) and by the TypeScript build.
- **The Windows installer has not been compiled or run.** Inno Setup is not installed on the development PC. The CI job `installer` in `.github/workflows/ci.yml` compiles it on every pull request.
- **Installing on real machines:** Windows 10 and 11 on 64-bit, ARM (Snapdragon) and 32-bit PCs; upgrading from v0.1; the port-in-use warning and the start-up check. All of these need a test run on actual PCs.
- **Running on Node.js 22** (used for 32-bit Windows): the code is compatible, but the tests were run on Node 24 only.
- **Printing from the browser** and the second backup location on a USB drive or network folder.

## Keeping this file up to date

The lists above come straight from the test results. After adding or changing tests, run the suite with the JSON
reporter and regenerate this file, or add the new test names by hand under the right heading:

```bash
cd server
npx vitest run --reporter=json --outputFile=test-results.json
```
