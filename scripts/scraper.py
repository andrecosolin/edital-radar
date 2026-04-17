"""
scraper.py — Edital Radar
Fetches Brazilian public funding opportunities from gov.br, FINEP, and BNDES.
Results are saved as JSON in /data/<today>.json.
"""

import json
import logging
import re
from datetime import date
from pathlib import Path

import requests
from bs4 import BeautifulSoup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; EditalRadarBot/1.0; "
        "+https://github.com/seu-usuario/edital-radar)"
    )
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get(url: str, **kwargs) -> requests.Response | None:
    """GET with basic error handling; returns None on failure."""
    try:
        resp = SESSION.get(url, timeout=20, **kwargs)
        resp.raise_for_status()
        return resp
    except requests.RequestException as exc:
        log.warning("Failed to fetch %s: %s", url, exc)
        return None


def clean(text: str | None) -> str:
    """Strip excess whitespace from a string."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------------------
# Source: gov.br
# ---------------------------------------------------------------------------

GOV_BR_URL = "https://www.gov.br/pt-br/noticias"
EDITAL_KEYWORDS = re.compile(
    r"\bedital|chamada p[uú]blica|financiamento|sele[cç][aã]o p[uú]blica\b",
    re.IGNORECASE,
)


def scrape_govbr() -> list[dict]:
    """
    Scrapes gov.br news listing and filters items whose title or description
    contain edital-related keywords.
    """
    source = "gov.br"
    log.info("Scraping %s …", source)
    opportunities = []

    resp = get(GOV_BR_URL)
    if resp is None:
        return opportunities

    soup = BeautifulSoup(resp.text, "lxml")

    # gov.br news cards use <article> or <div class="tileItem"> depending on
    # the current portal theme — we try both selectors.
    cards = soup.select("article.tileItem, div.tileItem, li.tileItem")
    if not cards:
        # Fallback: any <a> with a heading nearby
        cards = soup.select("h2 a, h3 a")

    for card in cards:
        if isinstance(card.name, str) and card.name == "a":
            title = clean(card.get_text())
            link = card.get("href", "")
            description = ""
        else:
            title_tag = card.select_one("h2, h3, .tileHeadline")
            title = clean(title_tag.get_text()) if title_tag else ""
            link_tag = card.select_one("a")
            link = link_tag.get("href", "") if link_tag else ""
            desc_tag = card.select_one("p, .tileBody, .description")
            description = clean(desc_tag.get_text()) if desc_tag else ""

        if not title:
            continue

        combined = f"{title} {description}"
        if not EDITAL_KEYWORDS.search(combined):
            continue

        if link and not link.startswith("http"):
            link = "https://www.gov.br" + link

        opportunities.append(
            {
                "source": source,
                "title": title,
                "description": description,
                "url": link,
            }
        )

    log.info("  %d opportunities found on %s", len(opportunities), source)
    return opportunities


# ---------------------------------------------------------------------------
# Source: FINEP
# ---------------------------------------------------------------------------

FINEP_URL = "https://www.finep.gov.br/chamadas-publicas"


def scrape_finep() -> list[dict]:
    """Scrapes FINEP's open public calls listing."""
    source = "FINEP"
    log.info("Scraping %s …", source)
    opportunities = []

    resp = get(FINEP_URL)
    if resp is None:
        return opportunities

    soup = BeautifulSoup(resp.text, "lxml")

    # FINEP renders calls in a table or list; try <table> rows first.
    rows = soup.select("table tbody tr")
    if rows:
        for row in rows:
            cols = row.find_all("td")
            if not cols:
                continue
            title_tag = row.select_one("a")
            title = clean(title_tag.get_text()) if title_tag else clean(cols[0].get_text())
            link = title_tag.get("href", "") if title_tag else ""
            if link and not link.startswith("http"):
                link = "https://www.finep.gov.br" + link
            deadline = clean(cols[-1].get_text()) if len(cols) > 1 else ""
            opportunities.append(
                {
                    "source": source,
                    "title": title,
                    "description": f"Prazo: {deadline}" if deadline else "",
                    "url": link,
                }
            )
    else:
        # Fallback: generic card / list items
        items = soup.select("div.item, li.chamada, article")
        for item in items:
            title_tag = item.select_one("h2, h3, a")
            title = clean(title_tag.get_text()) if title_tag else ""
            link_tag = item.select_one("a")
            link = link_tag.get("href", "") if link_tag else ""
            if link and not link.startswith("http"):
                link = "https://www.finep.gov.br" + link
            desc_tag = item.select_one("p")
            description = clean(desc_tag.get_text()) if desc_tag else ""
            if title:
                opportunities.append(
                    {"source": source, "title": title, "description": description, "url": link}
                )

    log.info("  %d opportunities found on %s", len(opportunities), source)
    return opportunities


# ---------------------------------------------------------------------------
# Source: BNDES
# ---------------------------------------------------------------------------

BNDES_URL = "https://www.bndes.gov.br/wps/portal/site/home/financiamento/chamadas-abertas"
BNDES_FALLBACK_URL = "https://www.bndes.gov.br"


def scrape_bndes() -> list[dict]:
    """Scrapes BNDES open calls/financing programs."""
    source = "BNDES"
    log.info("Scraping %s …", source)
    opportunities = []

    resp = get(BNDES_URL)
    if resp is None:
        resp = get(BNDES_FALLBACK_URL)
    if resp is None:
        return opportunities

    soup = BeautifulSoup(resp.text, "lxml")

    # BNDES portal is a WebSphere/Portal app; try common patterns.
    cards = soup.select(
        "div.chamada, div.card, article, li.item-chamada, "
        "div.portlet-body li, table tbody tr"
    )

    for card in cards:
        title_tag = card.select_one("h2, h3, h4, a, strong")
        title = clean(title_tag.get_text()) if title_tag else ""
        if not title:
            continue

        link_tag = card.select_one("a")
        link = link_tag.get("href", "") if link_tag else ""
        if link and not link.startswith("http"):
            link = "https://www.bndes.gov.br" + link

        desc_tag = card.select_one("p, span.descricao, td:nth-child(2)")
        description = clean(desc_tag.get_text()) if desc_tag else ""

        opportunities.append(
            {"source": source, "title": title, "description": description, "url": link}
        )

    log.info("  %d opportunities found on %s", len(opportunities), source)
    return opportunities


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    today = date.today().isoformat()  # e.g. "2026-04-14"
    output_path = DATA_DIR / f"{today}.json"

    all_opportunities: list[dict] = []
    all_opportunities.extend(scrape_govbr())
    all_opportunities.extend(scrape_finep())
    all_opportunities.extend(scrape_bndes())

    # Add run metadata to each record
    for opp in all_opportunities:
        opp["scraped_date"] = today

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(all_opportunities, f, ensure_ascii=False, indent=2)

    log.info(
        "Done. %d total opportunities saved to %s",
        len(all_opportunities),
        output_path,
    )


if __name__ == "__main__":
    main()
