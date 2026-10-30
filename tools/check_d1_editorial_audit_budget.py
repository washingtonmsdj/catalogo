#!/usr/bin/env python3
"""Fail-closed D1 consumption gate for optional production editorial audits.

Uses Cloudflare account analytics (not a D1 query), reserves nearly the entire
free-tier daily allowance for visitors, and prevents repeatedly launching costly
full-catalog read-only inventory jobs after usage has climbed.
"""
from __future__ import annotations

import datetime as dt
import json
import os

from audit_external_source_coverage import CoverageError, fetch_json

DAILY_FREE_ROWS = 5_000_000
MAX_EXISTING_READS_BEFORE_EDITORIAL_AUDIT = 250_000
ANALYTICS_API = "https://api.cloudflare.com/client/v4/graphql"


def analytics_query(account_id: str, date: str) -> str:
    if len(account_id) != 32 or any(ch not in "0123456789abcdef" for ch in account_id):
        raise CoverageError("Cloudflare account ID invalid")
    dt.date.fromisoformat(date)
    return (
        "query {viewer{accounts(filter:{accountTag:\"" + account_id + "\"}){"
        "d1AnalyticsAdaptiveGroups(limit:100,"
        "filter:{date_geq:\"" + date + "\",date_leq:\"" + date + "\"}){"
        "dimensions{databaseId date}sum{rowsRead}}}}}"
    )


def rows_read_for_account(payload: object, date: str) -> int:
    if not isinstance(payload, dict) or payload.get("errors"):
        raise CoverageError("D1 analytics unavailable or incomplete")
    data = payload.get("data")
    viewer = data.get("viewer") if isinstance(data, dict) else None
    accounts = viewer.get("accounts") if isinstance(viewer, dict) else None
    if not isinstance(accounts, list) or len(accounts) != 1:
        raise CoverageError("D1 analytics account scope invalid")
    groups = accounts[0].get("d1AnalyticsAdaptiveGroups") if isinstance(accounts[0], dict) else None
    if not isinstance(groups, list) or len(groups) >= 100:
        raise CoverageError("D1 analytics absent or truncated")
    total = 0
    for group in groups:
        dims = group.get("dimensions") if isinstance(group, dict) else None
        summation = group.get("sum") if isinstance(group, dict) else None
        rows = summation.get("rowsRead") if isinstance(summation, dict) else None
        if not isinstance(dims, dict) or dims.get("date") != date or not isinstance(dims.get("databaseId"), str):
            raise CoverageError("D1 analytics wrong date or database")
        if isinstance(rows, bool) or not isinstance(rows, int) or rows < 0:
            raise CoverageError("D1 analytics invalid rowsRead")
        total += rows
    return total


def require_audit_budget(account_id: str, token: str, date: str) -> int:
    payload, _ = fetch_json(ANALYTICS_API, token=token, body={"query": analytics_query(account_id, date)})
    rows = rows_read_for_account(payload, date)
    if rows > MAX_EXISTING_READS_BEFORE_EDITORIAL_AUDIT:
        raise CoverageError(
            f"Editorial D1 audit blocked: {rows} rows read today (UTC), "
            f"threshold {MAX_EXISTING_READS_BEFORE_EDITORIAL_AUDIT}; "
            "reserve free D1 quota for public catalog. Do not retry."
        )
    return rows


def main() -> None:
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    rows = require_audit_budget(account, token, today)
    print(json.dumps({
        "auditPermitted": True,
        "utcDate": today,
        "accountRowsRead": rows,
        "maxRowsBeforeOptionalAudit": MAX_EXISTING_READS_BEFORE_EDITORIAL_AUDIT,
        "freeDailyRows": DAILY_FREE_ROWS,
        "productionWrites": 0,
    }))


if __name__ == "__main__":
    main()
