# BudgetBuddy (Phase 1)
# BudgetBuddy — Personal Finance (Codespaces-ready)

This repository contains the skeleton for the BudgetBuddy personal finance project.

This README includes steps to push the project to GitHub and open it in GitHub Codespaces.

Quick summary:

- A devcontainer is provided at `.devcontainer/devcontainer.json` using the official Python devcontainer image.
- The container forwards port 5000 (useful if this is a Flask app).
- On container creation it will install dependencies from `requirements.txt` if present.

How to push this project to GitHub (PowerShell)

1. Initialize git (if you haven't already), commit, and create a GitHub repo.

```powershell
cd C:\Users\singh\Downloads\BudgetBuddy
git init
git add --all
git commit -m "Initial BudgetBuddy structure"
```

2a. Create and push a new repository using GitHub CLI (recommended if you have gh installed):

```powershell
gh repo create <your-username>/BudgetBuddy --public --source=. --remote=origin --push
```

2b. Or create a repo on github.com and then push manually:

```powershell
# replace <your-remote-url> with the GitHub HTTPS/SSH URL
git remote add origin <your-remote-url>
git branch -M main
git push -u origin main
```

Opening in Codespaces

- On GitHub, open your repository page and click the green "Code" button, then the "Codespaces" tab to create a new Codespace.
- GitHub will detect the `.devcontainer` folder and open the repository inside the configured container.

Tip: if you prefer to develop locally in a reproducible devcontainer, you can open the folder in VS Code and use "Remote-Containers: Reopen in Container" (requires VS Code + Remote - Containers extension).

Next steps I can help with:

- Create a basic Flask app skeleton in `app.py` and a minimal `requirements.txt`
- Add unit tests and a GitHub Actions workflow
- Configure Codespaces prebuilds to speed up Codespace creation

Tell me which of these you'd like me to do next and whether you want me to create the GitHub repository for you (I can prepare the remote and push if you give the repo name or allow me to name it). 

A simple local budgeting web app (Flask + SQLite) for manually tracking transactions, monthly budgets, and savings goals. This Phase 1 scaffold implements:

- Local authentication (register / login / logout) using Flask-Login and Flask-WTF.
- Create / Read / Update / Delete (CRUD) for Transactions, Budgets, and Goals.
- Dashboard with clear INR-formatted charts (Chart.js) and server-side computed alerts:
  - "Near" budget when spent >= 80%
  - "Over" budget when spent >= 100%
- Minimal JavaScript: Chart.js + tiny helpers. All forms work with server-side POST + redirect and CSRF protection via Flask-WTF.
- Demo user seeded by init_db.py for quick local testing.

This repository is intended to run entirely on your local machine (localhost). No external/paid services are required.

Demo user (for local testing)
- username: `demo`
- email: `demo@example.com`
- password: `demo`

Security note: The demo user is for local development only. Change or remove the demo user before exposing the app to any network you do not trust.

Quick setup (development)
1. Create and activate a virtual environment (Python 3.8+ recommended)
   - macOS / Linux:
     - python -m venv .venv
     - source .venv/bin/activate
   - Windows (PowerShell):
     - python -m venv .venv
     - .\.venv\Scripts\Activate.ps1

2. Install dependencies
   - pip install -r requirements.txt

3. Initialize the database and seed demo data
   - python init_db.py
   This will create a local `budget.db` file and add a `demo` user and sample data if no users exist.

4. Run the application
   - python app.py
   - Open: http://127.0.0.1:5000

5. Log in using the demo user (username: `demo`, password: `demo`) or register a new account.

Testing
- Tests use pytest and an in-memory SQLite database.
- Run tests:
  - pytest -q

Configuration
- config.py contains configuration values.
  - SECRET_KEY is required for CSRF and session security. For local testing, a default is provided; for any public deployment replace it with a secure random value and set via environment variables.
  - SQLALCHEMY_DATABASE_URI defaults to `sqlite:///budget.db`. You can override via environment variables if needed.

Key design decisions
- All data is associated with a user (no anonymous data).
- Currency/formatting: INR (₹). Chart tooltips and number formatting use `en-IN` locale where available.
- Minimal JS: Chart.js is the only required external JS library. All functional flows work without JavaScript (server-rendered forms + POST/redirect/flash).
- CSRF protection is enforced via Flask-WTF on all forms.

What files you will find (Phase 1)
- app.py — Flask application and routes
- models.py — SQLAlchemy models (User, Transaction, Budget, Goal)
- forms.py — Flask-WTF form classes and validators
- utils.py — utility helpers (date ranges, alert computation, rounding)
- init_db.py — initialize DB and optional seeding (demo user + sample data)
- templates/ — Jinja2 templates (layout, register, login, index, budgets, goals, dashboard, transactions list, edit pages)
- static/style.css — primary styling (desktop-first, modern)
- static/main.js — tiny JS helpers (set today on date input, optional helpers)
- tests/ — pytest tests
- requirements.txt — Python dependencies
- .gitignore

Operational notes & next steps
- The app intentionally uses server-side rendering and Flask-WTF for robust CSRF and server-side validation. Chart.js is used only to visualize server-provided datasets on the dashboard.
- As you begin, consider editing `config.py` to set a stronger SECRET_KEY for your environment and change the demo user password.
- If you later want migrations support, we can add Flask-Migrate / Alembic in Phase 2.

If you're ready, I'll start producing the actual Phase 1 files one at a time. I will begin with `requirements.txt` next (listing exact packages for this phase), then `config.py`, then `models.py`, etc. Say "proceed" and I'll output `requirements.txt` now.