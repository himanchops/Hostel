#!/usr/bin/env python3
"""
Seed a realistic demo owner for the Hostel app against a local backend.

Two jobs, and they pull in different directions:

  1. Exercise every state the UI can show — all five bed statuses, a bed-less
     stay, a settled move-out, a pending registration, a payment awaiting
     approval. This is what the grid, collections and pending screens need.

  2. Give the Insights page something with a SHAPE. That needs breadth the
     first job does not: ~15 months of history across 20 beds, with tenants
     arriving AND leaving, beds re-let after a gap, and rooms that visibly
     differ from one another. An earlier version covered every state in 9
     stays over 7 months, which drew a flat, monotonically rising chart —
     technically correct and useless for judging whether the charts work.

So the layout below is deliberately uneven. Room 101 is never empty; Room 102
turns over three times on one bed; HSR Room 3 is never let at all. Those
contrasts are the point — a demo where every room performs identically cannot
show you that the per-room table works.

Everything goes through the real HTTP API, so it exercises the same validation
a real user would hit — no direct SQL, no schema coupling.

Amounts are paise (₹1 = 100 paise). Dates are anchored to today, so the states
hold whenever this is run.

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

# How far back the history runs. The Insights page offers 3/6/12-month ranges,
# so the data has to outlast the longest of them or the 12m view is just the
# whole dataset with empty space on the left.
HISTORY_MONTHS = 15


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


# ── Layout ────────────────────────────────────────────────────────────────────
#
# Bunk beds are named the way the real hostel names them — "1L"/"1U" for the
# lower and upper of bunk frame 1 — so the demo exercises the same convention
# production uses. See scripts/seed-chopra.py.
LAYOUT = [
    ("Sunrise PG — Koramangala", "5th Block, Koramangala, Bengaluru", "Kora", [
        ("Room 101", 1, ["1L", "1U"]),
        ("Room 102", 1, ["1L", "1U"]),
        ("Room 103", 1, ["1L", "1U", "2"]),
        ("Room 201", 2, ["1L", "1U", "2"]),
        ("Room 202", 2, ["1L", "1U"]),
    ]),
    ("Sunrise PG — HSR Layout", "Sector 2, HSR Layout, Bengaluru", "HSR", [
        ("Room 1", 0, ["1L", "1U"]),
        ("Room 2", 0, ["1L", "1U", "2"]),
        ("Room 3", 1, ["1L", "1U", "2"]),
    ]),
]

# ── The history ───────────────────────────────────────────────────────────────
#
# One row per stay. `start` and `end` are months-ago; end=None means ongoing.
#
# ORDER MATTERS for any bed that appears twice: the API refuses a second active
# stay on an occupied bed, so a bed being re-let must have its earlier stay
# created and ended before the next one starts. Rows are listed oldest-first per
# bed for exactly that reason.
#
# `pattern` drives payments:
#   ontime      — every cycle paid, a day after it falls due
#   late        — every cycle paid, but ~12 days late (clean balance, ugly habit)
#   arrears:N   — stops paying N cycles before now  → overdue, red
#   partial     — all but the last cycle, then a part payment → yellow
#   upfront:N   — N cycles paid in one go on day one → in credit
#   none        — never paid a rupee
#
# `anchor` is the day of the month the stay starts, which is also the day its
# rent falls due. Mostly the 1st so the current month is always billed whatever
# day this is run; a few later ones exist to make the collections list realistic.
STAYS = [
    # ── Room 101: never empty. The room that makes the others look bad. ──────
    ("Anjali Menon",    "9845110001", "Kora/Room 101/1L", 850000, 1700000, 14, None, "ontime", 1),
    ("Vikram Rao",      "9845110002", "Kora/Room 101/1U", 850000, 1700000, 13, None, "late",   1),

    # ── Room 102/1L: three tenants in fifteen months. High churn, gaps. ──────
    ("Rahul Pillai",    "9845110003", "Kora/Room 102/1L", 800000, 1600000, 15,   11, "ontime", 1),
    ("Farhan Sheikh",   "9845110004", "Kora/Room 102/1L", 820000, 1640000, 10,    5, "ontime", 1),
    ("Aditya Bose",     "9845110005", "Kora/Room 102/1L", 850000, 1700000,  4, None, "ontime", 1),
    # 102/1U sat empty for a year before anyone took it.
    ("Nikhil Verma",    "9845110006", "Kora/Room 102/1U", 850000, 1700000,  2, None, "ontime", 1),

    # ── Room 103: only filled recently, and one bed still empty. ─────────────
    ("Rohit Nair",      "9845110007", "Kora/Room 103/1L", 780000, 1560000,  6, None, "late",   5),
    ("Kabir Shah",      "9845110008", "Kora/Room 103/1U", 780000, 1560000,  3, None, "partial", 1),

    # ── Room 201: the awkward cases live here. ───────────────────────────────
    ("Arjun Nair",      "9845110009", "Kora/Room 201/1L", 800000, 1600000,  3, None, "ontime", 1),
    ("Karthik Menon",   "9845110010", "Kora/Room 201/2",  850000, 1700000,  4, None, "upfront:7", 1),

    # ── Room 202: one long overdue tenant, one settled departure. ────────────
    ("Sneha Iyer",      "9845110011", "Kora/Room 202/1L", 900000, 1800000, 15, None, "arrears:3", 1),
    ("Ravi Kumar",      "9845110012", "Kora/Room 202/1U", 800000, 1600000, 12,    7, "ontime", 1),

    # ── HSR Room 2: one steady, one who left a gap behind them. ──────────────
    ("Sanjay Gupta",    "9845110013", "HSR/Room 2/1L",    720000, 1440000,  8, None, "ontime", 1),
    ("Imran Qureshi",   "9845110014", "HSR/Room 2/1U",    720000, 1440000,  7,    3, "ontime", 1),

    # ── The dip. These two leave within a month of each other and nobody
    # replaces them, which is the only reason the occupancy line falls instead
    # of climbing all the way. Without a fall there is nothing to prove the
    # chart is reading the data rather than drawing a ramp.
    ("Manish Tiwari",   "9845110019", "HSR/Room 2/2",     700000, 1400000, 13,    8, "ontime", 1),
    ("Gaurav Rane",     "9845110020", "Kora/Room 103/2",  780000, 1560000, 12,    8, "ontime", 1),

    # HSR Room 1/1U, Room 2/2, and the whole of Room 3 are never let. Room 3 is
    # the control: three beds, fifteen months, zero rupees. If it does not show
    # up on the Insights table at 0%, the table is hiding the finding.
]


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
    site_ids = {}
    for site_name, address, short, rooms in LAYOUT:
        site = api("POST", "/api/sites", {"name": site_name, "address": address})
        site_ids[short] = site["id"]
        for room_name, floor, bed_names in rooms:
            room = api("POST", f"/api/sites/{site['id']}/rooms",
                       {"name": room_name, "floor": floor})
            for bed_name in bed_names:
                bed = api("POST", f"/api/sites/{site['id']}/rooms/{room['id']}/beds",
                          {"name": bed_name})
                beds[f"{short}/{room_name}/{bed_name}"] = bed["id"]
    print(f"Created {len(LAYOUT)} sites, {len(beds)} beds")

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

    # ── The history ──────────────────────────────────────────────────────────
    #
    # Cycles run from the month the stay began to the month it ended (or to
    # this month). Paying a cycle a day or twelve days after it falls due makes
    # no difference to the balance, but it is what puts a spread of
    # "last payment" dates on the collections screen.
    workplaces = ["Infosys", "Flipkart", "Practo", "Razorpay", "Swiggy",
                  "Zerodha", "Cred", "TCS", "Amazon", "Zoho"]
    made = []

    for i, (name, phone, bed_key, rent, deposit, start_n, end_n, pattern, anchor) in enumerate(STAYS):
        t = tenant(name, phone, workplace=workplaces[i % len(workplaces)])
        s = stay(t, bed_key, rent, deposit, months_ago(start_n, anchor))

        last_n = end_n if end_n is not None else 0
        cycles = list(range(start_n, last_n - 1, -1))

        if pattern == "ontime":
            for n in cycles:
                pay(s, rent, months_ago(n, min(anchor + 1, 28)), "online")
        elif pattern == "late":
            for n in cycles:
                pay(s, rent, months_ago(n, min(anchor + 12, 28)), "cash", "Paid late")
        elif pattern.startswith("arrears:"):
            behind = int(pattern.split(":")[1])
            for n in cycles[:max(0, len(cycles) - behind)]:
                pay(s, rent, months_ago(n, min(anchor + 1, 28)), "cash")
        elif pattern == "partial":
            for n in cycles[:-1]:
                pay(s, rent, months_ago(n, min(anchor + 1, 28)), "online")
            pay(s, rent // 2, days_ago(4), "cash", "Part payment — rest on salary day")
        elif pattern.startswith("upfront:"):
            n_cycles = int(pattern.split(":")[1])
            pay(s, rent * n_cycles, months_ago(start_n, min(anchor + 1, 28)),
                "online", f"{n_cycles} months paid up front")
        elif pattern == "none":
            pass

        if end_n is not None:
            api("PUT", f"/api/stays/{s['id']}", {"end_date": months_ago(end_n, 28)})

        made.append((name, s))
    print(f"Created {len(made)} stays across {HISTORY_MONTHS} months")

    by_name = dict(made)

    # ── The states that are not just a payment pattern ───────────────────────

    # VACATING SOON: notice given, still in the bed.
    api("PUT", f"/api/stays/{by_name['Arjun Nair']['id']}", {"notice_date": days_ago(9)})

    # WEEKLY cycle, running behind — the grid's only non-monthly stay.
    t = tenant("Priya Deshpande", "9845110015", workplace="Swiggy")
    s = stay(t, "Kora/Room 201/1U", 200000, 400000, days_ago(42), cycle="weekly")
    for w in range(6, 1, -1):
        pay(s, 200000, days_ago(w * 7), "cash", "Weekly rent")

    # BED-LESS: approved, awaiting a room. Bills rent, occupies nothing — the
    # case that would otherwise inflate the occupancy chart.
    t = tenant("Deepa Krishnan", "9845110016", workplace="Byju's")
    stay(t, None, 750000, 1500000, days_ago(20))

    # SETTLED: Ravi moved out seven months ago with a deduction. The settlement
    # is recorded against the stay the history loop already ended.
    ravi = by_name["Ravi Kumar"]
    ended = months_ago(7, 28)
    preview = api("GET", f"/api/stays/{ravi['id']}/settlement-preview?end_date={ended}")
    adjustments = [{"label": "Damaged study chair", "amount_paise": -120000}]
    refund = (preview["deposit_paise"] + preview["advance_paise"]
              - max(preview["dues_paise"], 0)
              + sum(a["amount_paise"] for a in adjustments))
    api("POST", f"/api/stays/{ravi['id']}/settlement", {
        "adjustments": adjustments,
        "notes": "Settled in cash at handover. Keys returned.",
        "refund_paise": refund,
        "end_date": ended,
    })

    # PENDING REGISTRATION: waiting in the approval queue.
    call("POST", f"/public/register/{owner_id}", {
        "name": "Nikhil Joshi", "phone": "9845110017",
        "email": "nikhil@example.com", "password": "tenant1234",
        "workplace": "Amazon", "address": "Indore, MP",
        "emergency_contact_name": "Anita Joshi",
        "emergency_contact_phone": "9847110017",
        "aadhaar_number": "987654321098",
    })

    # PENDING PAYMENT: registered, approved into a bed, then submits a proof.
    # Her payment stays unapproved, so HSR Room 1 reads ₹0 collected on the
    # insights table despite being occupied — which is correct, and worth
    # having in the demo.
    call("POST", f"/public/register/{owner_id}", {
        "name": "Meera Pillai", "phone": "9845110018",
        "password": "tenant1234", "workplace": "Cred",
    })
    pending = api("GET", "/api/tenants?pending=true")
    meera = next(x for x in pending if x["name"] == "Meera Pillai")
    api("POST", f"/api/tenants/{meera['id']}/approve", {
        "bed_id": beds["HSR/Room 1/1L"],
        "rent_amount": 700000, "deposit_amount": 1400000,
        "rent_cycle": "monthly", "start_date": months_ago(2, 1),
    })
    t_auth = call("POST", "/tenant-auth/login",
                  {"phone": "9845110018", "password": "tenant1234"})
    t_stays = call("GET", "/tenant/stays", token=t_auth["token"])
    call("POST", f"/tenant/stays/{t_stays[0]['id']}/payments",
         {"amount": 700000, "notes": "Paid by UPI this morning — screenshot to follow"},
         token=t_auth["token"])

    total_beds = len(beds)
    print(f"""
Seeded. Nothing else in the database was touched — data is owner-scoped,
so this owner sees only what was just created.

  Owner    {EMAIL} / {PASSWORD}          → http://localhost:3000/login
  Tenant   9845110018 / tenant1234        → http://localhost:3000/my/login
  Public   http://localhost:3000/register/{owner_id}

  {len(STAYS) + 3} stays across 2 sites and {total_beds} beds, {HISTORY_MONTHS} months of history.

  Grid states: paid, partial, overdue, vacating soon, vacant, plus a
  bed-less stay, a settled move-out, 1 pending registration and 1 payment
  awaiting approval.

  Insights: occupancy climbs, dips as tenants leave, and recovers. Room 101
  is never empty; Room 102/1L turns over three times; HSR Room 3 is never
  let at all and should read 0% on the per-room table.
""")


if __name__ == "__main__":
    main()
