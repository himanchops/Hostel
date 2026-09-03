#!/usr/bin/env python3
"""
Create the real hostel's structure — owner, site, rooms, beds — against a
deployed backend.

This is NOT seed-demo.py. That one invents a fake owner under a reserved
.invalid domain and fills it with fake tenants. This one writes to a real
account on the live database, so it is deliberately narrow:

  * It creates only sites, rooms and beds. Never a tenant, stay, payment or
    settlement — those are entered by hand afterwards.
  * It never deletes or updates anything. Re-running is safe: it lists what
    exists and creates only what is missing, matching on name.
  * The worst case on a live account is therefore an extra empty room, which
    the owner can delete from the site page.

Usage:

    python3 scripts/seed-chopra.py --dry-run     # print the plan, write nothing
    python3 scripts/seed-chopra.py               # actually create it

Credentials come from .hostel-credentials.env at the repo root (gitignored),
or from HOSTEL_EMAIL / HOSTEL_PASSWORD in the environment.

Point it somewhere else with HOSTEL_API=http://localhost:8080 to rehearse
against a local backend first. That is the recommended order.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = os.environ.get("HOSTEL_API", "https://hostel-backend-k7ar.onrender.com")

# The credentials live in .hostel-credentials.env at the repo root, which is
# gitignored. github.com/himanchops/Hostel is a PUBLIC repository, so the
# password cannot sit in this file — the convenience of not typing it every run
# is worth exactly one untracked file, not a credential in the git history of a
# repo anyone can clone. The environment still wins if it is set.
CRED_FILE = Path(__file__).resolve().parent.parent / ".hostel-credentials.env"


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

OWNER_NAME = "Lata Chopra"       # the account holder, shown in the sidebar chip
OWNER_PHONE = "8237770824"

SITE_NAME = "Chopra Boys Hostel"
SITE_ADDRESS = "15/3 Karve Road, Indrapushp Building, Pune-411004, Maharashtra"

# ── The layout ────────────────────────────────────────────────────────────────
#
# One row per room: (name, floor, bunks, singles)
#
#   bunks   — how many bunk *frames*. Each becomes two beds: "1L" and "1U",
#             lower and upper. So bunks=4 is an 8-sleeper room.
#   singles — standalone beds, numbered after the bunks. An int for plain
#             numbering, or a list when a bed needs its own label.
#
# Keep custom labels short. The grid tile is 96px wide and renders "Bed <name>"
# at 11px, and once a bed is occupied its tooltip shows the tenant rather than
# the bed — so a label that truncates is a label nobody can read. "Balcony"
# fits; "3 (balcony)" did not.
#
# A room of 4 bunks + 1 single therefore has beds 1L, 1U … 4L, 4U, 5.
#
# Why names and not a bed_type column: the beds table has exactly one label
# field, and nothing in the app would branch on a type if it existed — rent
# lives on the stay, not the bed, so an upper bunk can already be cheaper than
# a lower one without the schema knowing why. "1L"/"1U" renders as "Bed 1L" in
# the grid and sorts lower-before-upper on its own.
#
# Keep positions under 10 per room. The grid orders beds by name as text, so a
# tenth position would sort "10L" between "1L" and "1U".
#
# Floors are all 0 — the rooms are numbered 1–7 with no floor given, so the
# grid shows them as one group. Set the third column if they span floors.
LAYOUT = [
    # name,     floor, bunks, singles
    ("Room 1",  0,     4,     1),                 # 9 beds
    ("Room 2",  0,     4,     0),                 # 8 beds
    ("Room 3",  0,     4,     1),                 # 9 beds — same as Room 1
    ("Room 4",  0,     3,     1),                 # 7 beds
    ("Room 5",  0,     2,     ["Balcony"]),       # 5 beds
    ("Room 6",  0,     2,     1),                 # 5 beds
    ("Room 7",  0,     0,     2),                 # 2 beds
]


def bed_names(bunks: int, singles) -> list[str]:
    """Bed labels for one room. `singles` is a count, or explicit labels."""
    names = []
    pos = 1
    for _ in range(bunks):
        names += [f"{pos}L", f"{pos}U"]
        pos += 1
    if isinstance(singles, int):
        singles = [None] * singles
    for label in singles:
        names.append(label if label else str(pos))
        pos += 1
    return names


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
        return ("error", e.code, e.read().decode())
    except urllib.error.URLError as e:
        die(f"cannot reach {API} — is it awake? (Render free tier sleeps)\n  {e}")


def ok(res):
    return not (isinstance(res, tuple) and res and res[0] == "error")


def die(msg):
    sys.exit(f"\n✗ {msg}\n")


def must(res, what):
    if not ok(res):
        die(f"{what} → HTTP {res[1]}\n  {res[2]}")
    return res


def sign_in():
    """Log in; sign up only if the account genuinely does not exist yet.

    Login first, not signup first. seed-demo.py learned the hard way that
    "signup failed, so log in and write anyway" turns a collision with a real
    account into silent data corruption. Here the real account is the target,
    so the question is only whether it exists — and a 401 answers that without
    guessing.
    """
    res = call("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
    if ok(res):
        print(f"→ signed in as existing owner #{res['owner']['id']} ({EMAIL})")
        return res["token"]
    if res[1] != 401:
        die(f"login → HTTP {res[1]}\n  {res[2]}")

    print("→ no such account (or wrong password); trying signup")
    res = call("POST", "/auth/signup", {
        "name": OWNER_NAME, "email": EMAIL,
        "password": PASSWORD, "phone": OWNER_PHONE,
    })
    if ok(res):
        print(f"→ created owner #{res['owner']['id']} ({EMAIL})")
        return res["token"]
    if res[1] == 409:
        die("the account exists but the password was rejected.\n"
            "  Nothing was written. Fix HOSTEL_PASSWORD and re-run.")
    die(f"signup → HTTP {res[1]}\n  {res[2]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="print what would be created; write nothing")
    args = ap.parse_args()

    rooms_total = len(LAYOUT)
    beds_total = sum(len(bed_names(b, s)) for _, _, b, s in LAYOUT)

    print(f"\nTarget : {API}")
    print(f"Account: {EMAIL}")
    print(f"Site   : {SITE_NAME}")
    print(f"Plan   : {rooms_total} rooms, {beds_total} beds\n")
    for name, floor, bunks, singles in LAYOUT:
        names = bed_names(bunks, singles)
        print(f"  {name:<10} floor {floor}  {len(names)} beds: {', '.join(names)}")
    print()

    if args.dry_run:
        print("--dry-run: nothing was written.\n")
        return

    if not (EMAIL and PASSWORD):
        die(f"no credentials.\n"
            f"  Expected HOSTEL_EMAIL / HOSTEL_PASSWORD in {CRED_FILE}\n"
            f"  (gitignored) or in the environment.")

    token = sign_in()

    def api(method, path, body=None):
        return must(call(method, path, body, token), f"{method} {path}")

    # ── Site ─────────────────────────────────────────────────────────────────
    sites = api("GET", "/api/sites") or []
    site = next((s for s in sites if s["name"] == SITE_NAME), None)
    if site:
        print(f"= site '{SITE_NAME}' already exists (#{site['id']})")
    else:
        site = api("POST", "/api/sites",
                   {"name": SITE_NAME, "address": SITE_ADDRESS})
        print(f"+ site '{SITE_NAME}' (#{site['id']})")
    sid = site["id"]

    # ── Rooms and beds ───────────────────────────────────────────────────────
    existing_rooms = {r["name"]: r for r in (api("GET", f"/api/sites/{sid}/rooms") or [])}
    made_rooms = made_beds = 0

    for name, floor, bunks, singles in LAYOUT:
        room = existing_rooms.get(name)
        if room:
            print(f"= {name} exists (#{room['id']})")
        else:
            room = api("POST", f"/api/sites/{sid}/rooms", {"name": name, "floor": floor})
            made_rooms += 1
            print(f"+ {name} (floor {floor})")
        rid = room["id"]

        have = {b["name"] for b in (api("GET", f"/api/sites/{sid}/rooms/{rid}/beds") or [])}
        for bed in bed_names(bunks, singles):
            if bed in have:
                print(f"    = bed {bed}")
                continue
            api("POST", f"/api/sites/{sid}/rooms/{rid}/beds", {"name": bed})
            made_beds += 1
            print(f"    + bed {bed}")

    print(f"\n✓ created {made_rooms} rooms and {made_beds} beds "
          f"(existing ones were left alone)")
    print(f"  Grid: https://hostel-ten-kappa.vercel.app/sites/{sid}/grid\n")


if __name__ == "__main__":
    main()
