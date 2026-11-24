import { expect, test, type Page } from "@playwright/test";
import { api, USER, choose, profileTheme, resetTheme } from "./helpers";

/**
 * Settings, account menu, sign-in options, assistant and sample data, on the disposable test user only.
 * Tests that need migration 9 (new profile columns) skip themselves until it is applied to the project.
 */
let migrated = false;
test.beforeAll(async () => {
  const sb = await api();
  const { error } = await sb.from("profiles").select("country,date_format,notification_prefs").limit(1);
  migrated = !error;
});
/** Switch a toggle the way a person does, by its label (the checkbox itself is visually hidden), then check the result. */
async function toggle(page: import("@playwright/test").Page, name: string | RegExp, on: boolean) {
  const box = page.getByLabel(name);
  if ((await box.isChecked()) !== on) await page.locator("label").filter({ hasText: name }).first().click();
  if (on) await expect(box).toBeChecked();
  else await expect(box).not.toBeChecked();
}
const needMigration = () => test.skip(!migrated, "migration 9 is not applied to this project yet");

const SETTINGS_PAGES = ["/app/settings", "/app/settings/preferences", "/app/settings/security", "/app/settings/notifications", "/app/settings/connected", "/app/settings/privacy"];

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test.describe("settings area", () => {
  for (const path of SETTINGS_PAGES) {
    test(`${path} loads inside the settings layout with its navigation`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(400);
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Settings" });
      await expect(nav.getByRole("link")).toHaveCount(7);
      await expect(nav.locator("[aria-current='page']")).toHaveCount(1);
    });
  }

  test("every settings section can be reached from the navigation", async ({ page }) => {
    await open(page, "/app/settings");
    for (const label of ["Preferences", "Security", "Notifications", "Connected accounts", "Data and privacy", "Profile"]) {
      await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: label }).click();
      await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  test("security shows account facts and never a password or token", async ({ page }) => {
    await open(page, "/app/settings/security");
    await expect(page.getByText(USER.email).first()).toBeVisible();
    await expect(page.getByText("Email verified")).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toContain(USER.password);
    expect(body).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // no JWT
  });

  test("changing the password requires the right current password and changes nothing otherwise", async ({ page }) => {
    await open(page, "/app/settings/security");
    await page.getByLabel("Current password").fill("Definitely-Wrong-1!");
    await page.getByLabel("New password", { exact: true }).fill("Another-Strong-Pass-77!");
    await page.getByLabel("Confirm new password").fill("Another-Strong-Pass-77!");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("That password is not correct.")).toBeVisible();
    // the real password still works
    const sb = await api();
    expect((await sb.auth.getUser()).data.user?.email).toBe(USER.email);
  });

  test("a weak or mismatched new password is rejected in plain words", async ({ page }) => {
    await open(page, "/app/settings/security");
    await page.getByLabel("Current password").fill(USER.password);
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("Confirm new password").fill("different");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The passwords do not match.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid input");
  });

  test("connected accounts lists the sign-in method and will not offer to remove the only one", async ({ page }) => {
    await open(page, "/app/settings/connected");
    await expect(page.getByText("Email and password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
    await expect(page.getByText(/only way to sign in/i)).toBeVisible();
  });

  test("notifications explain what is and is not delivered yet, and security notices cannot be turned off", async ({ page }) => {
    await open(page, "/app/settings/notifications");
    await expect(page.getByText(/does not send email or push notifications yet/i)).toBeVisible();
    await expect(page.getByLabel(/Security notices/)).toBeDisabled();
    await expect(page.getByLabel(/Security notices/)).toBeChecked();
    await expect(page.getByLabel(/Budget alerts/)).toBeVisible();
    await expect(page.getByLabel(/Email|SMS|Push|WhatsApp/)).toHaveCount(0); // no controls for channels that do not exist
  });

  test("data and privacy explains deletion before offering it, and a wrong confirmation deletes nothing", async ({ page }) => {
    needMigration(); // the form is deliberately disabled until the deletion functions exist
    await open(page, "/app/settings/privacy");
    await expect(page.getByText("Will be permanently deleted")).toBeVisible();
    await expect(page.getByText(/sign-in identity belongs to the shared account system/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Download all data (JSON)" })).toBeVisible();
    await page.getByLabel("Your password").fill("Definitely-Wrong-1!");
    await page.getByLabel("Type DELETE to confirm").fill("delete");
    await page.getByRole("button", { name: "Permanently delete my account data" }).click();
    await expect(page.getByText("Type DELETE in capitals to confirm.")).toBeVisible();
    // still signed in with data intact
    await page.goto("/app/accounts");
    await expect(page).toHaveURL(/\/app\/accounts/);
  });

  test("deletion refuses a wrong password even with the right confirmation word", async ({ page }) => {
    needMigration(); // the form is deliberately disabled until the deletion functions exist
    await open(page, "/app/settings/privacy");
    await page.getByLabel("Your password").fill("Definitely-Wrong-1!");
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Permanently delete my account data" }).click();
    await expect(page.getByText("That password is not correct.")).toBeVisible();
    await page.goto("/app/accounts");
    await expect(page).toHaveURL(/\/app\/accounts/);
  });
});

test.describe("account menu", () => {
  test("opens, lists every destination, and closes on Escape returning focus to the button", async ({ page }) => {
    await open(page, "/app");
    const button = page.getByRole("button", { name: "Account menu" });
    await button.click();
    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu).toBeVisible();
    for (const name of ["My profile", "Account settings", "Preferences", "Security", "Notifications", "Help Centre", "Sign out"]) {
      await expect(menu.getByRole("menuitem", { name: new RegExp(name) })).toBeVisible();
    }
    await expect(menu.getByText(USER.email).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("arrow keys move through the items and Home and End jump to the ends", async ({ page }) => {
    await open(page, "/app");
    await page.getByRole("button", { name: "Account menu" }).click();
    const items = page.getByRole("menu", { name: "Account" }).getByRole("menuitem");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(items.last()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.first()).toBeFocused(); // wraps
    await page.keyboard.press("ArrowUp");
    await expect(items.last()).toBeFocused();
  });

  test("closes on an outside click and when a link is followed", async ({ page }) => {
    await open(page, "/app");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.mouse.click(300, 600);
    await expect(page.getByRole("menu", { name: "Account" })).toBeHidden();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: /Security/ }).click();
    await expect(page).toHaveURL(/\/app\/settings\/security/);
    await expect(page.getByRole("menu", { name: "Account" })).toBeHidden();
  });

  test("opens from the keyboard with the arrow key", async ({ page }) => {
    await open(page, "/app");
    await page.getByRole("button", { name: "Account menu" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu", { name: "Account" })).toBeVisible();
  });
});

test.describe("sign-in options that are not configured stay hidden", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the login page shows email sign-in and only the providers Supabase reports as enabled", async ({ page, request }) => {
    const settings = await (await request.get(`${process.env.E2E_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.E2E_SUPABASE_KEY! } })).json();
    await open(page, "/login");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    for (const [id, label] of [["google", "Google"], ["github", "GitHub"]] as const) {
      const buttons = page.getByRole("button", { name: new RegExp(`with ${label}`) });
      await expect(buttons).toHaveCount(settings.external[id] ? 1 : 0);
    }
  });

  test("the signup page follows the same rule", async ({ page, request }) => {
    const settings = await (await request.get(`${process.env.E2E_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.E2E_SUPABASE_KEY! } })).json();
    await open(page, "/signup");
    await expect(page.getByRole("button", { name: /with Google/ })).toHaveCount(settings.external.google ? 1 : 0);
  });

  test("a provider failure shows a fixed, friendly sentence and a crafted message is never displayed", async ({ page }) => {
    await page.goto("/login?error=cancelled&provider=github");
    await expect(page.getByRole("alert").filter({ hasText: /cancelled the GitHub sign-in/ })).toBeVisible();
    await page.goto("/login?error=" + encodeURIComponent("Your account is locked, call 555-0100"));
    await expect(page.locator("body")).not.toContainText("call 555-0100");
  });

  test("the magic-link form gives the same answer for any address", async ({ page }) => {
    await open(page, "/login");
    await page.getByRole("button", { name: "Email me a sign-in link instead" }).click();
    await page.getByLabel("Email").last().fill("nobody-here-3@example.test");
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByText(/If an account exists for that address, we sent a sign-in link/)).toBeVisible();
  });

  test("the callback with a bad code returns to login with a fixed message", async ({ page }) => {
    await page.goto("/auth/callback?provider=google&code=not-a-real-code");
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(page.getByRole("alert").filter({ hasText: /expired or was already used/ })).toBeVisible();
  });

  test("settings and the assistant are not reachable signed out", async ({ page }) => {
    for (const path of [...SETTINGS_PAGES, "/app/assistant"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });
});

test.describe("assistant", () => {
  test("is visibly not switched on until credentials exist, and sends nothing", async ({ page }) => {
    await open(page, "/app/assistant");
    await expect(page.getByRole("heading", { name: "Ask Finn", level: 1 })).toBeVisible();
    await expect(page.getByText(/not switched on yet/i)).toBeVisible();
    await expect(page.getByLabel("Your question")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Ask" })).toHaveCount(0);
    await expect(page.getByText(/only figures from your recorded transactions/i)).toBeVisible();
  });
});

test.describe("profile completion and preferences (needs migration 9)", () => {
  test.describe.configure({ mode: "serial" });

  test("a partial save keeps the profile Pending and the dashboard shows the banner with what is missing", async ({ page }) => {
    needMigration();
    // Start from a known state: an earlier run may have left this profile complete.
    const sb = await api();
    await sb.from("profiles").update({ country: null, persona: null, date_format: null, phone: null, profile_completed_at: null, banner_dismissed_until: null }).not("user_id", "is", null);
    await open(page, "/app/settings");
    await page.getByLabel("Full name").fill("E2E Person");
    await choose(page, "Country", "IN");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText(/Saved\. \d details? left/)).toBeVisible();
    await expect(page.getByText("Pending").first()).toBeVisible();
    await open(page, "/app");
    const banner = page.getByRole("region", { name: "Complete your profile" });
    await expect(banner).toBeVisible();
    await expect(banner.getByText(/Still to add/)).toBeVisible();
  });

  test("dismissing the banner hides it for now without marking the profile complete", async ({ page }) => {
    needMigration();
    await open(page, "/app");
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("region", { name: "Complete your profile" })).toHaveCount(0);
    await open(page, "/app/settings");
    await expect(page.getByText("Pending").first()).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menuitem", { name: /My profile/ })).toContainText("Pending");
  });

  test("completing every required field marks it complete and it persists across a reload", async ({ page }) => {
    needMigration();
    await open(page, "/app/settings");
    await page.getByLabel("Full name").fill("E2E Person");
    await choose(page, "Country", "IN");
    await choose(page, "How will you use FinTrack?", "professional");
    await choose(page, "Date format", "dmy");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Saved. Your profile is complete.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Complete", { exact: true })).toBeVisible();
    // Country is a styled select: the visible button shows the name and the hidden field carries the code that is stored.
    expect(await page.locator("select[name=country]").inputValue()).toBe("IN");
    await open(page, "/app");
    await expect(page.getByRole("region", { name: "Complete your profile" })).toHaveCount(0);
  });

  test("an invalid phone number is rejected in plain words and nothing is lost", async ({ page }) => {
    needMigration();
    await open(page, "/app/settings");
    await page.getByLabel("Phone number (optional)").fill("call me");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText(/Enter a phone number like/)).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveValue("E2E Person");
  });

  test("the number format preference changes how money is shown everywhere, and persists", async ({ page }) => {
    needMigration();
    await open(page, "/app/settings/preferences");
    await choose(page, "Number format", "de-DE");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText(/Preferences saved/)).toBeVisible();
    await open(page, "/app/accounts");
    expect(await page.locator(".num").first().innerText()).toMatch(/\d\.\d{3},\d{2}|\d,\d{2}/); // 1.234,56 style
    // restore
    await open(page, "/app/settings/preferences");
    await choose(page, "Number format", "en-IN");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText(/Preferences saved/)).toBeVisible();
  });

  test("dashboard sections can be turned off and on from Preferences", async ({ page }) => {
    needMigration();
    await open(page, "/app/settings/preferences");
    await toggle(page, "Recent transactions", false);
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText(/Preferences saved/)).toBeVisible();
    await open(page, "/app");
    await expect(page.getByRole("region", { name: "Recent transactions" })).toHaveCount(0);
    await open(page, "/app/settings/preferences");
    await toggle(page, "Recent transactions", true);
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText(/Preferences saved/)).toBeVisible();
  });

  test("the theme chosen in the app is saved to the profile and applied on a fresh browser", async ({ page, browser, baseURL }) => {
    needMigration();
    await resetTheme(page, "light");
    await open(page, "/app");
    await page.getByRole("radio", { name: "Dark theme" }).click();
    await expect.poll(async () => (await (await api()).from("profiles").select("theme").single()).data?.theme).toBe("dark");
    const ctx = await browser.newContext({ storageState: await page.context().storageState() });
    const other = await ctx.newPage();
    await other.goto(`${baseURL}/app`);
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    await ctx.close();
    await page.getByRole("radio", { name: "Light theme" }).click();
    await profileTheme("light", expect); // leave the shared profile as found, and wait until it is saved
  });

  test("notification choices persist", async ({ page }) => {
    needMigration();
    await open(page, "/app/settings/notifications");
    await toggle(page, /Product announcements/, true);
    await page.getByRole("button", { name: "Save choices" }).click();
    await expect(page.getByText("Notification choices saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Product announcements/)).toBeChecked();
    await toggle(page, /Product announcements/, false);
    await page.getByRole("button", { name: "Save choices" }).click();
  });
});

test.describe("sample data (preview account)", () => {
  test.describe.configure({ mode: "serial" });

  test("loads a clearly labelled fictional space, shows realistic figures, and can be removed", async ({ page }) => {
    needMigration();
    test.setTimeout(180_000);
    await open(page, "/app/settings/privacy");
    await page.getByRole("button", { name: "Explore with sample data" }).click();
    await expect(page).toHaveURL(/\/app\?sample=1/, { timeout: 150_000 });
    await expect(page.getByText("Sample data · fictional").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Net worth")).toBeVisible();
    for (const path of ["/app/accounts", "/app/transactions", "/app/budgets", "/app/goals", "/app/bills"]) {
      await page.goto(path);
      await expect(page.getByText(/\(sample\)|Rao family|Emergency fund|Rent|Groceries/).first()).toBeVisible();
    }
    // removal: the space and its figures disappear
    await open(page, "/app/settings/privacy");
    await page.getByRole("button", { name: "Remove sample data" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText("Sample data · fictional")).toHaveCount(0);
  });
});

test.describe("profile photo upload (needs migration 9)", () => {
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  test("a photo uploads, shows for its owner, a wrong type is refused, and removing it leaves nothing behind", async ({ page }) => {
    needMigration();
    await page.goto("/app/settings");
    await page.waitForLoadState("networkidle"); // the file input needs its handler attached before a file is set

    // wrong type is refused before anything is sent
    await page.getByLabel("Profile photo file").setInputFiles({ name: "x.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(page.getByText("Choose a JPG, PNG or WebP image.")).toBeVisible();

    await page.getByLabel("Profile photo file").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByRole("status").filter({ hasText: "Photo updated." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
    await expect(page.locator("main img").first()).toBeVisible();

    // it persists across a reload and is stored in the person's own folder
    await page.reload();
    await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
    const sb = await api();
    const { data } = await sb.from("profiles").select("avatar_path,user_id").single();
    expect(data!.avatar_path).toMatch(new RegExp(`^${data!.user_id}/avatar-`));

    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Photo removed." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();
    const after = await sb.from("profiles").select("avatar_path").single();
    expect(after.data!.avatar_path).toBeNull();
  });
});
