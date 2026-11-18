import type { financeTransactions } from "@personal-os/database";
import { localDateAt, localDateToIso } from "@personal-os/domain";

/** Four completed local calendar months; deterministic, posted manual evidence only. */
export function financeHistoryFixture(userId: string, now: Date) {
  const id = (record: number) =>
    `${userId.slice(0, 8)}-0000-4000-8000-${record.toString(16).padStart(12, "0")}`;
  const today = localDateToIso(localDateAt(now, "America/New_York"));
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const rows: (typeof financeTransactions.$inferInsert)[] = [];
  for (let offset = 4; offset >= 1; offset--) {
    const first = new Date(Date.UTC(year, month - 1 - offset, 1));
    const days = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const variation = 4 - offset;
    const add = (
      day: number,
      amount: number,
      category: string,
      categoryRecord: number,
      merchant: string,
      merchantRecord: number,
      income = false,
    ) => {
      const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day, 12));
      rows.push({
        id: id(2000 + rows.length),
        userId,
        accountId: id(income || category === "Housing" ? 400 : 403),
        amount,
        category,
        categoryId: id(categoryRecord),
        merchant,
        merchantId: id(merchantRecord),
        direction: income ? "income" : "expense",
        categorySource: "user",
        categoryConfidence: 10_000,
        categoryDecidedAt: date,
        needsReview: false,
        pending: false,
        providerTransactionId: `fixture-history-${date.toISOString().slice(0, 10)}-${rows.length}`,
        transactionDate: date.toISOString().slice(0, 10),
        createdAt: date,
        updatedAt: date,
      });
    };
    add(1, 285_000, "Housing", 422, "HUDSON RENTALS", 753);
    for (const day of [1, 15]) add(day, 412_500, "Income", 423, "HARBOR ARTS PAYROLL", 750, true);
    add(8, 1_999, "Subscriptions", 424, "FIGMA", 754);
    add(
      20,
      offset === 2 ? 64_800 : 9_600 + variation * 1_200,
      "Travel",
      776,
      offset === 2 ? "AMTRAK" : "MTA*METROCARD",
      offset === 2 ? 1900 : 756,
    );
    for (let day = 1; day <= days; day++) {
      const weekday = new Date(
        Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day),
      ).getUTCDay();
      if (weekday === 0)
        add(
          day,
          10_200 + ((day + variation * 7) % 5) * 735,
          "Groceries",
          421,
          "NEIGHBORHOOD MARKET",
          431,
        );
      if (weekday >= 1 && weekday <= 5)
        add(day, 575 + ((day + variation) % 4) * 125, "Dining", 420, "CORNER CAFE NYC #042", 430);
      if (weekday === 5 || weekday === 6)
        add(day, 3_800 + ((day + variation * 3) % 7) * 650, "Dining", 420, "HUDSON TABLE", 1901);
    }
  }
  return rows;
}
