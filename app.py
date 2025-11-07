import json
from datetime import datetime, date
from flask import Flask, render_template, redirect, url_for, flash, request, abort, jsonify
from flask_login import LoginManager, login_user, logout_user, current_user, login_required
from werkzeug.urls import url_parse

from config import config
from models import db, User, Transaction, Budget, Goal
from forms import RegistrationForm, LoginForm, TransactionForm, EditTransactionForm, BudgetForm, GoalForm
from utils import (
    month_range,
    compute_daily_totals,
    compute_category_totals,
    transactions_to_category_totals_map,
    build_budget_spent_arrays,
    compute_alerts,
    safe_iso_date,
    round_two,
)

def create_app():
    app = Flask(__name__)
    app.config.from_object(config)

    # Initialize extensions
    db.init_app(app)
    login_manager = LoginManager()
    login_manager.login_view = "login"
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return User.query.get(int(user_id))

    # Context processor: make currency and locale available to templates
    @app.context_processor
    def inject_globals():
        return {
            "CURRENCY_SYMBOL": config.CURRENCY_SYMBOL,
            "CURRENCY_CODE": config.CURRENCY_CODE,
            "LOCALE": config.LOCALE,
        }

    # Home / index - add transaction form
    @app.route("/", methods=["GET", "POST"])
    @login_required
    def index():
        form = TransactionForm()
        if form.validate_on_submit():
            tx = Transaction(
                amount=float(form.amount.data),
                date=form.date.data,
                category=form.category.data.strip(),
                merchant=form.merchant.data.strip() if form.merchant.data else None,
                notes=form.notes.data.strip() if form.notes.data else None,
                user_id=current_user.id,
            )
            db.session.add(tx)
            db.session.commit()
            flash("Transaction added.", "success")
            return redirect(url_for("index"))
        # recent transactions for sidebar
        recent = (
            Transaction.query.filter_by(user_id=current_user.id)
            .order_by(Transaction.date.desc(), Transaction.created_at.desc())
            .limit(10)
            .all()
        )
        return render_template("index.html", form=form, recent=recent)

    # Registration
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        form = RegistrationForm()
        if form.validate_on_submit():
            user = User(username=form.username.data.strip(), email=form.email.data.strip() if form.email.data else None)
            user.set_password(form.password.data)
            db.session.add(user)
            db.session.commit()
            login_user(user)
            flash("Registration successful. You are now logged in.", "success")
            return redirect(url_for("index"))
        return render_template("register.html", form=form)

    # Login
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        form = LoginForm()
        if form.validate_on_submit():
            identifier = form.username_or_email.data.strip()
            # find by username or email
            user = User.query.filter((User.username == identifier) | (User.email == identifier)).first()
            if user is None or not user.check_password(form.password.data):
                flash("Invalid username/email or password.", "danger")
                return render_template("login.html", form=form)
            login_user(user, remember=form.remember_me.data)
            flash("Logged in successfully.", "success")
            next_page = request.args.get("next")
            if not next_page or url_parse(next_page).netloc != "":
                next_page = url_for("index")
            return redirect(next_page)
        return render_template("login.html", form=form)

    @app.route("/logout")
    @login_required
    def logout():
        logout_user()
        flash("You have been logged out.", "info")
        return redirect(url_for("login"))

    # Transactions list (with simple filters)
    @app.route("/transactions")
    @login_required
    def transactions_list():
        page = int(request.args.get("page", 1))
        per_page = app.config.get("ITEMS_PER_PAGE", 20)
        q = Transaction.query.filter_by(user_id=current_user.id).order_by(Transaction.date.desc(), Transaction.created_at.desc())
        # optional filters
        cat = request.args.get("category")
        if cat:
            q = q.filter(Transaction.category == cat)
        # date range filters
        date_from = request.args.get("from")
        date_to = request.args.get("to")
        if date_from:
            try:
                df = datetime.strptime(date_from, "%Y-%m-%d").date()
                q = q.filter(Transaction.date >= df)
            except Exception:
                pass
        if date_to:
            try:
                dt = datetime.strptime(date_to, "%Y-%m-%d").date()
                q = q.filter(Transaction.date <= dt)
            except Exception:
                pass
        pagination = q.paginate(page=page, per_page=per_page, error_out=False)
        return render_template("transactions_list.html", pagination=pagination, transactions=pagination.items)

    # Edit transaction
    @app.route("/transactions/<int:tx_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_transaction(tx_id):
        tx = Transaction.query.get_or_404(tx_id)
        if tx.user_id != current_user.id:
            abort(403)
        form = EditTransactionForm(obj=tx)
        if form.validate_on_submit():
            tx.amount = float(form.amount.data)
            tx.date = form.date.data
            tx.category = form.category.data.strip()
            tx.merchant = form.merchant.data.strip() if form.merchant.data else None
            tx.notes = form.notes.data.strip() if form.notes.data else None
            db.session.commit()
            flash("Transaction updated.", "success")
            return redirect(url_for("transactions_list"))
        return render_template("edit_transaction.html", form=form, tx=tx)

    @app.route("/transactions/<int:tx_id>/delete", methods=["POST"])
    @login_required
    def delete_transaction(tx_id):
        tx = Transaction.query.get_or_404(tx_id)
        if tx.user_id != current_user.id:
            abort(403)
        db.session.delete(tx)
        db.session.commit()
        flash("Transaction deleted.", "info")
        return redirect(url_for("transactions_list"))

    # Budgets (list + add/update)
    @app.route("/budgets", methods=["GET", "POST"])
    @login_required
    def budgets():
        form = BudgetForm()
        if form.validate_on_submit():
            category = form.category.data.strip()
            amount = float(form.amount.data)
            budget = Budget.query.filter_by(user_id=current_user.id, category=category).first()
            if budget:
                budget.amount = amount
                flash("Budget updated.", "success")
            else:
                budget = Budget(user_id=current_user.id, category=category, amount=amount)
                db.session.add(budget)
                flash("Budget created.", "success")
            db.session.commit()
            return redirect(url_for("budgets"))
        budgets = Budget.query.filter_by(user_id=current_user.id).order_by(Budget.category).all()
        return render_template("budgets.html", form=form, budgets=budgets)

    # Goals (list + create)
    @app.route("/goals", methods=["GET", "POST"])
    @login_required
    def goals():
        form = GoalForm()
        if form.validate_on_submit():
            goal = Goal(
                user_id=current_user.id,
                name=form.name.data.strip(),
                target_amount=float(form.target_amount.data),
                current_amount=float(form.current_amount.data) if form.current_amount.data is not None else 0.0,
            )
            db.session.add(goal)
            db.session.commit()
            flash("Goal created.", "success")
            return redirect(url_for("goals"))
        goals = Goal.query.filter_by(user_id=current_user.id).order_by(Goal.created_at.desc()).all()
        return render_template("goals.html", form=form, goals=goals)

    # Dashboard - main analytics view
    @app.route("/dashboard")
    @login_required
    def dashboard():
        # month/year selection (defaults to current)
        try:
            year = int(request.args.get("year", date.today().year))
            month = int(request.args.get("month", date.today().month))
        except Exception:
            year = date.today().year
            month = date.today().month

        start_date, end_date = month_range(year, month)
        transactions = Transaction.query.filter(
            Transaction.user_id == current_user.id, Transaction.date >= start_date, Transaction.date <= end_date
        ).all()

        # Daily totals for line chart
        daily_labels, daily_values = compute_daily_totals(transactions, start_date, end_date)

        # Category totals for pie/chart
        cat_labels, cat_values = compute_category_totals(transactions)
        cat_map = transactions_to_category_totals_map(transactions)

        # Budgets for user
        budgets_list = Budget.query.filter_by(user_id=current_user.id).all()
        budget_categories, budget_amounts, spent_amounts = build_budget_spent_arrays(budgets_list, cat_map)

        # Alerts
        alerts = compute_alerts(budgets_list, cat_map)

        # Recent transactions
        recent = (
            Transaction.query.filter_by(user_id=current_user.id)
            .order_by(Transaction.date.desc(), Transaction.created_at.desc())
            .limit(10)
            .all()
        )

        # Goals
        goals = Goal.query.filter_by(user_id=current_user.id).order_by(Goal.created_at.desc()).all()

        # Embed data as JSON for Chart.js (templates will use these)
        chart_data = {
            "daily_labels": daily_labels,
            "daily_values": daily_values,
            "cat_labels": cat_labels,
            "cat_values": cat_values,
            "budget_categories": budget_categories,
            "budget_amounts": budget_amounts,
            "spent_amounts": spent_amounts,
            "currency": {"symbol": config.CURRENCY_SYMBOL, "code": config.CURRENCY_CODE, "locale": config.LOCALE},
        }

        return render_template(
            "dashboard.html",
            chart_data=json.dumps(chart_data),
            alerts=alerts,
            recent=recent,
            goals=goals,
            year=year,
            month=month,
            start_date=start_date,
            end_date=end_date,
        )

    # Simple health check / status
    @app.route("/health")
    def health():
        return jsonify(status="ok")

    # Error handlers (basic)
    @app.errorhandler(403)
    def forbidden(e):
        return render_template("403.html"), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template("404.html"), 404

    @app.errorhandler(500)
    def server_error(e):
        return render_template("500.html"), 500

    return app

if __name__ == "__main__":
    application = create_app()
    # Create tables if they don't exist (safe for local dev)
    with application.app_context():
        db.create_all()
    application.run(debug=True)