import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createOwner, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

// A 1×1 PNG: the test is about the viewer opening and closing, not the pixels.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
// The upload route checks the declared type, not the bytes.
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

function phone() {
  return `96${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}

/**
 * A tenant with a photo, an ID front that is a picture, and an ID back that
 * is a PDF. Real uploads, through the portal's route: the public one is
 * rate-limited for the whole suite.
 */
async function tenantWithFiles(request: APIRequestContext, token: string, name: string) {
  const auth = { Authorization: `Bearer ${token}` };
  const t = await createTenantViaApi(request, token, { name, phone: phone() });
  await request.put(`${BASE}/api/tenants/${t.id}/portal-password`, { headers: auth, data: { password: "photos12" } });
  const login = await (await request.post(`${BASE}/tenant-auth/login`, {
    data: { phone: t.phone, password: "photos12" },
  })).json();
  async function upload(name: string, mimeType: string, buffer: Buffer) {
    const res = await request.post(`${BASE}/tenant/upload`, {
      headers: { Authorization: `Bearer ${login.token}` },
      multipart: { file: { name, mimeType, buffer } },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).key as string;
  }
  const res = await request.put(`${BASE}/api/tenants/${t.id}`, {
    headers: auth,
    data: {
      name: t.name,
      phone: t.phone,
      photo_url: await upload("face.png", "image/png", PNG),
      id_proof_front_url: await upload("front.png", "image/png", PNG),
      id_proof_back_url: await upload("back.pdf", "application/pdf", PDF),
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return t;
}

async function viewerLoaded(page: Page) {
  const img = page.getByRole("dialog").locator("img");
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
}

/**
 * The profile photo was a 56px circle that did nothing when tapped, and the
 * ID scans opened in a new tab (Nov 2026). Both now open full screen, inside
 * the app; a PDF still opens in a tab, because an <img> cannot draw it.
 */
test.describe("Photos open full screen on the tenant page", () => {
  test("the photo and the ID front open in the viewer; a PDF back stays a link", async ({ page, request }) => {
    const { token } = await createOwner(request, `photo-view-${RUN_ID}`);
    const name = `Photo Viewer ${RUN_ID}`;
    const t = await tenantWithFiles(request, token, name);
    await loginAs(page, token);
    await page.goto(`/tenants/${t.id}`);

    // The photo: opens, shows the picture, names who it is; Escape closes.
    await page.getByRole("button", { name: `View ${name}'s photo` }).click();
    const viewer = page.getByRole("dialog", { name });
    await expect(viewer).toBeVisible();
    await viewerLoaded(page);
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();

    // The ID front: a tap on the picture keeps it open (pinch-zoom must not
    // close it); a tap outside it, or ×, closes it.
    await page.getByRole("button", { name: "Front", exact: true }).click();
    const front = page.getByRole("dialog", { name: `${name} · ID front` });
    await expect(front).toBeVisible();
    await viewerLoaded(page);
    await front.locator("img").click();
    await expect(front).toBeVisible();
    await page.mouse.click(10, page.viewportSize()!.height - 10);
    await expect(front).toBeHidden();

    await page.getByRole("button", { name: "Front", exact: true }).click();
    await expect(front).toBeVisible();
    await front.getByRole("button", { name: "Close" }).click();
    await expect(front).toBeHidden();

    // The PDF back: still a link to a new tab, and says it is a PDF.
    const back = page.getByRole("link", { name: "Back (PDF)" });
    await expect(back).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  });

  test.describe("on a touch iPad", () => {
    test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

    test("a swipe down closes it; a short drag does not", async ({ page, request }) => {
      const { token } = await createOwner(request, `photo-swipe-${RUN_ID}`);
      const name = `Photo Swipe ${RUN_ID}`;
      const t = await tenantWithFiles(request, token, name);
      await loginAs(page, token);
      await page.goto(`/tenants/${t.id}`);

      await page.getByRole("button", { name: `View ${name}'s photo` }).tap();
      const viewer = page.getByRole("dialog", { name });
      await expect(viewer).toBeVisible();

      async function drag(dy: number) {
        await viewer.evaluate((el, dy) => {
          const at = (y: number) => new Touch({ identifier: 1, target: el, clientX: 300, clientY: y });
          el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [at(300)], changedTouches: [at(300)] }));
          el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [at(300 + dy)] }));
        }, dy);
      }

      await drag(30);
      await expect(viewer).toBeVisible();
      await drag(200);
      await expect(viewer).toBeHidden();
    });
  });
});
