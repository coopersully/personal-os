import { expect, type Page } from "@playwright/test";

/** Exercise the visible shadcn settings controls, including their commit boundary. */
export async function selectSetting(page: Page, label: string, option: string) {
  const button = page.getByRole("button", { name: label, exact: true });
  const input = page.getByRole("combobox", { name: label, exact: true });
  await expect(button.or(input)).toBeVisible();
  if (await button.isVisible()) {
    await button.click();
    await page.getByRole("menuitemradio", { name: option, exact: true }).click();
  } else {
    await input.click();
    await input.fill(option);
    await page.getByRole("option", { name: option, exact: true }).click();
  }
}
export async function setSettingTime(page: Page, label: string, value: string) {
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.click();
  await input.fill(value);
  await page.getByRole("option", { name: value, exact: true }).click();
  await expect(input).toHaveValue(value);
}
