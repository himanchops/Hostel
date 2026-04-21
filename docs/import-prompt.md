# Ledger photo → JSON import prompt

Paste the prompt below into a Claude chat along with one or more photos of a
hostel ledger page. Claude will reply with JSON that the bulk-import CLI
(`backend/cmd/import`) can ingest directly.

After you receive the JSON:

1. Save it to a file, e.g. `ledger-2026-04-page-1.json`.
2. Skim it against the photo for obvious mistakes.
3. Run:
   ```bash
   cd backend && ~/sdk/go1.24.6/bin/go run ./cmd/import \
     --owner you@example.com \
     --file ../ledger-2026-04-page-1.json \
     --dry-run
   ```
4. If dry-run looks good, drop `--dry-run` and run for real.

## Prerequisites in the app (one-time)

- The site (e.g. "My PG") must already exist — create it under `/sites`.
- All rooms referenced in the ledger must exist under that site.
- Beds must exist if you want to assign tenants to a specific bed. If you don't
  know the bed, leave `bed_label` as `null` — the stay will be created with
  bed unassigned and you can assign it later from the tenant detail page.

---

## The prompt to paste into Claude

> I'm importing data from a paper hostel ledger into a small management app.
> Below is a photo (or photos) of one page. Extract every tenant entry into
> JSON matching exactly the schema shown.
>
> ### Schema
>
> ```json
> {
>   "site_name": "<the name of the hostel site I'll tell you below>",
>   "tenants": [
>     {
>       "name": "string — required",
>       "phone": "string — required, digits only, no spaces",
>       "email": "string or null",
>       "address": "string or null",
>       "workplace": "string or null",
>       "emergency_contact_name": "string or null",
>       "emergency_contact_phone": "string or null",
>       "aadhaar_number": "string or null (digits only)",
>       "stay": {
>         "room_number": "string matching the room name in the app, e.g. '101'",
>         "bed_label": "string or null — the bed name, e.g. 'A'. Use null if unsure.",
>         "rent_paise": 800000,
>         "deposit_paise": 1500000,
>         "rent_cycle": "monthly",
>         "start_date": "YYYY-MM-DD"
>       },
>       "payments": [
>         {
>           "date": "YYYY-MM-DD",
>           "amount_paise": 800000,
>           "type": "cash",
>           "note": "string or null"
>         }
>       ]
>     }
>   ]
> }
> ```
>
> ### Rules
>
> - **Amounts are in paise.** Multiply rupee amounts in the book by 100. Example: ₹8,000 → `800000`.
> - **Dates are `YYYY-MM-DD`.** If the book writes "5/3" without a year, ASK me what year to use rather than guessing. If the year is given, use it.
> - **Unreadable fields use `null`**, not made-up values. Do not invent phone numbers, Aadhaar numbers, or amounts.
> - **`rent_cycle`** is one of: `"daily"`, `"weekly"`, `"monthly"`. Default to `"monthly"` if not stated.
> - **`type`** for a payment is `"cash"` or `"online"`. Default to `"cash"` if not stated.
> - **`stay`** is optional — omit it (or set to `null`) if the page only lists payments and not the original tenancy details. The CLI will attach payments to the tenant's existing stay.
> - **`payments`** is optional — omit it if the page only lists new tenants without any payment history.
> - **Phone is required** — if a tenant has no phone in the book, flag it to me; the CLI will reject that row.
> - Dedup within the page: if the same tenant appears multiple times, merge into one entry with all their payments combined.
>
> ### Context I'll give you in the next message
>
> - The `site_name` to use.
> - The default year for ambiguous dates, if any.
> - Anything specific about how this owner writes their book (e.g. "rent column is in thousands", "room numbers are written as 'R1', 'R2'").
>
> Reply with **only** the JSON, in a single fenced ```json block, no commentary before or after.
