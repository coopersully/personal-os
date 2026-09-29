import { expect, test } from "@playwright/test";

for (const width of [390, 1100]) {
  test(`auth decoration stays separate from the form and field spacing matches at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 588 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Login", exact: true })).toBeVisible();
    const formBox = await page.locator(".auth-form").boundingBox();
    if (!formBox) throw new Error("Missing auth form");
    const panel = page.locator(".auth-brand-panel");
    const brandHeader = page.locator(".auth-header__brand");
    await expect(brandHeader).toHaveText("nohmi");
    const headerBox = await brandHeader.boundingBox();
    if (!headerBox) throw new Error("Missing auth brand header");
    expect(headerBox.y).toBe(24);
    expect(headerBox.height).toBe(14);
    const symbolBox = await brandHeader.locator(".auth-header__symbol").boundingBox();
    const wordmarkBox = await brandHeader.locator(".brand-wordmark").boundingBox();
    expect(symbolBox?.height).toBe(wordmarkBox?.height);
    const symbolShape = await brandHeader.locator(".auth-header__symbol").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        radius: Number.parseFloat(style.borderTopLeftRadius),
        height: element.getBoundingClientRect().height,
      };
    });
    expect(symbolShape.radius).toBeGreaterThan(0);
    expect(symbolShape.radius).toBeLessThanOrEqual(symbolShape.height * 0.3);
    await expect(page.locator(".auth-form__heading")).toHaveCSS("text-align", "center");
    await expect(
      page.locator(".auth-form-wrap").getByRole("img", { name: "nohmi", exact: true }),
    ).toHaveCount(0);
    if (width >= 1024) {
      await expect(panel).toBeVisible();
      const panelBox = await panel.boundingBox();
      if (!panelBox) throw new Error("Missing desktop auth card");
      expect(formBox.x + formBox.width).toBeLessThanOrEqual(width / 2);
      expect(panelBox.x).toBeGreaterThanOrEqual(width / 2);
      expect(headerBox.x).toBe(width - panelBox.x - panelBox.width);
      expect(headerBox.y).toBe(panelBox.y);
      const tiles = panel.locator(".brand-pattern__tile");
      expect(await tiles.count()).toBeGreaterThan(1);
      await expect(panel.locator(".auth-brand-graphic__orbit")).toHaveCount(0);
      const durations = await tiles.evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).animationDuration),
      );
      expect(new Set(durations).size).toBeGreaterThan(1);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(tiles.first()).toHaveCSS("animation-name", "none");
    } else {
      await expect(panel).toBeHidden();
      expect(Math.abs(formBox.x + formBox.width / 2 - width / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(headerBox.x + headerBox.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    }
    const labelGaps = await page.evaluate(() => {
      return ["Email", "Password"].map((name) => {
        const label = [...document.querySelectorAll("label")].find(
          (item) => item.textContent === name,
        );
        const control = label && document.getElementById(label.htmlFor);
        if (!label || !control) throw new Error(`Missing ${name} field`);
        // InputGroup owns the visible field boundary; its inner input is shorter.
        const surface = control.closest('[data-slot="input-group"]') ?? control;
        return surface.getBoundingClientRect().top - label.getBoundingClientRect().bottom;
      });
    });
    expect(Math.abs((labelGaps[0] ?? 0) - (labelGaps[1] ?? 0))).toBeLessThanOrEqual(1);
    expect(labelGaps[0]).toBeLessThanOrEqual(6);
    const inviteLink = page.getByRole("button", { name: "Have an invite? Create an account" });
    await expect(inviteLink.locator("svg")).toHaveCount(0);
    await inviteLink.click();
    const title = page.getByRole("heading", { name: "Redeem Invite Code" });
    await expect(title).toBeVisible();
    const titleBox = await title.boundingBox();
    expect(titleBox).not.toBeNull();
    if (!titleBox) throw new Error("Missing auth heading");
    expect(titleBox.y).toBeGreaterThanOrEqual(0);
    const signupHeaderBox = await brandHeader.boundingBox();
    if (!signupHeaderBox) throw new Error("Missing signup brand header");
    expect(titleBox.y).toBeGreaterThanOrEqual(signupHeaderBox.y + signupHeaderBox.height + 24);
    await expect(page.locator(".auth-form__heading p")).toHaveCSS("text-align", "center");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => window.scrollTo(0, 250));
    const floatingBox = await brandHeader.boundingBox();
    expect(floatingBox?.y).toBe(24);
    const headerSurface = await page.locator(".auth-header").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const shell = document.querySelector(".auth-shell");
      if (!shell) throw new Error("Missing auth layout");
      return {
        background: getComputedStyle(element).backgroundColor,
        pageBackground: getComputedStyle(shell).backgroundColor,
        aboveForm: element.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 1),
        ),
      };
    });
    expect(headerSurface.background).toBe(headerSurface.pageBackground);
    expect(headerSurface.aboveForm).toBe(true);
  });
}

for (const theme of ["light", "dark"]) {
  test(`autofilled login inputs retain their tonal surface in ${theme} mode`, async ({ page }) => {
    await page.goto("/");
    const email = page.getByRole("textbox", { name: "Email", exact: true });
    await expect(email).toBeVisible();
    await page.evaluate((mode) => {
      document.documentElement.classList.toggle("dark", mode === "dark");
    }, theme);
    await page.addStyleTag({
      content: "* { transition: none !important; caret-color: transparent !important; }",
    });
    const placeholderColor = await email.evaluate(
      (element) => getComputedStyle(element, "::placeholder").color,
    );
    const labelColor = await page
      .locator("label")
      .filter({ hasText: /^Email$/ })
      .evaluate((element) => getComputedStyle(element).color);
    expect(placeholderColor).not.toBe(labelColor);
    await email.fill("sam@example.com");
    const password = page.getByLabel("Password", { exact: true });
    const group = page.locator('[data-slot="input-group"]').filter({ has: password });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: 'input[type="email"]',
    });

    for (const state of ["rest", "hover", "focus"]) {
      if (state === "focus") await email.focus();
      else await email.blur();
      if (state === "hover") await email.hover();
      else await page.mouse.move(0, 0);
      const before = await email.evaluate((element) => getComputedStyle(element).backgroundColor);
      await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["autofill"] });
      // Autofill can force a UA background with !important. A flat inset paint
      // may mask it, but clipping the surface to the glyphs must never erase it.
      const after = await email.evaluate((element) => {
        const style = getComputedStyle(element);
        const insetColor = style.boxShadow.match(/^(.*?) 0px 0px 0px \d+px inset$/)?.[1];
        return style.backgroundClip === "text"
          ? "transparent"
          : (insetColor ?? style.backgroundColor);
      });
      expect(after).toBe(before);
      await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
    }

    await email.blur();
    await page.mouse.move(0, 0);
    expect(await email.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      await group.evaluate((element) => getComputedStyle(element).backgroundColor),
    );
    await password.fill("Example-password-123!");
    await password.hover();
    await expect(password).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(password).toHaveAttribute("type", "text");
  });
}
