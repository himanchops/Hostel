#!/usr/bin/env python3
"""
Seed a realistic demo tenant for the Hostel app against a local backend.

Creates one owner and enough data to exercise every state the UI can show:
all five bed statuses, a bed-less stay, a settled move-out, a pending
registration, and a tenant-submitted payment awaiting approval.

Everything goes through the real HTTP API, so it exercises the same validation
a real user would hit — no direct SQL, no schema coupling.

Amounts are paise (₹1 = 100 paise). Dates are anchored to today so the grid
shows the same states whenever this is run.

    make seed-demo          # seed (fails if the demo owner already exists)
    make seed-demo-reset    # delete the demo owner and reseed from scratch

Needs the backend running on :8080. Touches nothing but its own owner — all
data in this app is owner-scoped, so the demo owner is invisible to every
other account.
"""

import json
import urllib.error
import urllib.request
from datetime import date, timedelta

BASE = "http://localhost:8080"
# .invalid is reserved by RFC 2606 and can never be a real address, so this
# cannot collide with an account someone actually uses. The first version of
# this script guessed "demo@hostel.local", which turned out to be the owner's
# own login, and then wrote a demo dataset into their real data.
EMAIL = "demo@seed.invalid"
PASSWORD = "demo1234"

TODAY = date.today()


def months_ago(n: int, day: int) -> str:
    """The `day`-th of the month n months back, clamped to a short month."""
    m = TODAY.month - n
    y = TODAY.year
    while m < 1:
        m += 12
        y -= 1
    last = (date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)).day
    return date(y, m, min(day, last)).isoformat()


def days_ago(n: int) -> str:
    return (TODAY - timedelta(days=n)).isoformat()


def call(method, path, body=None, token=None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        hint = ""
        if path == "/auth/signup" and e.code == 409:
            hint = ("\n  The seed owner already exists. This script never reuses an\n"
                    "  account — ask for a reset, which deletes owner "
                    f"'{EMAIL}' and reseeds.")
        raise SystemExit(f"\n✗ {method} {path} → {e.code}\n  {detail}{hint}\n")
    except urllib.error.URLError as e:
        raise SystemExit(f"\n✗ Cannot reach {BASE} — is the backend running?\n  {e}\n")


def main():
    # ── Owner ────────────────────────────────────────────────────────────────
    # Deliberately no "if signup fails, log in instead" fallback. That made a
    # collision with a real account look identical to a re-run, and the script
    # happily appended fake tenants to someone's live data. If the owner
    # already exists, stop and let a human decide.
    auth = call("POST", "/auth/signup", {
        "name": "Rahul Shetty", "email": EMAIL,
        "password": PASSWORD, "phone": "9845012345",
    })
    tok = auth["token"]
    owner_id = auth["owner"]["id"]
    print(f"Created owner #{owner_id} ({EMAIL})")

    def api(method, path, body=None):
        return call(method, path, body, tok)

    # ── Sites, rooms, beds ───────────────────────────────────────────────────
    beds = {}
    layout = [
        ("Sunrise PG — Koramangala", "5th Block, Koramangala, Bengaluru", [
            ("Room 101", 1, ["Bed A", "Bed B"]),
            ("Room 102", 1, ["Bed A", "Bed B"]),
            ("Room 201", 2, ["Bed A", "Bed B", "Bed C"]),
        ]),
        ("Sunrise PG — HSR Layout", "Sector 2, HSR Layout, Bengaluru", [
            ("Room 1", 0, ["Bed A", "Bed B"]),
        ]),
    ]
    for site_name, address, rooms in layout:
        site = api("POST", "/api/sites", {"name": site_name, "address": address})
        for room_name, floor, bed_names in rooms:
            room = api("POST", f"/api/sites/{site['id']}/rooms",
                       {"name": room_name, "floor": floor})
            for bed_name in bed_names:
                bed = api("POST", f"/api/sites/{site['id']}/rooms/{room['id']}/beds",
                          {"name": bed_name})
                key = f"{site_name.split('— ')[1][:4]}/{room_name}/{bed_name}"
                beds[key] = bed["id"]
    print(f"Created {len(layout)} sites, {len(beds)} beds")

    def tenant(name, phone, **extra):
        return api("POST", "/api/tenants", {"name": name, "phone": phone, **extra})

    def stay(t, bed_key, rent, deposit, start, cycle="monthly"):
        return api("POST", "/api/stays", {
            "tenant_id": t["id"],
            "bed_id": beds[bed_key] if bed_key else None,
            "rent_amount": rent, "deposit_amount": deposit,
            "rent_cycle": cycle, "start_date": start,
        })

    def pay(s, amount, when, kind="cash", notes=None):
        return api("POST", f"/api/stays/{s['id']}/payments", {
            "amount": amount, "payment_type": kind,
            "payment_date": when, "notes": notes,
        })

    # ── PAID: six months in, fully up to date ────────────────────────────────
    t = tenant("Anjali Menon", "9845110001", email="anjali@example.com",
               workplace="Infosys", address="Thrissur, Kerala",
               emergency_contact_name="Suresh Menon",
               emergency_contact_phone="9847110001")
    s = stay(t, "Kora/Room 101/Bed A", 850000, 1700000, months_ago(5, 15))
    for i in range(5, -1, -1):
        pay(s, 850000, months_ago(i, 16), "online", f"Rent — month {6 - i}")

    # ── PARTIAL: owes less than one cycle ────────────────────────────────────
    t = tenant("Vikram Rao", "9845110002", workplace="Flipkart")
    s = stay(t, "Kora/Room 101/Bed B", 850000, 1700000, months_ago(3, 1))
    for i in range(3, 0, -1):
        pay(s, 850000, months_ago(i, 2), "online")
    pay(s, 500000, days_ago(4), "cash", "Part payment — rest on salary day")

    # ── OVERDUE: two cycles behind ───────────────────────────────────────────
    t = tenant("Sneha Iyer", "9845110003", workplace="Practo",
               aadhaar_number="123456789012")
    s = stay(t, "Kora/Room 102/Bed A", 900000, 1800000, months_ago(6, 20))
    for i in range(6, 2, -1):
        pay(s, 900000, months_ago(i, 21), "cash")

    # ── VACATING SOON: notice given ──────────────────────────────────────────
    t = tenant("Arjun Nair", "9845110004", workplace="Razorpay")
    s = stay(t, "Kora/Room 102/Bed B", 800000, 1600000, months_ago(2, 1))
    for i in range(2, -1, -1):
        pay(s, 800000, months_ago(i, 2), "online")
    api("PUT", f"/api/stays/{s['id']}", {"notice_date": days_ago(9)})

    # ── WEEKLY cycle, behind ─────────────────────────────────────────────────
    t = tenant("Priya Deshpande", "9845110005", workplace="Swiggy")
    s = stay(t, "Kora/Room 201/Bed A", 200000, 400000, days_ago(42), cycle="weekly")
    for w in range(6, 1, -1):
        pay(s, 200000, days_ago(w * 7), "cash", "Weekly rent")

    # ── PAID AHEAD: two months of credit, for the settlement advance flow ────
    t = tenant("Karthik Menon", "9845110006", workplace="Zerodha")
    s = stay(t, "Kora/Room 201/Bed B", 850000, 1700000, months_ago(4, 10))
    pay(s, 5950000, months_ago(4, 11), "online", "Seven months paid up front")

    # ── BED-LESS: approved, awaiting a room ──────────────────────────────────
    t = tenant("Deepa Krishnan", "9845110007", workplace="Byju's")
    stay(t, None, 750000, 1500000, days_ago(4))

    # ── ENDED + SETTLED: a completed move-out with a deduction ───────────────
    t = tenant("Ravi Kumar", "9845110008", workplace="TCS")
    s = stay(t, "Kora/Room 201/Bed C", 800000, 1600000, months_ago(7, 5))
    for i in range(7, 2, -1):
        pay(s, 800000, months_ago(i, 6), "online")
    ended = months_ago(2, 4)
    preview = api("GET", f"/api/stays/{s['id']}/settlement-preview?end_date={ended}")
    adjustments = [{"label": "Damaged study chair", "amount_paise": -120000}]
    refund = (preview["deposit_paise"] + preview["advance_paise"]
              - max(preview["dues_paise"], 0)
              + sum(a["amount_paise"] for a in adjustments))
    api("POST", f"/api/stays/{s['id']}/settlement", {
        "adjustments": adjustments,
        "notes": "Settled in cash at handover. Keys returned.",
        "refund_paise": refund,
        "end_date": ended,
    })

    # ── PENDING REGISTRATION: waiting in the approval queue ──────────────────
    call("POST", f"/public/register/{owner_id}", {
        "name": "Nikhil Joshi", "phone": "9845110009",
        "email": "nikhil@example.com", "password": "tenant1234",
        "workplace": "Amazon", "address": "Indore, MP",
        "emergency_contact_name": "Anita Joshi",
        "emergency_contact_phone": "9847110009",
        "aadhaar_number": "987654321098",
    })

    # ── PENDING PAYMENT: registered, approved, then submits a proof ──────────
    call("POST", f"/public/register/{owner_id}", {
        "name": "Meera Pillai", "phone": "9845110010",
        "password": "tenant1234", "workplace": "Cred",
    })
    pending = api("GET", "/api/tenants?pending=true")
    meera = next(x for x in pending if x["name"] == "Meera Pillai")
    api("POST", f"/api/tenants/{meera['id']}/approve", {
        "bed_id": beds["HSR /Room 1/Bed A"],
        "rent_amount": 700000, "deposit_amount": 1400000,
        "rent_cycle": "monthly", "start_date": months_ago(2, 1),
    })
    t_auth = call("POST", "/tenant-auth/login",
                  {"phone": "9845110010", "password": "tenant1234"})
    t_stays = call("GET", "/tenant/stays", token=t_auth["token"])
    call("POST", f"/tenant/stays/{t_stays[0]['id']}/payments",
         {"amount": 700000, "notes": "Paid by UPI this morning — screenshot to follow"},
         token=t_auth["token"])

    print(f"""
Seeded. Nothing else in the database was touched — data is owner-scoped,
so this owner sees only what was just created.

  Owner    {EMAIL} / {PASSWORD}          → http://localhost:3000/login
  Tenant   9845110010 / tenant1234        → http://localhost:3000/my/login
  Public   http://localhost:3000/register/{owner_id}

  9 stays across 2 sites, 9 beds. Every grid state is represented:
  paid, partial, overdue, vacating soon, vacant, plus a bed-less stay,
  a settled move-out, 1 pending registration and 1 payment awaiting approval.
""")


if __name__ == "__main__":
    main()
