import { expect, test as setup } from "@playwright/test";
import { loginUi } from "./helpers";

setup("sign in the disposable test user", async ({ page }) => {
  await loginUi(page);
  await expect(page).toHaveURL(/\/app/);
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
