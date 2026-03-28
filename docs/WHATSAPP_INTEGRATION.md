# WhatsApp Integration — Brainstorm & Roadmap

## Vision

Replace or supplement the tenant portal and owner dashboard notifications with a WhatsApp-native experience. Owners get a dedicated admin channel for all hostel updates. Tenants interact entirely through WhatsApp — no separate login, no portal to remember.

The goal: **you may not need to leave WhatsApp at all.**

---

## Use Cases

### Owner Admin Channel (Inbound notifications)
| Trigger | Message Content |
|---|---|
| New tenant self-registers | Alert + PDF attachment with tenant profile (name, phone, email, ID proof) |
| Tenant submits payment proof | Alert with amount, tenant name, bed, screenshot image |
| Tenant submits notice to vacate | Alert with tenant name, bed, expected vacate date |
| Tenant submits a complaint | Routed to admin channel with full context |
| Payment reminder batch (cron) | "X tenants overdue, total ₹Y" weekly digest |
| Monthly summary | Occupancy %, collected vs expected, new tenants this month |

### Tenant Bot (Two-way)
| Tenant says/does | Bot does |
|---|---|
| Uploads a screenshot | Creates pending payment entry, notifies owner |
| "I'm vacating on [date]" | Records notice_date, confirms back to tenant, notifies owner |
| "What's my balance?" | Returns current dues/balance from ledger |
| "I have a complaint: [text]" | Logs complaint, routes to admin channel |
| Payment due reminder | Bot proactively messages tenant when cycle is due |

### PDF Generation (for records)
When a new tenant is approved and assigned to a bed, generate a PDF containing:
- Tenant name, phone, email, photo
- Assigned site, room, bed
- Rent amount + cycle + deposit
- Start date
- Timestamp of registration

This gets attached to the admin channel message and doubles as a paper trail if cloud data is unavailable.

---

## Technical Options

### WhatsApp API Providers

| Option | Pros | Cons |
|---|---|---|
| **Meta Cloud API** (official) | Free (per-conversation pricing), most features | Business verification required (~1-2 weeks), Meta approval needed |
| **Twilio WhatsApp** | Fast setup (sandbox in minutes), great docs | Pay-per-message, vendor dependency |
| **360dialog / MessageBird** | BSP (Business Solution Provider), stable | Adds another vendor layer |

**Recommendation**: Start with Twilio sandbox for prototyping. Migrate to Meta Cloud API for production (cost savings, no per-message fee beyond free tier).

### Architecture Sketch

```
Events (new tenant, payment, etc.)
    ↓
Backend Event Hook
    ↓
WhatsApp Service (new package: /backend/internal/whatsapp/)
    ├── OutboundNotifier  → posts to owner admin channel
    │     ├── TextMessage(to, body)
    │     └── DocumentMessage(to, pdfBytes, filename)
    └── InboundWebhook handler
          ├── POST /webhook/whatsapp
          ├── Parse message type (text / image)
          ├── Route by sender phone → look up tenant
          └── Dispatch: PaymentUpload | VacateNotice | BalanceQuery | Complaint
```

### PDF Generation
- **Option A**: `chromedp` (headless Chrome) — render an HTML template to PDF. Full control, heavy dependency.
- **Option B**: `go-fpdf` or `unipdf` — pure Go, lighter, less flexible layout.
- **Option C**: External service (DocRaptor, Gotenberg) — offload rendering, adds a call.

Recommendation: `go-fpdf` for initial version (lightweight, no external deps), upgrade to HTML template approach if layout needs get complex.

### Tenant Identification
Tenants are identified by their WhatsApp phone number. At registration time (or approval time), their phone is stored in `tenants.phone`. When an inbound WhatsApp message arrives, look up `tenants WHERE phone = $1 AND is_approved = true`.

Edge case: unregistered numbers message the bot → reply with registration instructions (link to `/register/:ownerId`).

---

## Phased Approach

### Phase WA-1 — Owner Notifications (One-way, Outbound)
_Lowest effort, highest immediate value_
- New tenant registered → notify owner
- Tenant submits payment → notify owner
- Tenant gives notice → notify owner
- Weekly overdue digest (cron)

### Phase WA-2 — Tenant Payment Reminders (Outbound)
_Automates the most annoying owner task_
- Cron job checks upcoming payment cycles
- Sends reminder message to tenant's WhatsApp X days before due
- Configurable: owner sets how many days ahead to remind

### Phase WA-3 — Tenant PDF on Approval
_Creates the paper trail the owner wants_
- On tenant approval + bed assignment, generate PDF
- Attach to admin channel message
- PDF stored in S3 alongside other uploads (or just sent, not stored)

### Phase WA-4 — Tenant Inbound Interaction
_Replaces the need for a tenant portal_
- Tenant uploads image → creates pending payment
- Tenant texts vacating notice → records notice_date
- Balance query → returns formatted ledger
- Complaint logging

### Phase WA-5 — Admin Digests + Smart Queries
_Power user features for the owner_
- "Show me all overdue tenants" → owner gets formatted list
- "Who's vacating this month?" → bot replies with list
- Monthly summary auto-sent on 1st of each month

---

## Open Questions

1. **Phone number**: The bot needs a dedicated WhatsApp Business phone number. Do you have one / want to get one, or use a virtual number?
2. **Business verification**: Meta's Cloud API requires Meta Business Manager verification. Twilio sandbox skips this but has limits (must add recipients manually). Which matters more — speed or cost?
3. **Multi-owner**: Each owner's tenants should interact with the same bot, but receive notifications in their own admin channel. This is handled by routing on `owner_id`. Does each owner set up their own WhatsApp group, or does the bot handle individual chats only?
4. **Tenant portal**: Does WhatsApp replace the portal entirely, or coexist? (Recommendation: coexist — WA for convenience, portal as fallback/web access)
5. **Hosting and persistent storage**: Bot webhook needs a publicly accessible URL. Pairs naturally with hosting on Render/Railway (see storage discussion below).

---

## Storage & Hosting (Parking Lot)

Not fully discussed yet, but relevant here since the bot raises it:

- **Database**: Postgres on Render (managed) or Supabase (generous free tier)
- **File storage**: Cloudflare R2 (S3-compatible, free egress) or AWS S3
- **Backend**: Render Web Service or Fly.io (both support always-on, no cold start on paid plans)
- **WhatsApp webhook**: Needs a stable public URL — same host as backend, no separate service needed
- **Backups**: The WA PDF-on-registration is itself a backup mechanism; complement with Postgres daily snapshots (Render does this automatically on paid plan)

The WhatsApp integration actually strengthens the case for hosted deployment — local dev only gets you so far when you need a public webhook URL.
