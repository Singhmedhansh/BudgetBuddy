/**
 * Help Centre content. Articles describe only what Budget Buddy does today; when
 * a module ships, its article is added in the same change. Inline links use
 * [label](/internal/path) and are rendered as internal links only.
 */
export type Block =
  | { t: "p"; text: string }
  | { t: "steps"; items: string[] }
  | { t: "list"; items: string[] }
  | { t: "note"; text: string };

export interface Article {
  slug: string;
  title: string;
  category: CategoryId;
  summary: string;
  keywords: string[];
  body: Block[];
  /** App destination that does what the article describes. */
  destination?: { label: string; href: string };
  related?: string[];
}

export type CategoryId = "getting-started" | "accounts" | "transactions" | "budgets" | "numbers" | "security";

export const CATEGORIES: { id: CategoryId; title: string; blurb: string }[] = [
  { id: "getting-started", title: "Getting started", blurb: "Set up your first account, transaction and budget." },
  { id: "accounts", title: "Accounts", blurb: "Where your money is kept, and what the balances mean." },
  { id: "transactions", title: "Transactions", blurb: "Record, find, transfer and reverse." },
  { id: "budgets", title: "Budgets", blurb: "Monthly limits, alerts and rollover." },
  { id: "numbers", title: "Understanding your numbers", blurb: "How each figure on your dashboard is worked out." },
  { id: "security", title: "Account and security", blurb: "Passwords, sessions, themes and contacting support." },
];

export const ARTICLES: Article[] = [
  {
    slug: "getting-started",
    title: "Set up Budget Buddy in a few minutes",
    category: "getting-started",
    summary: "The shortest path from a new account to a working dashboard.",
    keywords: ["start", "begin", "setup", "first", "onboarding", "new"],
    destination: { label: "Open the dashboard", href: "/app" },
    related: ["add-an-account", "record-a-transaction", "create-a-budget"],
    body: [
      { t: "p", text: "After you sign up, setup asks two short questions and then lets you add your first account. You can skip the account step and come back to it, and setup resumes where you left off if you close the page." },
      {
        t: "steps",
        items: [
          "Choose the profile that fits you best. This only picks your starting categories; nothing is locked to it.",
          "Choose your currency and timezone. Your timezone decides which transactions belong to which day and month.",
          "Add an account and enter its balance as it is today.",
          "Record a transaction from [Add transaction](/app/transactions/new).",
          "Create a monthly budget from [Budgets](/app/budgets/new).",
        ],
      },
      { t: "note", text: "Budget Buddy does not connect to your bank. Balances come from what you enter and the transactions you record." },
    ],
  },
  {
    slug: "add-an-account",
    title: "Add an account",
    category: "accounts",
    summary: "Create a bank account, cash, wallet or card and enter its starting balance.",
    keywords: ["account", "bank", "wallet", "cash", "card", "credit card", "balance", "opening balance", "savings"],
    destination: { label: "Add an account", href: "/app/accounts/new" },
    related: ["balances-explained", "transfers-and-card-repayments"],
    body: [
      { t: "steps", items: ["Open [Accounts](/app/accounts) and choose Add account.", "Name it and choose a type.", "Enter the balance as it is today. For a credit card or loan, enter the amount you owe as a positive number."] },
      { t: "p", text: "Accounts are grouped into money you hold and money you owe. Credit cards and other liabilities count against your net worth." },
      { t: "note", text: "The starting balance is recorded as an opening balance. It is not income, so it does not change your income for the month." },
    ],
  },
  {
    slug: "balances-explained",
    title: "What an account balance means",
    category: "accounts",
    summary: "Balances are calculated from your records and are not live bank balances.",
    keywords: ["balance", "bank balance", "live", "reconcile", "wrong balance", "mismatch", "doesn't match"],
    related: ["add-an-account", "reverse-a-transaction"],
    body: [
      { t: "p", text: "An account balance is the opening balance you entered plus every posted transaction since. Budget Buddy never reads your bank, so a balance here can differ from your bank if something has not been recorded yet." },
      { t: "list", items: ["Check that every recent transaction is recorded in [Transactions](/app/transactions).", "Check transfers: both accounts must be recorded, from one account to the other.", "If a transaction was recorded wrongly, reverse it and record it again."] },
    ],
  },
  {
    slug: "record-a-transaction",
    title: "Record an expense or income",
    category: "transactions",
    summary: "Add a transaction in a few taps, with a category, account and date.",
    keywords: ["add", "record", "expense", "income", "spend", "salary", "new transaction", "enter"],
    destination: { label: "Add a transaction", href: "/app/transactions/new" },
    related: ["transfers-and-card-repayments", "reverse-a-transaction", "find-spending"],
    body: [
      { t: "steps", items: ["Choose Add transaction from the menu.", "Pick expense or income, enter the amount, and choose the account and category.", "Choose the date. Today or earlier is allowed.", "Save."] },
      { t: "p", text: "Amounts use your currency's decimals, so 250.50 is valid for rupees and 250.555 is rejected instead of being rounded silently." },
      { t: "note", text: "Dates in the future are not accepted for posted transactions." },
    ],
  },
  {
    slug: "transfers-and-card-repayments",
    title: "Transfers and credit card repayments",
    category: "transactions",
    summary: "Moving money between your own accounts is not spending.",
    keywords: ["transfer", "move money", "credit card payment", "repay", "repayment", "pay card", "between accounts", "double count"],
    related: ["how-totals-work", "record-a-transaction"],
    body: [
      { t: "p", text: "A transfer moves money from one of your accounts to another. It changes both balances but is not income or spending, so your monthly totals stay correct." },
      { t: "p", text: "A credit card purchase counts as spending on the day you make it. Paying the card from your bank is a transfer from the bank to the card, so the same money is not counted twice." },
      { t: "steps", items: ["Choose Add transaction and select Transfer.", "Pick the account the money leaves and the account it goes to.", "For a card repayment, the card is the account it goes to."] },
    ],
  },
  {
    slug: "reverse-a-transaction",
    title: "Reverse a transaction",
    category: "transactions",
    summary: "Posted transactions are never deleted. Reversing adds an offsetting entry.",
    keywords: ["delete", "undo", "remove", "mistake", "wrong", "reverse", "cancel", "edit", "correct"],
    destination: { label: "Go to Transactions", href: "/app/transactions" },
    related: ["record-a-transaction", "balances-explained"],
    body: [
      { t: "p", text: "To keep your history trustworthy, a recorded transaction cannot be deleted or have its amount changed. If you made a mistake, reverse it and record the correct one." },
      { t: "steps", items: ["Open [Transactions](/app/transactions).", "Choose Reverse next to the transaction.", "Record the correct transaction if there is one."] },
      { t: "p", text: "The original stays in the list, marked Reversed, and a reversal entry offsets it. Balances, budgets and totals are corrected; a transaction can be reversed once." },
    ],
  },
  {
    slug: "find-spending",
    title: "Find your spending on a category or merchant",
    category: "transactions",
    summary: "Use search and filters to see grocery spending or any other category.",
    keywords: ["grocery", "groceries", "see spending", "category spending", "search", "filter", "find transaction", "merchant", "how much did i spend"],
    destination: { label: "Search transactions", href: "/app/transactions" },
    related: ["how-totals-work", "create-a-budget"],
    body: [
      { t: "steps", items: ["Open [Transactions](/app/transactions).", "Type a merchant or note in Search, or pick a type or account.", "To see one category, such as Groceries, choose it in the Category filter and press Apply."] },
      { t: "p", text: "Your budget page also shows how much you have spent in each budgeted category this month." },
    ],
  },
  {
    slug: "create-a-budget",
    title: "Create a monthly budget",
    category: "budgets",
    summary: "Set a limit for each category and watch what is left.",
    keywords: ["budget", "limit", "monthly", "plan", "allocate", "category limit", "set budget", "alerts", "warning"],
    destination: { label: "Create a budget", href: "/app/budgets/new" },
    related: ["how-budgets-work", "budget-rollover"],
    body: [
      { t: "steps", items: ["Open [Budgets](/app/budgets/new) and choose Create budget.", "Enter a monthly limit for each category you want to watch. Leave others blank.", "Set the percentage at which you want to be warned. The default is 80%.", "Save."] },
      { t: "p", text: "Warnings and over-budget amounts appear on the Budgets page and in Budget watch on your dashboard." },
    ],
  },
  {
    slug: "how-budgets-work",
    title: "How budget figures are calculated",
    category: "budgets",
    summary: "Limit, spent, remaining and over-budget, defined.",
    keywords: ["remaining", "spent", "over budget", "calculation", "how calculated", "percentage", "used", "left"],
    related: ["create-a-budget", "budget-rollover"],
    body: [
      { t: "list", items: ["Limit: the monthly amount you set for the category, plus anything carried from last month if rollover is on.", "Spent: posted expenses in the month minus refunds. Reversed transactions net to zero.", "Remaining: limit minus spent.", "Over by: how far spent is above the limit.", "Used: spent as a percentage of the limit. At or above your warning percentage the category shows a warning; above 100% it shows as over."] },
      { t: "note", text: "Months follow your timezone. A purchase just after midnight in your timezone belongs to the new month, even if it is still the previous day elsewhere." },
    ],
  },
  {
    slug: "budget-rollover",
    title: "Rollover: carrying unspent budget forward",
    category: "budgets",
    summary: "What carries over, and what does not.",
    keywords: ["rollover", "carry over", "carry forward", "unspent", "leftover", "next month"],
    related: ["how-budgets-work"],
    body: [
      { t: "p", text: "With rollover on, whatever you did not spend in a category last month is added to its limit this month. Overspending does not reduce next month." },
      { t: "list", items: ["Only last month carries forward; amounts do not pile up across several months.", "A budget carries nothing in the month it is created.", "Last month's limit is taken to be the current limit."] },
    ],
  },
  {
    slug: "how-totals-work",
    title: "How the dashboard figures are worked out",
    category: "numbers",
    summary: "Net worth, money you hold, income and spending.",
    keywords: ["net worth", "income", "spending", "dashboard", "total", "money you hold", "calculation", "why", "number"],
    destination: { label: "Open the dashboard", href: "/app" },
    related: ["transfers-and-card-repayments", "balances-explained"],
    body: [
      { t: "list", items: ["Money you hold: the total of your asset accounts.", "Net worth: money you hold minus what you owe on cards and loans.", "Income this month: income actually recorded as received, not expected income.", "Spending this month: expenses minus refunds. Transfers, repayments and opening balances are never counted."] },
    ],
  },
  {
    slug: "reset-your-password",
    title: "Reset a forgotten password",
    category: "security",
    summary: "Request a link, choose a new password, and what to do if the link has expired.",
    keywords: ["password", "forgot", "reset", "recover", "locked out", "link expired", "can't log in", "login"],
    destination: { label: "Reset your password", href: "/forgot-password" },
    related: ["account-security"],
    body: [
      { t: "steps", items: ["Open [Reset your password](/forgot-password) and enter your email.", "Open the link we send. It works once and expires after an hour.", "Choose a new password of at least 10 characters.", "Other devices are signed out when you save."] },
      { t: "p", text: "For privacy we show the same message whether or not an account exists for that address. If the link says it has expired, request a new one." },
    ],
  },
  {
    slug: "account-security",
    title: "Keeping your account secure",
    category: "security",
    summary: "Passwords, sessions and who can see your data.",
    keywords: ["security", "privacy", "safe", "session", "log out", "logout", "who can see", "data"],
    destination: { label: "Security and privacy", href: "/security" },
    related: ["reset-your-password"],
    body: [
      { t: "list", items: ["Use a password you do not use anywhere else. The sign-up form shows how strong it is.", "Log out from the menu at the top right, especially on shared devices.", "Your data is protected by access rules in the database, not only by the screens you see.", "Card details never reach Budget Buddy."] },
    ],
  },
  {
    slug: "light-and-dark-theme",
    title: "Switch between light and dark theme",
    category: "security",
    summary: "Choose light, dark, or follow your device.",
    keywords: ["dark mode", "dark theme", "light theme", "appearance", "theme", "night"],
    body: [{ t: "p", text: "Use the three buttons next to your name at the top of any page: light, match device, or dark. Light is the default and your choice is remembered on this device." }],
  },
  {
    slug: "contact-support",
    title: "Contact support",
    category: "security",
    summary: "Send a message and get a reference number.",
    keywords: ["contact", "support", "help", "problem", "bug", "report", "email us", "ticket"],
    destination: { label: "Contact support", href: "/contact" },
    related: ["account-security"],
    body: [
      { t: "p", text: "Use the [contact form](/contact). Pick a topic, describe what happened and what you expected, and we give you a reference number straight away. Signed-in users can also attach a screenshot." },
      { t: "note", text: "Never include your password or full card number in a message." },
    ],
  },
];

export const bySlug = (slug: string) => ARTICLES.find((a) => a.slug === slug);

/** Places in the app a search can send people to. Only routes that exist. */
export interface Destination {
  label: string;
  href: string;
  description: string;
  keywords: string[];
}

export const DESTINATIONS: Destination[] = [
  { label: "Dashboard", href: "/app", description: "Net worth, this month's income and spending, budget watch.", keywords: ["dashboard", "overview", "net worth", "home", "summary"] },
  { label: "Transactions", href: "/app/transactions", description: "Search, filter and reverse recorded transactions.", keywords: ["transactions", "history", "search", "find", "spending", "expenses", "reverse"] },
  { label: "Add transaction", href: "/app/transactions/new", description: "Record an expense, income or transfer.", keywords: ["add", "record", "new transaction", "expense", "income", "transfer"] },
  { label: "Accounts", href: "/app/accounts", description: "Balances for money you hold and money you owe.", keywords: ["accounts", "balance", "bank", "wallet", "card", "cash"] },
  { label: "Add account", href: "/app/accounts/new", description: "Create an account with its starting balance.", keywords: ["add account", "new account", "opening balance"] },
  { label: "Budgets", href: "/app/budgets", description: "Monthly limits, what is left, and warnings.", keywords: ["budget", "budgets", "limit", "remaining", "over budget"] },
  { label: "Create budget", href: "/app/budgets/new", description: "Set monthly limits per category.", keywords: ["create budget", "new budget", "set limit"] },
  { label: "Contact support", href: "/contact", description: "Send us a message and get a reference number.", keywords: ["contact", "support", "help me", "report"] },
];
