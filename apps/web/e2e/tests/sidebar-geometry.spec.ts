import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 1440]) {
    test(`sidebar identity stays aligned at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((mode) => {
        localStorage.setItem("theme", mode);
        localStorage.setItem("otter:sidebar-collapsed", "false");
      }, theme);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Your machines" })).toBeVisible();
      const sidebar = page.locator("[data-basalt-sidebar]");
      const identity = sidebar.locator('[data-slot="sidebar-user"]');
      const email = identity.locator("p").last();
      const avatar = identity.locator(".h-basalt-9.w-basalt-9");
      const brand = sidebar.locator('[data-slot="sidebar-brand-copy"]');
      await expect(page.locator("html")).toHaveAttribute("data-mode", theme);
      await expect(sidebar).toHaveCSS("width", "260px");
      await expect(email).toContainText("@otter.test");
      await expect(email).toHaveCSS("line-height", "16px");
      await expect(avatar).toHaveCSS("width", "36px");
      await expect(avatar).toHaveCSS("height", "36px");
      await expect(brand).toBeVisible();
      await expect(brand).toContainText("Otter");
      await expect(brand.locator('[data-slot="sidebar-brand-version"]')).toBeVisible();
      const expanded = await avatar.boundingBox();
      expect(expanded).not.toBeNull();
      await page.getByRole("button", { name: "Collapse sidebar" }).click();
      await page.mouse.move(width - 1, 0);
      await expect(sidebar).toHaveCSS("width", "68px");
      await expect(avatar).toHaveCSS("width", "36px");
      await expect(avatar).toHaveCSS("height", "36px");
      await expect.poll(async () => (await avatar.boundingBox())?.y).toBe(expanded?.y);
      await expect(brand).toBeHidden();
      await expect(brand).toHaveCSS("overflow-x", "hidden");
      const clippedBrand = await brand.evaluate((element) => {
        const clip = element.getBoundingClientRect();
        return ["sidebar-brand-name", "sidebar-brand-version"].map((slot) => {
          const child = element.querySelector(`[data-slot="${slot}"]`);
          if (!child) throw new Error(`Missing ${slot}`);
          const rect = child.getBoundingClientRect();
          return Math.max(0, Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left));
        });
      });
      expect(clippedBrand).toEqual([0, 0]);
      await test.info().attach("collapsed-geometry", {
        body: JSON.stringify({
          expandedAvatar: expanded,
          collapsedAvatar: await avatar.boundingBox(),
        }),
        contentType: "application/json",
      });
      await sidebar.getByRole("link", { name: "Snapshots", exact: true }).click();
      await expect(page).toHaveURL(/\/snapshots$/);
      await expect(sidebar.getByRole("link", { name: "Snapshots", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await page.getByRole("button", { name: "Expand sidebar" }).click();
      await page.mouse.move(width - 1, 0);
      await expect(sidebar).toHaveCSS("width", "260px");
      await expect(email).toHaveCSS("line-height", "16px");
      await expect(brand).toBeVisible();
      await expect(sidebar.getByRole("link", { name: "Sign out" })).toHaveAttribute(
        "href",
        "/cdn-cgi/access/logout",
      );
    });
  }

  for (const width of [375, 390, 640]) {
    test(`drawer owns geometry and keyboard navigation at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((mode) => localStorage.setItem("theme", mode), theme);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Your machines" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-mode", theme);
      await expect(page.locator("[data-basalt-sidebar]")).toHaveCount(0);
      const menu = page.getByRole("button", { name: "Open navigation", includeHidden: true });
      const drawer = page.locator('[data-slot="sidebar-drawer"]');
      await menu.focus();
      await page.keyboard.press("Enter");
      await expect(drawer).toBeVisible();
      await expect(menu).toHaveAttribute("aria-controls", (await drawer.getAttribute("id")) ?? "");
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await expect(drawer).toHaveCSS("width", "320px");
      await expect(drawer.locator("[data-basalt-sidebar]")).toHaveCSS("width", "260px");
      await expect(drawer).toHaveCSS("padding-left", "0px");
      await expect(drawer).toHaveCSS("padding-right", "0px");
      await expect(drawer).toHaveCSS("padding-top", "0px");
      await expect(drawer).toHaveCSS("padding-bottom", "0px");
      const dismiss = drawer.getByRole("button", { name: "Close navigation" });
      await expect(dismiss).toBeVisible();
      await expect(dismiss).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(menu).toBeFocused();
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await menu.click();
      await expect(drawer).toBeVisible();
      await drawer.getByRole("link", { name: "Snapshots", exact: true }).click();
      await expect(page).toHaveURL(/\/snapshots$/);
      await expect(drawer).toBeHidden();
      await expect(menu).toBeFocused();
      await menu.click();
      await expect(drawer.getByRole("link", { name: "Snapshots", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await dismiss.click();
      await expect(drawer).toBeHidden();
      await expect(menu).toBeFocused();
    });
  }
}
