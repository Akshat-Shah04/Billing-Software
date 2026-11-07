# User guide

How to use Billing Software day to day. Anything marked **(admin)** is only available to administrators.

## Contents

1. [Logging in](#1-logging-in)
2. [Clients](#2-clients)
3. [Services](#3-services)
4. [Creating a bill](#4-creating-a-bill)
5. [Finding, viewing, editing and printing bills](#5-finding-viewing-editing-and-printing-bills)
6. [Staff accounts (admin)](#6-staff-accounts-admin)
7. [Organisation settings (admin)](#7-organisation-settings-admin)
8. [Client folders on the PC](#8-client-folders-on-the-pc)
9. [Backups and restoring](#9-backups-and-restoring)
10. [Light and dark theme](#10-light-and-dark-theme)
11. [Troubleshooting](#11-troubleshooting)

## 1. Logging in

Open the address your administrator gave you, for example `http://OFFICE-PC:4000`, and log in with your username and
password. There is no sign-up: an administrator creates every account (see [Staff accounts](#6-staff-accounts-admin)).

- After 10 wrong attempts for the same username from the same computer you are asked to wait about 15 minutes.
- A deactivated account stops working immediately, even if the person is still logged in.
- **Log out** is at the top right.

## 2. Clients

**Clients** in the top menu.

- **Add client:** name is required. Phone, email, city, address, PAN, GSTIN and **Referred by** are optional. PAN and
  GSTIN are saved in capital letters.
- **Search** by name, phone or the "referred by" text.
- **Edit** changes any detail. The client's *Files folder* name is shown while editing (see [section 8](#8-client-folders-on-the-pc)).
- **Delete** hides the client but keeps all their bills. Tick **Show deleted** to see deleted clients and press **Restore** to
  bring one back. You cannot create a *new* bill for a deleted client, but their old bills stay visible and printable.

Two clients may share a name (for example two "Rajesh Patel"). The bill search and the client picker show their phone and
city so you can tell them apart.

## 3. Services

**Services** in the top menu. A service is something you charge for, with a default price and an optional description.

- **Add service:** name and default price (in rupees, for example `2500` or `2500.50`) are required.
- The **description** you enter here is copied onto each bill line that uses the service, in smaller text under the title.
- Untick **Active** to stop a service being offered on new bills. Existing bills are not affected.
- Editing a service never changes bills that were already made.

## 4. Creating a bill

**Bills > Create bill**.

1. **Client:** type a name or phone number and pick the client from the list.
2. **Bill date:** defaults to today. The **financial year** (April to March, for example 2026-27) is shown beside the label.
3. **Items:** for each item either choose a **Service** (the item name, description and price are filled in for you) or leave
   it as *Custom item* and type them yourself.
   - **Item name** is the bold title printed on the bill.
   - **Description** is the smaller text printed under it. It is filled in from the service and you can change it for this
     bill only.
   - **Qty** is a whole number. **Price** is in rupees.
   - **+ Add item** adds another line; **Remove** deletes one.
4. The **totals** update as you type. If GST is switched on in settings, the GST line appears automatically.
5. **Notes** are optional and print at the bottom of the bill.
6. Press **Create bill**.

Each bill gets the next bill number (`INV-000001`, `INV-000002`, ...).

**GST is fixed when the bill is created.** If an administrator later changes the GST setting, old bills do not change.

Limits: a bill can have up to 100 items, and the items may add up to at most ₹100 crore. Fields stop you typing past
their limits.

## 5. Finding, viewing, editing and printing bills

**Bills** in the top menu lists bills, newest first, 20 per page.

- **Search** by client name or bill number (for example `INV-000012`).
- **Financial year** dropdown: choose *FY 2025-26* to see only bills dated 1 April 2025 to 31 March 2026, or *All financial
  years*. A bill dated 31 March 2026 belongs to FY 2025-26; one dated 1 April 2026 belongs to FY 2026-27.
- Click a row to open the bill. On a phone each bill is shown as a card.

On a bill:

- **Print** prints the bill without the browser's own date, title and address lines. It always prints on white, even in dark
  mode. If your browser still adds a header or footer, untick **Headers and footers** in its print window once.
- **Edit bill** lets you change the client, date, items and notes. The GST rate stays the one the bill was created with.
  The bill records who created it and who last edited it, and when.

## 6. Staff accounts (admin)

**Staff** in the top menu.

- **Create account:** full name, username (3 to 30 characters: lowercase letters, numbers, dot, dash or underscore),
  a password of at least 8 characters, and a role.
  - **Staff** can use clients, services and bills.
  - **Admin** can also manage staff and settings.
- **Reset password** sets a new password for someone. Share it with them privately.
- **Deactivate** stops an account from working (it is not deleted, so their old bills still show who made them).
  **Reactivate** turns it back on.
- You cannot deactivate or demote your own account, so you can never lock everyone out by accident.

## 7. Organisation settings (admin)

**Settings** in the top menu.

- **Logo:** upload a PNG, JPEG or WebP image (up to 1 MB; large images are shrunk automatically). It prints at the top of
  every bill. SVG files are not accepted. A logo on a transparent or white background looks best. **Remove logo** takes it off.
- **Firm details:** name, address and GSTIN, printed on every bill.
- **Payment details:** account holder, bank, account number, IFSC, branch, UPI ID and free-text instructions, printed in a
  "please pay to" box so clients know where to pay. Anything left empty is not printed. These are your *current* details on
  every bill, so when your bank account changes, unpaid bills show the new one.
- **GST:** switch **Charge GST on new bills** on or off and set the rate. It only affects bills created afterwards.
- **Client folders:** shows where the folders are kept and whether the last update worked (see below).

Press **Save settings** to save the firm, payment and GST sections. The logo saves the moment you choose it.

## 8. Client folders on the PC

For every client the software keeps an ordinary Windows folder named after them, as a second readable copy of their records:

```
Client Files/
  Rajesh Patel/
    client-details.txt        their details and a list of their bills
    client-data.json          the same information in full, for other programs
    bills/INV-000007_2026-11-05.html     each bill, openable and printable in any browser
```

- Updated automatically whenever a client or bill is saved, and checked again every time the software starts.
- Two clients with the same name get `Rajesh Patel` and `Rajesh Patel (2)`. Renaming a client renames their folder.
- Deleting a client keeps their folder; the details file then says DELETED. The software never deletes these folders.
- Do not edit the files: they are rewritten whenever something changes.
- If it ever shows an error in Settings, check that the folder exists, the disk is not full, and then press
  **Rebuild all client folders now** (admin).

The location was chosen when the software was installed. When you set it up from the source code, it is set in
`CLIENT_FILES_DIR` (see the [architecture notes](architecture.md#configuration)).

## 9. Backups and restoring

The database is backed up automatically when the software starts and then every 24 hours, keeping the 14 most recent in
`C:\ProgramData\BillingSoftware\backups` (installed version).

**Please copy that folder, and the client folders, to a USB drive or cloud drive regularly.** Backups that live only on the same
PC do not help if that PC fails.

To restore (installed version): open Command Prompt **as administrator** and run

```
"C:\Program Files\Billing Software\tools\restore.cmd" "C:\ProgramData\BillingSoftware\backups\billing-YYYYMMDD-HHMMSS.tar.gz"
```

using the real file name. The current database is set aside, not deleted. Anything entered after that backup was made will not
be in the restored copy. If you use a full PostgreSQL server instead of the built-in database, back it up with `pg_dump`.

## 10. Light and dark theme

The three small buttons at the top right choose **device setting**, **light** or **dark**. The choice is remembered in that
browser. Bills always stay white, because they print on white.

## 11. Troubleshooting

| Problem | What to try |
|---|---|
| Another computer cannot open the address | Check both are on the same network; the host PC is on and not asleep; try its IP address (`ipconfig` on the host) instead of its name; set the host's network to **Private** in Windows settings. |
| "Too many failed attempts" | Wait about 15 minutes, or ask an administrator to reset your password. |
| "Phone is too long (at most 20 characters)" or similar | The message names the field and its limit; shorten it. |
| "The bill total is too large" | Check the quantities and prices; a bill's items may add up to at most ₹100 crore. |
| A client folder is missing or out of date | Admin: **Settings > Rebuild all client folders now**. |
| Settings shows a client folder error | Check the folder exists, is writable and the disk is not full, then rebuild. |
| Bill numbers skip (for example 8, 9, then 34) | Numbers are taken before a save finishes and are not given back if it fails. This is a known limit. |
| The software will not start (installed version) | Look in `C:\ProgramData\BillingSoftware\logs`, or start "Billing Software" in Windows **Services**. |
