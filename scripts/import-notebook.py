#!/usr/bin/env python3
"""
Import tenants from the owner's paper notebook into the real account.

seed-chopra.py built the hostel's rooms and beds and was forbidden from ever
creating a tenant. This is the script that does create them, so it carries the
rest of that script's caution and adds some of its own:

  * The data is not in this file. It lives in a JSON file under
    .hostel-import/, which is gitignored: names, phone numbers and Aadhaar
    numbers of real people, and github.com/himanchops/Hostel is PUBLIC.
  * Everything goes through the API, as the owner, exactly as if typed into
    the app — no database access, so it can never write what a form could not.
  * Nothing is written until every tenant has passed every check: phones and
    Aadhaar shaped right, each room and bed exists, each bed is empty, no phone
    already belongs to a tenant on the account. One bad line stops the whole
    run before the first write, not halfway through.
  * It only ever creates. A tenant whose phone is already on the account is
    reported and left alone, so re-running after a fix adds only what is
    missing.
  * After writing, it reads every tenant back and compares what the app now
    bills and holds with what the notebook says. A field the server dropped, or
    a balance that is not zero, is reported rather than assumed away.

Payments are derived, not listed. The notebook records what each person agreed
to pay, and the owner's instruction was "assume paid as of today": so every
rent cycle that began on or before `as_of` gets one payment, dated the day it
fell due, and every deposit gets one payment dated the move-in day — unless the
entry says "deposit_paid": false. The cycle dates follow the app's own billing
(handlers.cycleStart, handlers.rentSchedule): the move-in day is cycle 1, a
month-end move-in clamps to short months, and a rent change applies to cycles
that begin on or after its date.

Usage:

    python3 scripts/import-notebook.py .hostel-import/notebook-2026-10.json --dry-run
    python3 scripts/import-notebook.py .hostel-import/notebook-2026-10.json

--dry-run prints the plan and runs every check, reading the live account but
writing nothing. Rehearse against a local backend first, with a local account
built by seed-chopra.py:

    HOSTEL_API=http://localhost:8080 HOSTEL_EMAIL=... HOSTEL_PASSWORD=... \\
        python3 scripts/import-notebook.py <file>
"""

import argparse
import calendar
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

API = os.environ.get("HOSTEL_API", "https://hostel-backend-k7ar.onrender.com")

# Same credential file as seed-chopra.py: the owner's login, gitignored.
CRED_FILE = Path(__file__).resolve().parent.parent / ".hostel-credentials.env"

PHONE = re.compile(r"^[6-9]\d{9}$")  # an Indian mobile, no +91
AADHAAR = re.compile(r"^\d{12}$")


def load_credentials() -> dict:
    creds = {}
    if CRED_FILE.exists():
        for line in CRED_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            creds[k.strip()] = v.strip().strip("\'\"")
    return creds


_creds = load_credentials()
EMAIL = os.environ.get("HOSTEL_EMAIL") or _creds.get("HOSTEL_EMAIL", "")
PASSWORD = os.environ.get("HOSTEL_PASSWORD") or _creds.get("HOSTEL_PASSWORD", "")


def die(msg):
    sys.exit(f"\n✗ {msg}\n")


def call(method, path, body=None, token=None):
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        die(f"{method} {path} → HTTP {e.code}\n  {e.read().decode()}")
    except urllib.error.URLError as e:
        die(f"cannot reach {API} — is it awake? (Render free tier sleeps)\n  {e}")


# ── Billing, mirrored from the backend ───────────────────────────────────────

def cycle_start(start: date, n: int) -> date:
    """handlers.cycleStart for a monthly stay: cycle 1 is the move-in day."""
    months = start.month - 1 + (n - 1)
    year, month = start.year + months // 12, months % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def rent_on(t: dict, d: date) -> int:
    """handlers.rentSchedule.at: the latest step dated on or before d."""
    rent = t["rent"]
    for ch in sorted(t.get("rent_changes", []), key=lambda c: c["from"]):
        if date.fromisoformat(ch["from"]) <= d:
            rent = ch["rent"]
    return rent


def rent_payments(t: dict, as_of: date) -> list[tuple[date, int]]:
    """One payment per cycle that began on or before as_of, at its rent."""
    start = date.fromisoformat(t["start"])
    out, n = [], 1
    while (d := cycle_start(start, n)) <= as_of:
        out.append((d, rent_on(t, d)))
        n += 1
    return out


# ── Checks that need no network ──────────────────────────────────────────────

def check_offline(data: dict) -> list[str]:
    problems = []
    as_of = date.fromisoformat(data["as_of"])
    if as_of > date.today():
        problems.append(f"as_of {as_of} is in the future; the API refuses future payments")
    if data.get("payment_type") not in ("cash", "online"):
        problems.append('payment_type must be "cash" or "online"')

    phones, beds = {}, {}
    for i, t in enumerate(data["tenants"], 1):
        who = f"#{i} {t.get('name', '?')}"
        if not t.get("name", "").strip():
            problems.append(f"#{i}: no name")
        if not PHONE.match(t.get("phone", "")):
            problems.append(f"{who}: phone {t.get('phone')!r} is not a 10-digit mobile")
        if t.get("phone") in phones:
            problems.append(f"{who}: same phone as #{phones[t['phone']]}")
        phones[t.get("phone")] = i
        ec = t.get("emergency_contact_phone")
        if ec and not PHONE.match(ec):
            problems.append(f"{who}: emergency phone {ec!r} is not a 10-digit mobile")
        if t.get("aadhaar") and not AADHAAR.match(t["aadhaar"]):
            problems.append(f"{who}: Aadhaar {t['aadhaar']!r} is not 12 digits")

        place = (t.get("room"), t.get("bed"))
        if not all(place):
            problems.append(f"{who}: needs a room and a bed")
        elif place in beds:
            problems.append(f"{who}: {place[0]} bed {place[1]} is also #{beds[place]}'s")
        beds[place] = i

        try:
            start = date.fromisoformat(t["start"])
        except (KeyError, ValueError):
            problems.append(f"{who}: start {t.get('start')!r} is not YYYY-MM-DD")
            continue
        if start > as_of:
            problems.append(f"{who}: starts after as_of")
        if not (isinstance(t.get("rent"), int) and t["rent"] > 0):
            problems.append(f"{who}: rent must be a whole number of rupees above 0")
        if not (isinstance(t.get("deposit", 0), int) and t.get("deposit", 0) >= 0):
            problems.append(f"{who}: deposit must be a whole number of rupees")
        for ch in t.get("rent_changes", []):
            if date.fromisoformat(ch["from"]) <= start:
                problems.append(f"{who}: rent change {ch['from']} is not after move-in")
        if t.get("expected_end") and date.fromisoformat(t["expected_end"]) <= start:
            problems.append(f"{who}: expected_end is not after start")
    return problems


# ── The plan, as the owner reads it ──────────────────────────────────────────

def inr(rupees: int) -> str:
    """₹1,58,500 — Indian digit grouping, as formatCurrency() shows it."""
    s = str(rupees)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    return ",".join([head] + groups + [tail])


def short(d: date) -> str:
    return f"{d.day} {d.strftime('%b')}"


def bed_key(t):
    return (t["room"], t["bed"])


def print_plan(data: dict):
    as_of = date.fromisoformat(data["as_of"])
    tenants = sorted(data["tenants"], key=bed_key)
    rent_total = rent_count = dep_total = dep_count = 0
    owed = []

    print(f"\nPLACEMENT AND MONEY  (paid up to {short(as_of)} {as_of.year}, "
          f"{data['payment_type']}, note \"{data['payment_note']}\")\n")
    print(f"  {'Bed':<14}{'Tenant':<26}{'From':<8}{'Rent':>7} {'Dep':>6}  Rent paid / deposit paid")
    for t in tenants:
        pays = rent_payments(t, as_of)
        paid = sum(a for _, a in pays)
        rent_total += paid
        rent_count += len(pays)
        rent = inr(t["rent"])  # the opening rent; any change is on the next line
        dep = t.get("deposit", 0)
        if dep and t.get("deposit_paid", True):
            dep_total += dep
            dep_count += 1
            dep_note = inr(dep)
        elif dep:
            dep_note = "NONE (owed)"
            owed.append(f"{t['name']} owes the ₹{inr(dep)} deposit")
        else:
            dep_note = "no deposit"
        when = ", ".join(f"{short(d)} {inr(a)}" for d, a in pays)
        print(f"  {t['room'] + ' · ' + t['bed']:<14}{t['name'][:25]:<26}"
              f"{short(date.fromisoformat(t['start'])):<8}{rent:>7} {inr(dep):>6}"
              f"  {when} = {inr(paid)} / {dep_note}")
        extra = []
        if t.get("expected_end"):
            extra.append(f"leaving {short(date.fromisoformat(t['expected_end']))}")
        for c in t.get("rent_changes", []):
            extra.append(f"rent {inr(c['rent'])} from {short(date.fromisoformat(c['from']))}")
        if extra:
            print(f"  {'':<14}{'':<26}" + "; ".join(extra))

    print(f"\n  {len(tenants)} tenants · {rent_count} rent payments = ₹{inr(rent_total)}"
          f" · {dep_count} deposits = ₹{inr(dep_total)}")
    for line in owed:
        print(f"  {line}")

    print("\nCONTACT DETAILS\n")
    # Never truncate a value here: this table is what the owner checks
    # against the notebook, and a clipped phone number reads as a typo.
    ec_width = 2 + max(len(" · ".join(x for x in (t.get("emergency_contact_name"),
                                                   t.get("emergency_contact_phone")) if x))
                       for t in data["tenants"])
    name_width = 2 + max(len(t["name"]) for t in data["tenants"])
    print(f"  {'Tenant':<{name_width}}{'Phone':<12}{'Emergency / alternate':<{ec_width}}"
          f"{'Aadhaar':<14}Workplace / College")
    for t in data["tenants"]:
        ec = " · ".join(x for x in (t.get("emergency_contact_name"),
                                     t.get("emergency_contact_phone")) if x) or "—"
        print(f"  {t['name']:<{name_width}}{t['phone']:<12}{ec:<{ec_width}}"
              f"{t.get('aadhaar') or '—':<14}{t.get('workplace') or '—'}")
        if t.get("notes"):
            print(f"  {'':<{name_width}}notes: {t['notes']}")
    print()


# ── Checks against the account ───────────────────────────────────────────────

def sign_in():
    """Log in only. Never sign up: a missing account here is a mistake."""
    if not (EMAIL and PASSWORD):
        die(f"no credentials. Expected HOSTEL_EMAIL / HOSTEL_PASSWORD in {CRED_FILE}\n"
            f"  (gitignored) or in the environment.")
    res = call("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
    print(f"→ signed in as owner #{res['owner']['id']} ({EMAIL})")
    return res["token"]


def check_account(data: dict, token: str):
    """Resolve every bed and find who is already here. Reads only."""
    sites = call("GET", "/api/sites", token=token) or []
    site = next((s for s in sites if s["name"] == data["site"]), None)
    if not site:
        die(f"no site named {data['site']!r} on this account")
    sid = site["id"]

    rooms = {r["name"]: r["id"] for r in call("GET", f"/api/sites/{sid}/rooms", token=token) or []}
    occupied = set()
    for room in call("GET", f"/api/sites/{sid}/grid", token=token) or []:
        for b in room["beds"]:
            if b.get("stay_id"):
                occupied.add(b["id"])

    existing = {}
    for pending in ("false", "true"):
        for t in call("GET", f"/api/tenants?pending={pending}", token=token) or []:
            existing[t["phone"]] = t

    problems, bed_ids, skip = [], {}, set()
    beds_cache = {}
    for t in data["tenants"]:
        if t["phone"] in existing:
            skip.add(t["phone"])
            continue
        rid = rooms.get(t["room"])
        if rid is None:
            problems.append(f"{t['name']}: no room named {t['room']!r}")
            continue
        if rid not in beds_cache:
            beds_cache[rid] = {b["name"]: b["id"] for b in
                               call("GET", f"/api/sites/{sid}/rooms/{rid}/beds", token=token) or []}
        bid = beds_cache[rid].get(t["bed"])
        if bid is None:
            problems.append(f"{t['name']}: {t['room']} has no bed {t['bed']!r}")
        elif bid in occupied:
            problems.append(f"{t['name']}: {t['room']} bed {t['bed']} is already occupied")
        else:
            bed_ids[t["phone"]] = bid
    return problems, bed_ids, skip, existing


# ── Writing ──────────────────────────────────────────────────────────────────

TENANT_FIELDS = {  # notebook key → API field
    "name": "name", "phone": "phone",
    "emergency_contact_name": "emergency_contact_name",
    "emergency_contact_phone": "emergency_contact_phone",
    "aadhaar": "aadhaar_number", "workplace": "workplace", "notes": "notes",
}


def write_tenant(t: dict, bed_id: int, data: dict, token: str) -> int:
    as_of = date.fromisoformat(data["as_of"])
    body = {api: t[k] for k, api in TENANT_FIELDS.items() if t.get(k)}
    tenant = call("POST", "/api/tenants", body, token)
    # A field the server does not know is dropped without an error, so check
    # it came back rather than trusting the 201.
    lost = [f for f, v in body.items() if tenant.get(f) != v]
    if lost:
        die(f"{t['name']} was created (#{tenant['id']}) but the server did not keep: "
            f"{', '.join(lost)}.\n  Delete that tenant in the app, fix the backend, re-run.")
    tid = tenant["id"]

    stay = call("POST", "/api/stays", {
        "tenant_id": tid, "bed_id": bed_id,
        "rent_amount": t["rent"] * 100, "deposit_amount": t.get("deposit", 0) * 100,
        "rent_cycle": "monthly", "start_date": t["start"],
    }, token)
    sid = stay["id"]
    for ch in t.get("rent_changes", []):
        call("POST", f"/api/stays/{sid}/rent-changes",
             {"rent_amount": ch["rent"] * 100, "effective_date": ch["from"]}, token)
    if t.get("expected_end"):
        call("PUT", f"/api/stays/{sid}", {"expected_end_date": t["expected_end"]}, token)

    def pay(kind, d, rupees):
        call("POST", f"/api/stays/{sid}/payments", {
            "amount": rupees * 100, "payment_type": data["payment_type"], "kind": kind,
            "payment_date": d.isoformat(), "notes": data["payment_note"],
        }, token)

    if t.get("deposit") and t.get("deposit_paid", True):
        pay("deposit", date.fromisoformat(t["start"]), t["deposit"])
    for d, rupees in rent_payments(t, as_of):
        pay("rent", d, rupees)
    return tid


def verify(t: dict, tid: int, data: dict, token: str) -> list[str]:
    """Read the tenant back: what the app bills and holds must match the plan."""
    as_of = date.fromisoformat(data["as_of"])
    problems = []
    s = call("GET", f"/api/tenants/{tid}/summary", token=token)
    paid = sum(a for _, a in rent_payments(t, as_of)) * 100
    if s["total_paid"] != paid:
        problems.append(f"rent paid reads ₹{s['total_paid'] // 100}, expected ₹{paid // 100}")
    if as_of == date.today() and s["balance"] != 0:
        problems.append(f"balance reads ₹{s['balance'] // 100}, expected ₹0")
    stays = call("GET", f"/api/tenants/{tid}/stays", token=token) or []
    if len(stays) != 1:
        problems.append(f"{len(stays)} stays, expected 1")
    else:
        pays = call("GET", f"/api/stays/{stays[0]['id']}/payments", token=token) or []
        held = sum(p["amount"] for p in pays if p["kind"] == "deposit" and p["is_approved"])
        want = t.get("deposit", 0) * 100 if t.get("deposit_paid", True) else 0
        if held != want:
            problems.append(f"deposit held reads ₹{held // 100}, expected ₹{want // 100}")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file", help="the notebook JSON, under .hostel-import/")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the plan and run every check; write nothing")
    args = ap.parse_args()

    data = json.loads(Path(args.file).read_text())
    print(f"\nTarget : {API}")
    print(f"Account: {EMAIL or '(no credentials)'}")
    print(f"Site   : {data['site']}")

    problems = check_offline(data)
    if problems:
        die("the file has problems; nothing was checked against the account:\n  "
            + "\n  ".join(problems))
    print_plan(data)

    as_of = date.fromisoformat(data["as_of"])
    if as_of < date.today():
        later = [f"{t['name']} ({short(d)})" for t in data["tenants"]
                 for d in [cycle_start(date.fromisoformat(t["start"]), len(rent_payments(t, as_of)) + 1)]
                 if as_of < d <= date.today()]
        if later:
            print(f"! as_of is {as_of}, today is {date.today()}. These fell due in between, are not "
                  f"recorded as paid, and will show as owed:\n    " + "\n    ".join(later) + "\n")

    token = sign_in()
    problems, bed_ids, skip, existing = check_account(data, token)
    for t in data["tenants"]:
        if t["phone"] in skip:
            print(f"= {t['name']}: phone already on the account "
                  f"(as {existing[t['phone']]['name']!r}), left alone")
    if problems:
        die("the account does not match the file; nothing was written:\n  "
            + "\n  ".join(problems))
    todo = [t for t in data["tenants"] if t["phone"] not in skip]
    print(f"✓ every check passed: {len(todo)} to create, {len(skip)} already there\n")

    if args.dry_run:
        print("--dry-run: nothing was written.\n")
        return
    if not todo:
        print("Nothing to do.\n")
        return

    if input(f"Write {len(todo)} tenants to {API}? Type yes: ").strip() != "yes":
        die("stopped; nothing was written")

    created = []
    for t in todo:
        try:
            tid = write_tenant(t, bed_ids[t["phone"]], data, token)
        except SystemExit:
            done = ", ".join(n for n, _ in created) or "nobody"
            print(f"  (finished before this: {done}. {t['name']} may be half-written — "
                  f"delete them in the app, then re-run; finished tenants are skipped.)")
            raise
        created.append((t["name"], tid))
        print(f"+ {t['name']} (#{tid}) — {t['room']} bed {t['bed']}")

    print("\nReading everything back…")
    bad = 0
    for (name, tid), t in zip(created, todo):
        problems = verify(t, tid, data, token)
        bad += bool(problems)
        print(f"  {'✓' if not problems else '✗'} {name}" +
              ("" if not problems else ": " + "; ".join(problems)))
    print(f"\n{'✓' if not bad else '✗'} created {len(created)} tenants; "
          f"{len(created) - bad} read back exactly as planned.\n")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
