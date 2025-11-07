from collections import defaultdict, OrderedDict
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Dict, Tuple
import calendar

from models import Transaction, Budget
from config import config

def month_range(year: int, month: int) -> Tuple[date, date]:
    """
    Return (start_date, end_date) for the given year and month.
    start_date is the first day, end_date is the last day of the month.
    """
    start = date(year, month, 1)
    last_day = calendar.monthrange(year, month)[1]
    end = date(year, month, last_day)
    return start, end

def daterange(start_date: date, end_date: date):
    """Yield dates from start_date to end_date inclusive."""
    for n in range((end_date - start_date).days + 1):
        yield start_date + timedelta(n)

def round_two(value) -> float:
    """Round a numeric value to 2 decimal places (bankers style)."""
    try:
        d = Decimal(str(value))
        return float(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    except Exception:
        return 0.0

def compute_daily_totals(transactions: List[Transaction], start_date: date, end_date: date) -> Tuple[List[str], List[float]]:
    """
    Given a list of Transaction objects and a date range, return two lists:
    - labels: list of ISO date strings for every day in the range
    - values: list of daily spend totals (floats rounded to 2dp), aligned with labels
    """
    totals = defaultdict(float)
    for tx in transactions:
        if tx.date is None:
            continue
        if start_date <= tx.date <= end_date:
            totals[tx.date] += float(tx.amount)

    labels = []
    values = []
    for d in daterange(start_date, end_date):
        labels.append(d.isoformat())
        values.append(round_two(totals.get(d, 0.0)))
    return labels, values

def compute_category_totals(transactions: List[Transaction]) -> Tuple[List[str], List[float]]:
    """
    Aggregate transactions by category and return parallel lists:
    - categories (labels)
    - totals (floats rounded to 2dp)
    Categories with zero total are excluded.
    """
    cat_totals = defaultdict(float)
    for tx in transactions:
        key = tx.category or "Uncategorized"
        cat_totals[key] += float(tx.amount)

    # Sort categories by descending spend for clearer charts
    sorted_items = sorted(cat_totals.items(), key=lambda kv: kv[1], reverse=True)
    labels = [k for k, v in sorted_items if round_two(v) != 0.0]
    values = [round_two(v) for k, v in sorted_items if round_two(v) != 0.0]
    return labels, values

def build_budget_spent_arrays(budgets: List[Budget], category_totals: Dict[str, float]) -> Tuple[List[str], List[float], List[float]]:
    """
    Given Budget objects and a mapping of category -> spent amount,
    return (categories, budget_amounts_list, spent_amounts_list) aligned by categories.
    Categories present in either budgets or spent will be included.
    """
    cats = OrderedDict()
    for b in budgets:
        cats[b.category] = {"budget": float(b.amount), "spent": 0.0}
    # include categories present only in spent totals
    for cat, spent in category_totals.items():
        if cat not in cats:
            cats[cat] = {"budget": 0.0, "spent": 0.0}
        cats[cat]["spent"] = float(spent)

    categories = list(cats.keys())
    budgets_list = [round_two(cats[c]["budget"]) for c in categories]
    spent_list = [round_two(cats[c]["spent"]) for c in categories]
    return categories, budgets_list, spent_list

def compute_alerts(budgets: List[Budget], category_totals: Dict[str, float], near_threshold: float = None, over_threshold: float = None) -> List[Dict]:
    """
    Compute alerts comparing spent amounts to budgets.
    Returns a list of alert dicts:
      {
        "category": str,
        "spent": float,
        "budget": float,
        "pct": float,   # spent / budget (or None if no budget)
        "status": "ok" | "near" | "over"
      }

    Uses thresholds from config by default.
    """
    if near_threshold is None:
        near_threshold = config.ALERT_NEAR_THRESHOLD
    if over_threshold is None:
        over_threshold = config.ALERT_OVER_THRESHOLD

    # Map budgets by category for quick lookup
    budget_map = {b.category: float(b.amount) for b in budgets}
    alerts = []
    for cat, spent in category_totals.items():
        budget_amt = budget_map.get(cat, 0.0)
        pct = None
        status = "ok"
        if budget_amt and budget_amt > 0:
            pct = float(spent) / float(budget_amt)
            if pct >= over_threshold:
                status = "over"
            elif pct >= near_threshold:
                status = "near"
        alerts.append(
            {
                "category": cat,
                "spent": round_two(spent),
                "budget": round_two(budget_amt),
                "pct": round_two(pct * 100) if pct is not None else None,
                "status": status,
            }
        )
    # Optionally sort so 'over' alerts come first, then 'near'
    status_order = {"over": 0, "near": 1, "ok": 2}
    alerts.sort(key=lambda a: (status_order.get(a["status"], 3), -a["spent"]))
    return alerts

def transactions_to_category_totals_map(transactions: List[Transaction]) -> Dict[str, float]:
    """Return a dict mapping category -> total spent (float)."""
    totals = defaultdict(float)
    for tx in transactions:
        key = tx.category or "Uncategorized"
        totals[key] += float(tx.amount)
    return {k: round_two(v) for k, v in totals.items()}

def safe_iso_date(obj):
    """Convert date/datetime to ISO date string or return None."""
    if obj is None:
        return None
    if isinstance(obj, datetime):
        return obj.date().isoformat()
    if isinstance(obj, date):
        return obj.isoformat()
    return None