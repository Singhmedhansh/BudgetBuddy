import os

# Basic Flask config
class Config:
    # SECRET_KEY is required for session cookies and Flask-WTF CSRF protection.
    # For local dev a default is provided, but override in production via the
    # BUDGETBUDDY_SECRET environment variable (or set SECRET_KEY).
    SECRET_KEY = os.environ.get("BUDGETBUDDY_SECRET") or os.environ.get("SECRET_KEY") or "dev-secret-change-me"

    # SQLite DB file in project root by default
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL") or "sqlite:///budget.db"
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Flask-WTF / CSRF
    WTF_CSRF_ENABLED = True

    # Pagination / UI options
    ITEMS_PER_PAGE = int(os.environ.get("ITEMS_PER_PAGE", 20))

    # Currency and locale settings (used by templates / JS)
    CURRENCY_CODE = os.environ.get("CURRENCY_CODE", "INR")
    CURRENCY_SYMBOL = os.environ.get("CURRENCY_SYMBOL", "₹")
    LOCALE = os.environ.get("LOCALE", "en-IN")

    # Budget alert thresholds
    ALERT_NEAR_THRESHOLD = float(os.environ.get("ALERT_NEAR_THRESHOLD", 0.8))  # 80%
    ALERT_OVER_THRESHOLD = float(os.environ.get("ALERT_OVER_THRESHOLD", 1.0))  # 100%

    # Demo user creation toggle for init_db.py
    CREATE_DEMO_USER = os.environ.get("CREATE_DEMO_USER", "1") in ("1", "true", "True", "yes", "on")

# Convenience alias for easy import
config = Config()