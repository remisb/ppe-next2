"""Generate the SIM card test pack: Lithuania, Latvia, Estonia, Poland.

Every price, plan and SIM card here is DEMO data for testing PPE. Operator
and brand names are real; their plans and prices are invented.
"""
import csv, json, random, sys, io
from pathlib import Path

OUT = Path(sys.argv[1])
rng = random.Random(20261115)

COUNTRIES = {
    "LT": {"name": "Lithuania", "cc": "370", "currency": "EUR", "vat": 21, "lang": "lt"},
    "LV": {"name": "Latvia", "cc": "371", "currency": "EUR", "vat": 21, "lang": "lv"},
    "EE": {"name": "Estonia", "cc": "372", "currency": "EUR", "vat": 24, "lang": "et"},
    "PL": {"name": "Poland", "cc": "48", "currency": "PLN", "vat": 23, "lang": "pl"},
}

# operator_id, country, operator, legal entity, MCC-MNC, website, provider name in PPE Settings
OPERATORS = [
    ("LT-TELIA", "LT", "Telia", "Telia Lietuva, AB", "246-01", "https://www.telia.lt", "Telia LT"),
    ("LT-BITE", "LT", "Bitė", "UAB Bitė Lietuva", "246-02", "https://www.bite.lt", "Bitė LT"),
    ("LT-TELE2", "LT", "Tele2", "UAB Tele2", "246-03", "https://www.tele2.lt", "Tele2 LT"),
    ("LV-LMT", "LV", "LMT", "Latvijas Mobilais Telefons SIA", "247-01", "https://www.lmt.lv", "LMT"),
    ("LV-TELE2", "LV", "Tele2", "Tele2 SIA", "247-02", "https://www.tele2.lv", "Tele2 LV"),
    ("LV-BITE", "LV", "Bite", "Bite Latvija SIA", "247-05", "https://www.bite.lv", "Bite LV"),
    ("EE-TELIA", "EE", "Telia", "Telia Eesti AS", "248-01", "https://www.telia.ee", "Telia EE"),
    ("EE-ELISA", "EE", "Elisa", "Elisa Eesti AS", "248-02", "https://www.elisa.ee", "Elisa EE"),
    ("EE-TELE2", "EE", "Tele2", "Tele2 Eesti AS", "248-03", "https://www.tele2.ee", "Tele2 EE"),
    ("PL-PLUS", "PL", "Plus", "Polkomtel sp. z o.o.", "260-01", "https://www.plus.pl", "Plus"),
    ("PL-TMOBILE", "PL", "T-Mobile", "T-Mobile Polska S.A.", "260-02", "https://www.t-mobile.pl", "T-Mobile PL"),
    ("PL-ORANGE", "PL", "Orange", "Orange Polska S.A.", "260-03", "https://www.orange.pl", "Orange PL"),
    ("PL-PLAY", "PL", "Play", "P4 sp. z o.o.", "260-06", "https://www.play.pl", "Play"),
]

# Demo badge colours are ours (distinct, readable on white and dark), never the brand's.
# official_color_hex is filled only where the brand colour is widely documented;
# every colour and logo note must be checked on the operator's own brand or press page.
BRANDS = [
    # brand_id, operator_id, brand, kind, segment, website, official hex, colour status, logo note, demo badge
    ("TELIA-LT", "LT-TELIA", "Telia", "main", "postpaid", "https://www.telia.lt", "#990AE3", "widely documented (Telia purple)", "Lower-case 'telia' wordmark beside a purple rounded symbol", "#7A2FD0"),
    ("EZYS", "LT-TELIA", "Ežys", "prepaid", "prepaid", "https://www.ezys.lt", "", "verify", "Wordmark of the prepaid brand; see its website", "#B0369E"),
    ("BITE-LT", "LT-BITE", "Bitė", "main", "postpaid", "https://www.bite.lt", "", "verify", "Wordmark; see the operator's website", "#C2410C"),
    ("LABAS", "LT-BITE", "Labas", "prepaid", "prepaid", "https://www.labas.lt", "", "verify", "Wordmark of the prepaid brand; see its website", "#D97706"),
    ("TELE2-LT", "LT-TELE2", "Tele2", "main", "postpaid", "https://www.tele2.lt", "#000000", "black and white wordmark; verify accents", "'Tele2' wordmark, black on white or white on black", "#334155"),
    ("PILDYK", "LT-TELE2", "Pildyk", "prepaid", "prepaid", "https://www.pildyk.lt", "", "verify", "Wordmark of the prepaid brand; see its website", "#0F766E"),
    ("LMT", "LV-LMT", "LMT", "main", "postpaid", "https://www.lmt.lv", "", "verify on stilagramata.lmt.lv (LMT brand book; greys #C8C9C7 and #53565A listed)", "'LMT' wordmark; official files in LMT's brand book", "#15803D"),
    ("OKARTE", "LV-LMT", "LMT Okarte", "prepaid", "prepaid", "https://www.lmt.lv/okarte", "", "verify", "Prepaid line under the LMT brand since 2013", "#4D7C0F"),
    ("TELE2-LV", "LV-TELE2", "Tele2", "main", "postpaid", "https://www.tele2.lv", "#000000", "black and white wordmark; verify accents", "'Tele2' wordmark, black on white or white on black", "#334155"),
    ("ZZ", "LV-TELE2", "Zelta Zivtiņa", "prepaid", "prepaid", "https://www.zz.lv", "", "verify", "Goldfish prepaid brand ('ZZ'); see its website", "#CA8A04"),
    ("BITE-LV", "LV-BITE", "Bite", "main", "postpaid", "https://www.bite.lv", "", "verify", "Wordmark; see the operator's website", "#C2410C"),
    ("BITE-KARTE", "LV-BITE", "Bites Karte", "prepaid", "prepaid", "https://www.bite.lv", "", "verify name and current status", "Prepaid line of Bite Latvija; see its website", "#EA580C"),
    ("TELIA-EE", "EE-TELIA", "Telia", "main", "postpaid", "https://www.telia.ee", "#990AE3", "widely documented (Telia purple)", "Lower-case 'telia' wordmark beside a purple rounded symbol", "#7A2FD0"),
    ("TELIA-EE-PP", "EE-TELIA", "Telia kõnekaart", "prepaid", "prepaid", "https://www.telia.ee", "", "verify: Telia merged its Estonian prepaid brands in 2024", "Prepaid under the Telia brand", "#9333EA"),
    ("ELISA-EE", "EE-ELISA", "Elisa", "main", "postpaid", "https://www.elisa.ee", "", "verify (a directory lists blue #0012B4 for Elisa Finland)", "Lower-case 'elisa' wordmark; see the operator's website", "#1D4ED8"),
    ("ELISA-EE-PP", "EE-ELISA", "Elisa kõnekaart", "prepaid", "prepaid", "https://www.elisa.ee", "", "verify brand name", "Prepaid under the Elisa brand", "#2563EB"),
    ("TELE2-EE", "EE-TELE2", "Tele2", "main", "postpaid", "https://www.tele2.ee", "#000000", "black and white wordmark; verify accents", "'Tele2' wordmark, black on white or white on black", "#334155"),
    ("SMART-EE", "EE-TELE2", "Smart", "prepaid", "prepaid", "https://www.tele2.ee", "", "verify", "Tele2's budget prepaid brand", "#0891B2"),
    ("PLUS", "PL-PLUS", "Plus", "main", "postpaid", "https://www.plus.pl", "", "verify", "Wordmark; see the operator's website", "#16A34A"),
    ("PLUSH", "PL-PLUS", "Plush", "sub-brand", "prepaid", "https://www.plush.pl", "", "verify", "Plus's youth and prepaid sub-brand", "#65A30D"),
    ("TMOBILE-PL", "PL-TMOBILE", "T-Mobile", "main", "postpaid", "https://www.t-mobile.pl", "#E20074", "widely documented (T-Mobile magenta)", "Magenta 'T' symbol with the T-Mobile wordmark", "#BE185D"),
    ("HEYAH", "PL-TMOBILE", "Heyah", "sub-brand", "prepaid", "https://www.heyah.pl", "", "verify", "T-Mobile's prepaid sub-brand", "#DC2626"),
    ("ORANGE-PL", "PL-ORANGE", "Orange", "main", "postpaid", "https://www.orange.pl", "#FF7900", "widely documented (Orange orange)", "White 'orange' wordmark in an orange square", "#EA580C"),
    ("NJU", "PL-ORANGE", "nju mobile", "sub-brand", "prepaid", "https://www.njumobile.pl", "", "verify", "Orange's online sub-brand", "#0D9488"),
    ("ORANGE-FLEX", "PL-ORANGE", "Orange Flex", "digital", "postpaid", "https://www.orange.pl/flex", "#FF7900", "follows Orange; verify", "App-only plan under the Orange brand", "#F97316"),
    ("PLAY", "PL-PLAY", "Play", "main", "postpaid", "https://www.play.pl", "", "verify (violet)", "'play' wordmark; see the operator's website", "#6D28D9"),
    ("VIRGIN-PL", "PL-PLAY", "Virgin Mobile", "sub-brand", "prepaid", "https://www.virginmobile.pl", "", "verify", "Owned by Play, on Play's network", "#B91C1C"),
]

# Prepaid brands are their own providers in PPE: the carrier shows their name.
PREPAID_PROVIDER = {"EZYS": "Ežys", "LABAS": "Labas", "PILDYK": "Pildyk", "OKARTE": "LMT Okarte",
                    "ZZ": "Zelta Zivtiņa", "BITE-KARTE": "Bites Karte", "TELIA-EE-PP": "Telia kõnekaart",
                    "ELISA-EE-PP": "Elisa kõnekaart", "SMART-EE": "Smart", "PLUSH": "Plush",
                    "HEYAH": "Heyah", "NJU": "nju mobile", "VIRGIN-PL": "Virgin Mobile"}

op_by_id = {o[0]: o for o in OPERATORS}
COUNTRY_FACTOR = {"LT": 1.0, "LV": 1.06, "EE": 1.12, "PL": 3.6}  # PL in PLN


def price(base, country, jitter=0.08):
    v = base * COUNTRY_FACTOR[country] * (1 + rng.uniform(-jitter, jitter))
    if country == "PL":
        return round(v) - 0.01 if v > 5 else round(v, 2)
    return round(v) - 0.01 if v > 3 else round(v, 2)


def ex_vat(gross, vat):
    return round(gross / (1 + vat / 100), 2)


# ---------- operators.csv
operators = [{
    "operator_id": o[0], "country_code": o[1], "country": COUNTRIES[o[1]]["name"], "operator": o[2],
    "legal_entity": o[3], "mcc_mnc": o[4], "network": "MNO", "website": o[5],
    "ppe_provider_name": o[6], "dialling_code": "+" + COUNTRIES[o[1]]["cc"],
    "currency": COUNTRIES[o[1]]["currency"], "vat_rate_pct": COUNTRIES[o[1]]["vat"],
    "iccid_prefix": "89" + COUNTRIES[o[1]]["cc"] + o[4].split("-")[1],
} for o in OPERATORS]

# ---------- brands.csv
brands = [{
    "brand_id": b[0], "operator_id": b[1], "country_code": op_by_id[b[1]][1], "brand": b[2], "kind": b[3],
    "segment": b[4], "website": b[5], "official_color_hex": b[6], "color_status": b[7],
    "logo_description": b[8], "logo_source": "Download from the brand's own website or press page; do not redraw",
    "trademark_note": f"{b[2]} is a trademark of {op_by_id[b[1]][3]}; use only to name the provider",
    "demo_badge_color": b[9], "demo_badge_text": "".join(w[0] for w in b[2].replace("-", " ").split())[:3].upper(),
    "ppe_provider_name": PREPAID_PROVIDER.get(b[0], op_by_id[b[1]][6]),
} for b in BRANDS]

# ---------- plans.csv (postpaid, business and consumer)
PLAN_TEMPLATES = [
    # code, name, segment, data_gb, minutes, sms, eu_gb, base monthly price (LT EUR), contract months, esim
    ("BIZ-S", "Business S 10 GB", "business", "10", "unlimited", "unlimited", "10", 9.99, 24, True),
    ("BIZ-M", "Business M 30 GB", "business", "30", "unlimited", "unlimited", "17", 14.99, 24, True),
    ("BIZ-L", "Business L Unlimited", "business", "unlimited", "unlimited", "unlimited", "25", 21.99, 24, True),
    ("BIZ-DATA", "Business Data 100 GB", "business", "100", "0", "0", "20", 12.99, 12, True),
    ("BIZ-M2M", "IoT / M2M 500 MB", "business", "0.5", "0", "100", "0.5", 1.99, 12, False),
    ("CON-5", "Smart 5 GB", "consumer", "5", "300", "unlimited", "5", 6.99, 0, True),
    ("CON-UNL", "Smart Unlimited", "consumer", "unlimited", "unlimited", "unlimited", "22", 18.99, 24, True),
]
plans = []
for o in OPERATORS:
    oid, cc = o[0], o[1]
    main = next(b for b in BRANDS if b[1] == oid and b[3] == "main")
    for code, name, seg, gb, mins, sms, eu, base, months, esim in PLAN_TEMPLATES:
        gross = price(base, cc)
        plans.append({
            "plan_id": f"{oid}-{code}", "operator_id": oid, "brand_id": main[0], "country_code": cc,
            "plan_name": f"{name} (demo)", "segment": seg, "plan_type": "postpaid",
            "data_gb": gb, "minutes": mins, "sms": sms, "eu_roaming_gb": eu,
            "monthly_price": gross, "monthly_price_ex_vat": ex_vat(gross, COUNTRIES[cc]["vat"]),
            "currency": COUNTRIES[cc]["currency"], "vat_rate_pct": COUNTRIES[cc]["vat"],
            "contract_months": months, "sim_fee": 0 if seg == "business" else price(2.0, cc, 0),
            "esim": "yes" if esim else "no", "ppe_plan_label": f"{name}", "is_demo": "yes",
        })

# ---------- prepaid_offers.csv
PREPAID_TEMPLATES = [
    # code, name, type, data_gb, minutes, sms, validity_days, base price, credit
    ("START", "Starter pack", "starter", "1", "50", "50", 180, 2.99, 2.00),
    ("D7", "Data 7 days 10 GB", "bundle", "10", "0", "0", 7, 2.99, 0),
    ("M30", "Month 20 GB", "bundle", "20", "unlimited", "unlimited", 30, 6.99, 0),
    ("UNL30", "Month Unlimited", "bundle", "unlimited", "unlimited", "unlimited", 30, 11.99, 0),
    ("TOPUP10", "Top-up 10", "top-up", "0", "0", "0", 180, 10.00, 10.00),
]
prepaid = []
for b in BRANDS:
    if b[4] != "prepaid":
        continue
    cc = op_by_id[b[1]][1]
    for code, name, typ, gb, mins, sms, days, base, credit in PREPAID_TEMPLATES:
        p = round(base * COUNTRY_FACTOR[cc], 2) if typ == "top-up" else price(base, cc)
        prepaid.append({
            "offer_id": f"{b[0]}-{code}", "brand_id": b[0], "operator_id": b[1], "country_code": cc,
            "brand": b[2], "offer_name": f"{name} (demo)", "offer_type": typ, "data_gb": gb,
            "minutes": mins, "sms": sms, "validity_days": days, "price": p,
            "included_credit": round(credit * COUNTRY_FACTOR[cc], 2) if credit else 0,
            "currency": COUNTRIES[cc]["currency"], "vat_rate_pct": COUNTRIES[cc]["vat"],
            "eu_roaming": "yes" if typ != "top-up" else "n/a", "registration_required": "yes",
            "esim": "yes" if cc in ("EE", "PL") else "no", "is_demo": "yes",
        })

# ---------- services.csv (add-ons and one-off fees)
SERVICE_TEMPLATES = [
    ("DATA5", "Extra data 5 GB", "data add-on", "one-off", 3.99),
    ("ROAM-EU10", "EU roaming extra 10 GB", "roaming", "one-off", 4.99),
    ("ROAM-Z2", "Roaming outside the EU, 1 GB (UK, CH, US)", "roaming", "one-off", 9.99),
    ("INTL100", "International calls 100 min", "calls", "monthly", 4.99),
    ("ESIM", "eSIM activation", "SIM", "one-off", 0.0),
    ("SIMREP", "SIM card replacement", "SIM", "one-off", 4.99),
    ("BLOCK", "Block a lost or stolen SIM", "SIM", "one-off", 0.0),
    ("PORT", "Number porting in", "number", "one-off", 0.0),
    ("MULTI", "MultiSIM (second SIM, same number)", "SIM", "monthly", 2.99),
    ("APN-IP", "Private APN with fixed IP", "business", "monthly", 9.99),
    ("BAR", "Barring of premium numbers", "business", "monthly", 0.0),
    ("SUPPORT", "Priority business support", "business", "monthly", 5.99),
]
services = []
for o in OPERATORS:
    oid, cc = o[0], o[1]
    for code, name, cat, billing, base in SERVICE_TEMPLATES:
        p = 0.0 if base == 0 else price(base, cc, 0.1)
        services.append({
            "service_id": f"{oid}-{code}", "operator_id": oid, "country_code": cc, "service_name": f"{name} (demo)",
            "category": cat, "billing": billing, "price": p, "price_ex_vat": ex_vat(p, COUNTRIES[cc]["vat"]),
            "currency": COUNTRIES[cc]["currency"], "applies_to": "postpaid" if cat == "business" else "postpaid, prepaid",
            "is_demo": "yes",
        })


# ---------- SIM numbers and phone numbers
def luhn_digit(body):
    s = 0
    for i, ch in enumerate(reversed(body)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        s += d
    return str((10 - s % 10) % 10)


SERIAL = {}


def iccid(oid, block):
    """A 19-digit ICCID, Luhn-checked: 89 + country + MNC + block + serial.

    Blocks keep files apart: 1 import files, 2 printable scan cards, 3 Add SIM by hand, 9 negative tests."""
    o = op_by_id[oid]
    head = "89" + COUNTRIES[o[1]]["cc"] + o[4].split("-")[1] + str(block) + "99"  # 99: test range marker
    SERIAL[(oid, block)] = SERIAL.get((oid, block), 0) + 1
    body = head + str(SERIAL[(oid, block)]).zfill(18 - len(head))
    return body + luhn_digit(body)


def phone(cc):
    if cc == "LT":
        return f"+370 6{rng.randint(0, 99):02d} {rng.randint(0, 99999):05d}"
    if cc == "LV":
        return f"+371 2{rng.randint(0, 999):03d} {rng.randint(0, 9999):04d}"
    if cc == "EE":
        return f"+372 5{rng.randint(0, 999):03d} {rng.randint(0, 9999):04d}"
    return f"+48 5{rng.randint(0, 99):02d} {rng.randint(0, 999):03d} {rng.randint(0, 999):03d}"


def spaced(s):
    return " ".join(s[i:i + 4] for i in range(0, len(s), 4))


# Employees from `make seed-demo`, so held cards import against a demo database.
EMPLOYEES = ["Jonas Petraitis", "Ona Kazlauskienė", "Tomas Jankauskas", "Rasa Stankevičiūtė",
             "Mindaugas Vasiliauskas", "Aleksandr Ivanov"]
STATUSES = ["Active", "Active", "Available", "Available", "Not Activated", "Blocked"]

# Each provider (operator or prepaid brand) gets cards for import.
providers = []  # (provider name, operator_id, brand_id, prepaid?)
for o in OPERATORS:
    providers.append((o[6], o[0], next(b[0] for b in BRANDS if b[1] == o[0] and b[3] == "main"), False))
for bid, name in PREPAID_PROVIDER.items():
    b = next(x for x in BRANDS if x[0] == bid)
    providers.append((name, b[1], bid, True))

sim_cards = []
emp_i = 0
for name, oid, bid, pre in providers:
    cc = op_by_id[oid][1]
    n = 3 if pre else 4
    for i in range(n):
        status = STATUSES[(i + len(sim_cards)) % len(STATUSES)]
        holder = ""
        if status in ("Active", "Blocked") and i % 2 == 0:
            holder = EMPLOYEES[emp_i % len(EMPLOYEES)]
            emp_i += 1
        plan = ""
        if pre:
            plan = f"{dict((b[0], b[2]) for b in BRANDS)[bid]} prepaid"
        elif status != "Not Activated":
            plan = rng.choice(["Business S 10 GB", "Business M 30 GB", "Business L Unlimited", "Business Data 100 GB"])
        sim = iccid(oid, 1)
        sim_cards.append({
            "sim_no": spaced(sim) if i % 2 else sim, "phone_no": "" if status == "Not Activated" else phone(cc),
            "provider": name, "employee_name": holder, "connection_status": status,
            # extra columns, not in the import file
            "country_code": cc, "operator_id": oid, "brand_id": bid, "prepaid": "yes" if pre else "no",
            "plan": plan, "pin": f"{rng.randint(0, 9999):04d}", "puk": f"{rng.randint(0, 99999999):08d}",
            "expected": "imported" + (f", given to {holder} without a form" if holder else ", in the Office"),
        })

# ---------- printable scan cards (Scan SIMs)
scan_cards = []
for name, oid, bid, pre in providers:
    for i in range(2):
        sim = iccid(oid, 2)
        scan_cards.append({
            "card_id": f"SC-{len(scan_cards) + 1:03d}", "sim_no": sim, "barcode": "CODE128", "pin": f"{rng.randint(0, 9999):04d}",
            "puk": f"{rng.randint(0, 99999999):08d}", "ean13_product_code": "4770000000015" if op_by_id[oid][1] == "LT" else "5901234123457",
            "provider": name, "country_code": op_by_id[oid][1], "prepaid": "yes" if pre else "no",
            "case": "valid", "expected": "read and added Not Activated, in the Office",
        })
# deliberate problems for the review list
bad = iccid("LT-TELIA", 9)
bad_luhn = bad[:-1] + str((int(bad[-1]) + 1) % 10)
dup = iccid("LV-LMT", 9)
filler = iccid("EE-ELISA", 9)
NEG = [
    (bad_luhn, "1234", "12345678", "Telia LT", "LT", "check_digit", "marked: the SIM No.'s last digit does not check"),
    (dup, "4321", "87654321", "LMT", "LV", "duplicate (1 of 2)", "both cards marked: another card of the list has it"),
    (dup, "4321", "87654321", "LMT", "LV", "duplicate (2 of 2)", "both cards marked: another card of the list has it"),
    (filler, "5555", "11112222", "Elisa EE", "EE", "valid with filler", "read; the same SIM as the next card"),
    (filler + "F", "5555", "11112222", "Elisa EE", "EE", "filler F duplicate", "marked duplicate: …5 and …5F are the same SIM"),
    (iccid("PL-PLAY", 9), "123", "12345678", "Play", "PL", "pin", "marked: PIN is not 4 to 8 digits"),
    (iccid("PL-ORANGE", 9), "1234", "1234567", "Orange PL", "PL", "puk", "marked: PUK is not 8 digits"),
    (sim_cards[0]["sim_no"].replace(" ", ""), "0000", "00000000", sim_cards[0]["provider"], "LT", "registered", "marked after the import: a SIM in the register has it"),
]
for sim, pin, puk, prov, cc, case, exp in NEG:
    scan_cards.append({
        "card_id": f"SC-{len(scan_cards) + 1:03d}", "sim_no": sim, "barcode": "CODE128", "pin": pin, "puk": puk,
        "ean13_product_code": "4770000000015", "provider": prov, "country_code": cc,
        "prepaid": "no", "case": case, "expected": exp,
    })

# ---------- PPE Settings: SIM providers (PUT /api/v1/settings/sim-providers)
def slug(s):
    t = s.lower()
    for a, b in (("ė", "e"), ("ž", "z"), ("ņ", "n"), ("õ", "o"), (" ", "-")):
        t = t.replace(a, b)
    return "".join(ch for ch in t if ch.isalnum() or ch == "-")


settings_providers = []
for name, oid, bid, pre in providers:
    settings_providers.append({
        "name": name,
        "email": f"sim-orders+{slug(name)}@example.com",
        "default_plan": f"{dict((b[0], b[2]) for b in BRANDS)[bid]} prepaid" if pre else "Business S 10 GB",
        "country_code": op_by_id[oid][1], "operator_id": oid, "prepaid": "yes" if pre else "no",
    })
settings_request = {
    "providers": [{"name": p["name"], "email": p["email"], "default_plan": p["default_plan"]} for p in settings_providers],
    "default": "Telia LT",
    "default_non_return_value_cents": 3000,
}

# ---------- negative import file
neg_import = [
    {"sim_no": iccid("LT-BITE", 9), "phone_no": phone("LT"), "provider": "Bitė LT", "employee_name": "Jonas Petraitis", "connection_status": "Available", "problem": "Available with a holder is refused"},
    {"sim_no": iccid("LT-BITE", 9), "phone_no": phone("LT"), "provider": "Bitė LT", "employee_name": "Nobody Unknown", "connection_status": "Active", "problem": "no such employee"},
    {"sim_no": iccid("LV-BITE", 9), "phone_no": phone("LV"), "provider": "Bite LV", "employee_name": "", "connection_status": "Suspended", "problem": "unknown status"},
    {"sim_no": sim_cards[1]["sim_no"], "phone_no": phone("LV"), "provider": "Tele2 LV", "employee_name": "", "connection_status": "Active", "problem": "SIM No. already registered (after the good import)"},
    {"sim_no": iccid("EE-TELE2", 9), "phone_no": "+372 abc 1234", "provider": "Tele2 EE", "employee_name": "", "connection_status": "Active", "problem": "not a phone number"},
    {"sim_no": iccid("PL-PLUS", 9), "phone_no": phone("PL"), "provider": "Polsat Box Go", "employee_name": "", "connection_status": "Active", "problem": "provider not in Settings: noted, not refused"},
]

# ---------- test cases
T = []


def tc(area, title, pre, steps, expected, data, prio="P1", role="Administrator"):
    T.append({"test_id": f"SIM-{len(T) + 1:03d}", "area": area, "title": title, "role": role, "preconditions": pre,
              "steps": steps, "expected": expected, "data_file": data, "priority": prio})


tc("Settings", "Add the 26 SIM providers", "make seed-demo (or an empty DB with an admin); signed in", "Administration → Settings → SIM providers: add each provider of settings_sim_providers.csv with its e-mail and default plan; choose Telia LT as the default; Non-return Value 30.00 €. Or PUT settings_sim_providers.request.json to /api/v1/settings/sim-providers", "Settings lists 26 providers in order, Telia LT chosen first, 30.00 €", "settings_sim_providers.csv", "P0")
tc("Settings", "Provider e-mails go nowhere real", "SIM-001 done", "Open a provider's e-mail on Settings", "Every address is …@example.com, so a test e-mail never reaches an operator", "settings_sim_providers.csv", "P0")
for cc, nm in (("lt", "Lithuania"), ("lv", "Latvia"), ("ee", "Estonia"), ("pl", "Poland")):
    tc("Import", f"Check the {nm} SIM list without writing", "SIM-001 done; make seed-demo (for the holders)", f"make import-sims FILE=docs/test-packs/sim-cards-baltics-poland/import/sim-import-{cc}.csv", "Each card is listed with its status and holder; nothing is written; no problems", f"import/sim-import-{cc}.csv", "P0")
tc("Import", "Import all four countries", "SIM-003…006 pass", "make import-sims FILE=…/import/sim-import-all.csv COMMIT=yes", f"{len(sim_cards)} SIM cards added in one go; held ones given to their employee with no form; Available and Not Activated in the Office", "import/sim-import-all.csv", "P0")
tc("Import", "Semicolons, a byte order mark and columns in another order", "an empty register (or before SIM-007)", "make import-sims FILE=…/import/sim-import-all-semicolon-bom.csv", "Read the same as the comma file: same cards, no problems", "import/sim-import-all-semicolon-bom.csv", "P1")
tc("Import", "Running the import twice imports nothing", "SIM-007 done", "Run SIM-007's command again", "Refused: every SIM No. is already registered; nothing written", "import/sim-import-all.csv", "P1")
tc("Import", "Every problem is listed, nothing written", "SIM-007 done", "make import-sims FILE=…/import/sim-import-errors.csv", "Nothing is written. First pass: lines 2-4 named (Available with a holder, unknown employee, unknown status). Delete them and run again: the unknown provider is only noted, line 6 refused (not a phone number), and after SIM-007 line 5 (SIM No. already registered)", "import/sim-import-errors.csv", "P0")
tc("SIM Cards", "Tabs count and filter by status", "SIM-007 done", "Company Assets → SIM Cards; open each tab", "Counts match sim_cards.csv's statuses (Available counts as Active)", "sim_cards.csv", "P1", "Manager")
tc("SIM Cards", "Phone numbers of four countries", "SIM-007 done", "Open an LV, an EE and a PL card", "Phone No. shown as written (+371 …, +372 …, +48 …)", "sim_cards.csv", "P1", "Manager")
tc("SIM Cards", "Find a card by number in ⌘K", "SIM-007 done", "⌘K, type the last 6 digits of a SIM No.", "The card is found and opens beside the register", "sim_cards.csv", "P2", "Manager")
tc("Add SIM", "Add SIM by hand for each country", "SIM-001 done", "Add SIM with a SIM No. of block 3 (any provider) from add_sim_manual.csv", "Added Not Activated in the Office, provider's default plan and the 30.00 € value filled in", "add_sim_manual.csv", "P1", "Manager")
tc("Add SIM", "A prepaid card", "SIM-001 done", "Add SIM, provider Labas (or any prepaid brand)", "The plan is the brand's prepaid plan from Settings", "add_sim_manual.csv", "P1", "Manager")
tc("Give and return", "Give SIM against a printed form", "an Active card in the Office", "Give SIM to Ona Kazlauskienė; print the form; Upload Signed Form (any PDF)", "Given; form printed with provider, plan, phone and value; signed copy listed", "sim_cards.csv", "P0", "Manager")
tc("Give and return", "Print Form for an imported held card", "SIM-007 done; Edit the card's Non-return Value first", "Open a held card from the import → ⋯ → Print Form", "Without a value it says so; with one it prints, dated 2026-08-03; asset.form_printed recorded", "sim_cards.csv", "P1", "Manager")
tc("Give and return", "Return and Mark as Not Returned", "two given cards", "Return one; Mark the other as Not Returned with a reason", "The first is back in the Office; the second shows Not Returned; neither status changed", "sim_cards.csv", "P1", "Manager")
tc("Status", "Change Status never moves the card", "a given Active card", "Change Status → Blocked", "Blocked, still with its holder", "sim_cards.csv", "P1", "Manager")
tc("E-mails", "Prepare Activation Email", "a Not Activated card; Mail Templates set", "Open the card → Prepare Activation Email", "To is the provider's example.com address, the card's numbers filled in; Send Email only opens your mail app", "settings_sim_providers.csv", "P1", "Manager")
tc("E-mails", "Prepare Blocking Email", "an Active card", "Prepare Blocking Email", "As above, the blocking template", "settings_sim_providers.csv", "P2", "Manager")
tc("Scan SIMs", "Scan the valid printed cards", "SIM-001 done; scan_cards.html printed or on a second screen", f"Open /apps/sim-scan/; For every SIM: provider; photograph front and back of SC-001…SC-{2 * len(providers):03d} (by provider)", "Each SIM No. read from the Code 128 barcode, never the EAN-13; PIN and PUK read; Add adds them all", "scan_cards.csv", "P0", "Manager")
tc("Scan SIMs", "The review list marks every problem", "SIM-007 done", f"Scan SC-{2 * len(providers) + 1:03d}…SC-{len(scan_cards):03d}", "Check digit, duplicate, …5F, PIN, PUK and registered cards are marked; Add refuses until fixed", "scan_cards.csv", "P0", "Manager")
tc("Scan SIMs", "Show PIN and PUK", "cards added by SIM-022; a recent sign-in", "Show PIN and PUK; find a card by number", "Asks for your password if the sign-in is not recent; shows the codes from scan_cards.csv; recorded as asset.sim_codes_shown", "scan_cards.csv", "P0", "Manager")
tc("Access", "An employee sees no SIM cards", "an Employee user", "Sign in as the employee; open /assets/sim-cards", "Company Assets is not offered; the API answers 403", "", "P1", "Employee")
tc("Audit", "Every change is in the Changes", "the steps above done", "Open a card → Changes; Administration → Audit log, filter asset.*", "asset.registered, asset.given, asset.returned, asset.status_changed … with who and when", "", "P2")

# manual Add SIM numbers
add_manual = []
for name, oid, bid, pre in providers:
    add_manual.append({"sim_no": iccid(oid, 3), "provider": name, "phone_no": phone(op_by_id[oid][1]),
                       "country_code": op_by_id[oid][1], "prepaid": "yes" if pre else "no"})

# ---------- write
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "import").mkdir(exist_ok=True)
(OUT / "json").mkdir(exist_ok=True)
(OUT / "sql").mkdir(exist_ok=True)


def write_csv(path, rows, cols=None, delim=",", bom=False):
    cols = cols or list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8-sig" if bom else "utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, delimiter=delim, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


DATASETS = {
    "operators": operators, "brands": brands, "plans": plans, "prepaid_offers": prepaid,
    "services": services, "settings_sim_providers": settings_providers, "sim_cards": sim_cards,
    "scan_cards": scan_cards, "add_sim_manual": add_manual, "test_cases": T,
}
for name, rows in DATASETS.items():
    write_csv(OUT / f"{name}.csv", rows)
    (OUT / "json" / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")

IMPORT_COLS = ["sim_no", "phone_no", "provider", "employee_name", "connection_status"]
for cc in COUNTRIES:
    write_csv(OUT / "import" / f"sim-import-{cc.lower()}.csv", [r for r in sim_cards if r["country_code"] == cc], IMPORT_COLS)
write_csv(OUT / "import" / "sim-import-all.csv", sim_cards, IMPORT_COLS)
write_csv(OUT / "import" / "sim-import-all-semicolon-bom.csv", sim_cards,
          ["connection_status", "employee_name", "provider", "phone_no", "sim_no"], ";", True)
write_csv(OUT / "import" / "sim-import-errors.csv", neg_import, IMPORT_COLS)
write_csv(OUT / "import" / "sim-import-errors.expected.csv", neg_import, IMPORT_COLS + ["problem"])
(OUT / "settings_sim_providers.request.json").write_text(json.dumps(settings_request, ensure_ascii=False, indent=2) + "\n")

meta = {
    "title": "SIM card test pack: Lithuania, Latvia, Estonia, Poland",
    "generated": "2026-11-15", "generator": "docs/test-packs/sim-cards-baltics-poland/generate.py (seed 20261115)",
    "demo": True,
    "notice": "Operator and brand names are real; every plan, price, SIM number, phone number, PIN and PUK is invented for testing. Brand colours and logo notes must be checked on each operator's own brand or press page before any use.",
    "countries": COUNTRIES,
}
(OUT / "json" / "all-data.json").write_text(json.dumps({"meta": meta, **DATASETS, "import_errors": neg_import,
                                                         "settings_request": settings_request}, ensure_ascii=False, indent=2) + "\n")


# SQL: a standalone reference schema, not the app's tables (PPE writes SIM cards through its services).
def sqlval(v):
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def sqltype(vals):
    if all(isinstance(v, int) and not isinstance(v, bool) for v in vals):
        return "integer"
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in vals):
        return "numeric(10,2)"
    return "text"


sql = io.StringIO()
sql.write("-- SIM card test pack (demo data). A standalone schema for reference and reports;\n"
          "-- PPE itself takes SIM cards through import/ and Settings, never through these tables.\n"
          "BEGIN;\nCREATE SCHEMA IF NOT EXISTS sim_testpack;\n\n")
for name, rows in DATASETS.items():
    cols = list(rows[0].keys())
    sql.write(f"DROP TABLE IF EXISTS sim_testpack.{name};\nCREATE TABLE sim_testpack.{name} (\n")
    sql.write(",\n".join(f"  {c} {sqltype([r[c] for r in rows])}" for c in cols))
    sql.write("\n);\n")
    sql.write(f"INSERT INTO sim_testpack.{name} ({', '.join(cols)}) VALUES\n")
    sql.write(",\n".join("  (" + ", ".join(sqlval(r[c]) for c in cols) + ")" for r in rows))
    sql.write(";\n\n")
sql.write("COMMIT;\n")
(OUT / "sql" / "sim_testpack.sql").write_text(sql.getvalue())

print({k: len(v) for k, v in DATASETS.items()})

# ---------- printable test carriers for Scan SIMs (open in a browser, print A4, cut out)
CARDS_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Scan SIMs test cards</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
<style>
  body { font: 13px/1.35 system-ui, sans-serif; margin: 16px; color: #111; background: #fff }
  h1 { font-size: 18px; margin: 0 0 4px } p.note { margin: 0 0 12px; color: #444 }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(86mm, 1fr)); gap: 6mm }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; break-inside: avoid }
  .side { border: 1px dashed #888; border-radius: 3mm; padding: 3mm; min-height: 46mm; display: flex; flex-direction: column; gap: 2mm }
  .tag { font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: #a00; font-weight: 700 }
  .prov { font-weight: 700; font-size: 14px } .meta { font-size: 10px; color: #555 }
  .codes { font: 600 15px/1.6 ui-monospace, Menlo, monospace } svg { max-width: 100%; height: auto }
  .bad { outline: 2px solid #c60; }
  @media print { body { margin: 8mm } .noprint { display: none } }
</style></head><body>
<h1>Scan SIMs test cards</h1>
<p class="note noprint">Test carriers for PPE's Scan SIMs: front (SIM No. as Code 128, product code as EAN-13) and back (PIN and PUK).
Not real SIM cards. Print at 100% on A4, or show on a second screen. Orange outline: a card made to be marked in the review list (see scan_cards.csv, column <code>case</code>).</p>
<div class="grid" id="grid"></div>
<script>
const CARDS = __CARDS__;
const grid = document.getElementById('grid');
for (const c of CARDS) {
  const pair = document.createElement('div'); pair.className = 'pair' + (c.case === 'valid' ? '' : ' bad');
  pair.innerHTML = `<div class="side"><span class="tag">Test card · not a SIM</span><span class="prov">${c.provider}</span>
    <svg class="sim"></svg><svg class="ean"></svg><span class="meta">${c.card_id} · ${c.country_code}${c.case === 'valid' ? '' : ' · ' + c.case}</span></div>
    <div class="side"><span class="tag">Test card · not a SIM</span><span class="prov">${c.provider}</span>
    <div class="codes">PIN ${c.pin}<br>PUK ${c.puk}</div><span class="meta">Customer service: test only<br>${c.card_id}</span></div>`;
  grid.appendChild(pair);
  JsBarcode(pair.querySelector('.sim'), c.sim_no, { format: 'CODE128', height: 46, width: 1.5, fontSize: 12, margin: 0 });
  try { JsBarcode(pair.querySelector('.ean'), c.ean13_product_code, { format: 'EAN13', height: 26, width: 1.2, fontSize: 10, margin: 0 }); } catch (e) { pair.querySelector('.ean').remove(); }
}
</script></body></html>
"""
(OUT / "scan_cards.html").write_text(CARDS_HTML.replace("__CARDS__", json.dumps(scan_cards, ensure_ascii=False)))
