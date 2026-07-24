import { parseFinanceCsv } from "./finance-csv.js";

describe("finance CSV parsing", () => {
  it("parses quoted PayPal-style exports and stable provider identifiers", () => {
    expect(
      parseFinanceCsv(
        "paypal",
        'Date,Name,Amount,Transaction ID,Note\r\n07/19/2026,"Trader, Joe’s",12.50,pp-1,"Weekly, groceries"',
      ),
    ).toEqual([
      {
        amount: 12.5,
        date: "2026-07-19",
        direction: "expense",
        externalId: "pp-1",
        merchant: "Trader, Joe’s",
        notes: "Weekly, groceries",
      },
    ]);
  });

  it("normalizes alternate headers, credits, and fallback identifiers", () => {
    expect(
      parseFinanceCsv(
        "venmo",
        "Date & Time,From,Amount (total),Type\n2026-07-19 12:00,Alex,-$5.00,Payment Received",
      ),
    ).toEqual([
      {
        amount: 5,
        date: "2026-07-19",
        direction: "income",
        externalId: "2026-07-19:Alex:-5:0",
        merchant: "Alex",
        notes: null,
      },
    ]);
    expect(
      parseFinanceCsv(
        "zelle",
        "Initiated Date,Description,Net Amount,Status\n7/19/26,Landlord,($900),Sent",
      ),
    ).toMatchObject([{ amount: 900, direction: "expense", merchant: "Landlord" }]);
    expect(
      parseFinanceCsv("paypal", 'Date,Description,Amount\n2026-07-19,"A ""quoted"" merchant",5'),
    ).toMatchObject([{ merchant: 'A "quoted" merchant' }]);
    expect(
      parseFinanceCsv("paypal", "Date,Description,Amount\n2026-07-19,Refund,-7"),
    ).toMatchObject([{ direction: "income" }]);
    expect(
      parseFinanceCsv("paypal", "Date,Description,Amount,Note\n2026-07-19,Transfer,-7"),
    ).toMatchObject([{ direction: "income" }]);
  });

  it("rejects malformed exports before anything reaches storage", () => {
    expect(() => parseFinanceCsv("paypal", "Date,Amount\n")).toThrow("header and at least one");
    expect(() => parseFinanceCsv("paypal", "Date,Amount\n2026-07-19,0")).toThrow(
      "Invalid transaction amount",
    );
    expect(() => parseFinanceCsv("paypal", "Date,Amount\nnot-a-date,1")).toThrow(
      "Invalid transaction date",
    );
    expect(() => parseFinanceCsv("paypal", "Date,Amount\n13/40/2026,1")).toThrow(
      "Invalid transaction date",
    );
    expect(() => parseFinanceCsv("paypal", 'Date,Amount\n2026-07-19,"1')).toThrow("unclosed");
  });
});
