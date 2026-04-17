# Edital Radar

An automated newsletter that monitors Brazilian public funding opportunities — **editais**, **financiamentos**, and **chamadas públicas** — and delivers weekly digests to subscribers.

## What it does

Edital Radar scrapes multiple official Brazilian government and development-bank sources on a recurring schedule, consolidates the opportunities into structured data, and generates a curated newsletter digest ready to send to subscribers.

## Folder structure

```
edital-radar/
├── data/          # Raw scraped data (JSON, one file per run date)
├── processed/     # Cleaned and structured opportunity records
├── newsletter/    # Generated newsletter drafts (HTML / Markdown)
└── scripts/       # Automation scripts
```

## Sources monitored

| Source | What is scraped |
|--------|-----------------|
| [gov.br](https://www.gov.br/pt-br/noticias) | News filtered for editais and chamadas |
| [FINEP](https://www.finep.gov.br/chamadas-publicas) | Open public calls for innovation funding |
| [BNDES](https://www.bndes.gov.br) | Open calls and financing programs |

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/scraper.py` | Fetches opportunities from all sources and saves raw JSON to `/data` |

## Getting started

### Requirements

```bash
pip install requests beautifulsoup4 lxml
```

### Run the scraper

```bash
python scripts/scraper.py
```

Output is saved to `data/YYYY-MM-DD.json`.

## Roadmap

- [ ] Deduplication and normalization pipeline (`processed/`)
- [ ] Newsletter template and renderer (`newsletter/`)
- [ ] Scheduler (cron / GitHub Actions)
- [ ] Subscriber delivery via email (SendGrid / SES)
