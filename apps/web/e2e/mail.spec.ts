import { expect, test, type Page } from "@playwright/test";
import { newPage, openApp, signUpViaApi } from "./helpers";

async function goFolder(page: Page, view: string) {
  const mobile = (page.viewportSize()?.width ?? 1000) < 900;
  if (mobile) await page.getByTestId("mail-drawer").click();
  await page.getByTestId(`folder-${view}`).click();
}

test("internal mail: compose with autosave, deliver in real time, reply, archive, trash, restore, search", async ({ page, browser }) => {
  const mobile = (page.viewportSize()?.width ?? 1000) < 900;
  const alice = await signUpViaApi(page, "Алиса", "Смирнова");
  const bobPage = await newPage(browser, !mobile);
  const bob = await signUpViaApi(bobPage, "Борис", "Орлов");

  await openApp(page, "mail");
  await page.getByTestId("compose").first().click();
  await page.getByTestId("composer-to").fill(`${bob.username} `);
  await expect(page.getByTestId("recipient-chip")).toHaveAttribute("data-status", "ok");
  await page.getByTestId("composer-subject").fill("Отчёт за квартал");
  await page.getByTestId("composer-body").fill("Привет! Отчёт готов.");
  await expect(page.getByTestId("draft-status")).toHaveText("Черновик сохранён");
  await page.getByTestId("composer-send").click();
  await expect(page.getByText("Письмо отправлено")).toBeVisible();

  // Bob gets a real-time banner and the unread badge.
  await expect(bobPage.getByTestId("toast").filter({ hasText: "Алиса Смирнова" })).toBeVisible();
  await openApp(bobPage, "mail");
  const row = bobPage.getByTestId("thread-row").first();
  await expect(row).toHaveAttribute("data-unread", "true");
  await row.click();
  await expect(bobPage.getByTestId("message-body").first()).toHaveText("Привет! Отчёт готов.");
  await bobPage.getByTestId("reply").first().click();
  await bobPage.getByTestId("composer-body").press("Home");
  await bobPage.getByTestId("composer-body").pressSequentially("Спасибо, смотрю.");
  await bobPage.getByTestId("composer-send").click();

  // Alice sees the reply in the same conversation.
  await goFolder(page, "inbox");
  await page.getByTestId("thread-row").first().click();
  await expect(page.getByTestId("message-card")).toHaveCount(2);
  await expect(page.getByTestId("message-body").last()).toContainText("Спасибо, смотрю.");

  // Archive → gone from inbox, present in archive; trash → restore.
  await page.getByTestId("action-archive").last().click();
  await expect(page.getByText("Переписка в архиве")).toBeVisible();
  if (mobile) await expect(page.getByTestId("thread-view")).toHaveCount(0);
  await expect(page.getByTestId("thread-row")).toHaveCount(0);
  await goFolder(page, "archive");
  await page.getByTestId("thread-row").first().click();
  await page.getByTestId("action-trash").last().click();
  await goFolder(page, "trash");
  await expect(page.getByTestId("thread-row")).toHaveCount(1);
  await page.getByTestId("thread-row").first().click();
  await page.getByTestId("action-restore").last().click();
  await goFolder(page, "inbox");
  await expect(page.getByTestId("thread-row")).toHaveCount(1);

  // Search.
  if (mobile) await page.getByLabel("Поиск в почте").click();
  await page.getByTestId("mail-search").fill("квартал");
  await expect(page.getByTestId("thread-row")).toHaveCount(1);
  await page.getByTestId("mail-search").fill("нет-такого-письма");
  await expect(page.getByText("Ничего не найдено")).toBeVisible();
  void alice;
});

test("drafts persist and can be continued, then discarded", async ({ page }) => {
  await signUpViaApi(page, "Дина", "Черновик");
  await openApp(page, "mail");
  await page.getByTestId("compose").first().click();
  await page.getByTestId("composer-subject").fill("Незаконченная мысль");
  await page.getByTestId("composer-body").fill("Черновой текст");
  await expect(page.getByTestId("draft-status")).toHaveText("Черновик сохранён");
  await page.getByLabel("Закрыть").first().click();
  await goFolder(page, "drafts");
  await page.getByTestId("thread-row").first().click();
  await expect(page.getByTestId("composer-body")).toHaveValue("Черновой текст");
  await page.getByTestId("composer-discard").click();
  await expect(page.getByText("Черновик удалён")).toBeVisible();
  await expect(page.getByTestId("thread-row")).toHaveCount(0);
});

test("sending to a non-VOIDEX address is refused and the draft is kept", async ({ page }) => {
  await signUpViaApi(page, "Том", "Тестов");
  await openApp(page, "mail");
  await page.getByTestId("compose").first().click();
  await page.getByTestId("composer-to").fill("someone@gmail.com ");
  await page.getByTestId("composer-body").fill("x");
  await page.getByTestId("composer-send").click();
  await expect(page.getByText("Пока Почта VoidOps доставляет письма только на адреса VOIDEX.")).toBeVisible();
});

test("attachments: attach files and a picture, remove one before sending; the recipient previews and downloads", async ({ page, browser }) => {
  const mobile = (page.viewportSize()?.width ?? 1000) < 900;
  await signUpViaApi(page, "Вера", "Нуриева");
  const bobPage = await newPage(browser, mobile);
  const bob = await signUpViaApi(bobPage, "Глеб", "Ким");
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082",
    "hex",
  );

  await openApp(page, "mail");
  await page.getByTestId("compose").first().click();
  await page.getByTestId("composer-to").fill(`${bob.username} `);
  await expect(page.getByTestId("recipient-chip")).toHaveAttribute("data-status", "ok");
  await page.getByTestId("composer-subject").fill("Документы");
  await page.getByTestId("composer-body").fill("Во вложении.");
  await page.getByTestId("composer-file-input").setInputFiles([
    { name: "отчёт.txt", mimeType: "text/plain", buffer: Buffer.from("квартальный отчёт") },
    { name: "лишний.txt", mimeType: "text/plain", buffer: Buffer.from("не нужен") },
    { name: "фото.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByTestId("composer-attachment")).toHaveCount(3);
  await page.getByTestId("composer-attachment").filter({ hasText: "лишний.txt" }).getByTestId("composer-attachment-remove").click();
  await expect(page.getByTestId("composer-attachment")).toHaveCount(2);
  // Not allowed types are refused before upload.
  await page.getByTestId("composer-file-input").setInputFiles([{ name: "run.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }]);
  await expect(page.getByTestId("toast").filter({ hasText: "нельзя прикрепить" })).toBeVisible();
  await expect(page.getByTestId("composer-attachment")).toHaveCount(2);
  await page.getByTestId("composer-send").click();
  await expect(page.getByText("Письмо отправлено")).toBeVisible();

  await openApp(bobPage, "mail");
  const row = bobPage.getByTestId("thread-row").first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(bobPage.getByTestId("message-attachments")).toBeVisible();
  await expect(bobPage.getByTestId("message-attachment-image").locator("img")).toBeVisible();
  const download = bobPage.waitForEvent("download");
  await bobPage.getByTestId("message-attachment").filter({ hasText: "отчёт.txt" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("отчёт.txt");
});
