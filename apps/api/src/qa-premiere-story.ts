import { addLocalDays, localDateAt, localDateTimeToUtc, localDateToIso } from "@personal-os/domain";
import type { FixtureData } from "./qa-fixtures.js";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Premiere story requires the complete demo fixture.");
  return value;
}

/** Opt-in fictional campaign data. Never changes the default QA catalog. */
export function applyPremiereStory(data: FixtureData, userId: string, now: Date): void {
  const own = <T extends { userId: string }>(rows: T[]) => rows.filter((r) => r.userId === userId);
  const id = (n: number) =>
    `${userId.slice(0, 8)}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const zone = "America/New_York";
  const today = localDateAt(now, zone);
  const day = (offset: number) => localDateToIso(addLocalDays(today, offset));
  const at = (offset: number, hour: number) =>
    localDateTimeToUtc(addLocalDays(today, offset), hour * 60, zone);
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  const replace = <K extends keyof FixtureData>(key: K, rows: FixtureData[K]) => {
    Object.assign(data, {
      [key]: [
        ...(data[key] as Array<{ userId?: string }>).filter((r) => r.userId !== userId),
        ...rows,
      ],
    });
  };
  const work = required(own(data.taskLists).find((r) => r.name === "Work"));
  work.name = "After the rain";
  work.normalizedName = "after the rain";
  work.description = "A short film, from final cut to the first full room.";
  const project = {
    ...required(own(data.taskProjects)[0]),
    id: id(240),
    listId: required(work.id),
    name: "Premiere night",
    normalizedName: "premiere night",
    notes:
      "The film is finished. The room is booked. Bring the people who made it possible together.",
    why: "Finish something personal, and share it with a real audience.",
    targetDate: day(1),
    lifecycle: "open" as const,
    completedAt: null,
  };
  replace("taskProjects", [project]);
  const titles = [
    "Send the final guest list",
    "Pick up the screening posters",
    "Pack the backup film drive",
    "Thank the cast and crew",
    "Deliver the final film",
    "Confirm the cinema booking",
    "Approve the poster artwork",
    "Pay the sound mix invoice",
  ];
  const baseTask = required(own(data.reminders).find((r) => r.kind === "task"));
  replace(
    "reminders",
    titles.map((title, i) => ({
      ...baseTask,
      id: id(900 + i),
      title,
      kind: "task" as const,
      notes: [
        "86 guests confirmed. Send the final list to Maya at the cinema.",
        "The print shop has 20 A3 posters ready at noon.",
        "Final DCP and a ProRes backup, both verified.",
        "A personal note before tomorrow's screening.",
        "DCP delivered and playback checked by the projectionist.",
        "90 seats reserved. Doors open at 6:30.",
        "Print-ready files approved with the designer.",
        "Invoice paid. Final mix delivered.",
      ][i],
      status: i < 4 ? ("inbox" as const) : ("completed" as const),
      taskLifecycle: i < 4 ? ("open" as const) : ("completed" as const),
      taskListId: work.id,
      taskProjectId: project.id,
      taskGoalId: null,
      taskWhy: "Bring After the rain to its first audience.",
      dueAt: at(0, 12 + i),
      scheduledAt: null,
      completedAt: i < 4 ? null : ago(i - 3),
      deletedAt: null,
      taskCancelledAt: null,
      priority: i === 0 ? ("high" as const) : ("medium" as const),
      estimateMinutes: [15, 30, 10, 20, 45, 15, 20, 10][i],
      tags: ["premiere"],
    })),
  );
  replace("goals", [
    {
      ...required(own(data.goals)[0]),
      id: id(210),
      title: "Premiere my first short film",
      description:
        "After the rain is finished. Share it with 90 people, pay everyone, and keep a buffer for what comes next.",
      progress: 92,
      status: "active",
      targetDate: day(1),
    },
  ]);
  replace("motives", [
    {
      ...required(own(data.motives)[0]),
      title: "Make the thing. Share the thing.",
      detail: "Make room for independent work and the people who make it possible.",
      isActive: true,
    },
  ]);
  const calendars = own(data.calendars);
  calendars.forEach((c, i) => {
    c.name = ["Personal", "After the rain", "People"][i] ?? c.name;
  });
  const eventBase = required(own(data.calendarEvents)[0]);
  const events: Array<[string, number, number, number, number]> = [
    ["Final color grade", -3, 10, 12, 1],
    ["Sound mix approved", -3, 14, 15, 1],
    ["DCP playback check", -2, 10, 11, 1],
    ["Poster artwork approved", -2, 13, 14, 1],
    ["Cinema walkthrough", -1, 11, 12, 1],
    ["Cast & crew call", -1, 15, 16, 2],
    ["Guest list · final pass", 0, 10, 11, 1],
    ["Pack the screening kit", 0, 13, 14, 1],
    ["A walk. No screens.", 0, 16, 17, 0],
    ["Doors open · After the rain", 1, 18.5, 19, 1],
    ["After the rain · premiere", 1, 19, 21, 1],
    ["Breakfast with the crew", 2, 11, 12, 2],
  ];
  replace(
    "calendarEvents",
    events.map(([title, offset, start, end, cal], i) => ({
      ...eventBase,
      id: id(950 + i),
      calendarId: calendars[cal]?.id ?? eventBase.calendarId,
      allDay: false,
      title,
      startsAt: at(offset, start),
      endsAt: at(offset, end),
      status: "confirmed",
      transparency: "busy",
      notes: "Fictional premiere-week demo.",
      location: offset === 1 ? "The Lantern Cinema" : null,
    })),
  );
  const threads = own(data.mailThreads);
  const subjects = [
    "You're all set for tomorrow's screening",
    "Final mix delivered — sounds beautiful",
    "Your posters are ready",
    "86 guests. One very full room.",
    "After the rain — the final cut",
  ];
  const senders = [
    "Maya Chen · Lantern Cinema",
    "Sam Rivera · Sound",
    "Paper Room",
    "June Park",
    "Priya Shah · Editor",
  ];
  const bodies = [
    "Hi Alex,\n\nWe tested the DCP this morning. Picture and sound are perfect. The room is yours tomorrow.\n\nDoors: 6:30 pm\nScreening: 7:00 pm\nQ&A: 7:25 pm\nCapacity: 90 seats\n\nYour booking is paid in full. Send the final guest list whenever you're ready and we'll handle the door.\n\nYou made a film. Now let's fill a room.\n\nMaya",
    "Final mix and stems are uploaded. Thank you for the payment — everything is settled. That last scene really lands. See you at the premiere!\n\nSam",
    "Your 20 A3 posters are printed and ready for pickup. We kept the soft blue exactly as approved. Open until 6 today.\n\nPaper Room",
    "The guest list is at 86, including the whole cast and crew. Four seats spare for last-minute additions. I'll be there early to help with the door.\n\nJune",
    "Final picture is locked, captions checked, credits approved. It's been a joy making this with you. See you in the front row.\n\nPriya",
  ];
  threads.forEach((t, i) => {
    t.subject = subjects[i] ?? t.subject;
    t.bodyText = bodies[i] ?? "";
    t.snippet = (bodies[i] ?? "").replaceAll("\n", " ").slice(0, 150);
    t.from = { name: required(senders[i]), address: `crew${i}@example.test` };
    t.unread = i === 0;
    t.starred = i === 0;
    t.receivedAt = ago(i + 1);
    t.messageCount = i === 0 ? 2 : 1;
    t.remoteMailboxIds = ["INBOX"];
  });
  const ids = new Set(threads.map((t) => t.id));
  data.mailMessages = data.mailMessages.filter((m) => !ids.has(m.threadId));
  threads.forEach((t, i) => {
    data.mailMessages.push({
      id: id(980 + i),
      threadId: required(t.id),
      from: required(t.from),
      to: [{ address: "demo+full@nohmi.test", name: "Alex Morgan" }],
      bodyText: required(bodies[i]),
      cc: [],
      attachments: [],
      remoteMessageId: `premiere-message-${i}`,
      receivedAt: ago(i + 1),
      createdAt: ago(i + 1),
      updatedAt: now,
    });
  });
  data.mailMessages.push({
    id: id(990),
    threadId: required(threads[0]?.id),
    from: { address: "demo+full@nohmi.test", name: "Alex Morgan" },
    to: [required(threads[0]?.from)],
    bodyText:
      "Thank you, Maya. Film delivered, posters printed, crew paid. I'll send the final guest list this afternoon. Can't wait to see it with everyone.\n\nAlex",
    cc: [],
    attachments: [],
    remoteMessageId: "premiere-reply",
    receivedAt: ago(0.5),
    createdAt: ago(0.5),
    updatedAt: now,
  });
  for (const key of [
    "attentionItems",
    "mailReviews",
    "mailRuleWorkItems",
    "mailStewardshipQuestions",
    "mailThreadDispositions",
    "mailSnoozes",
    "mailDrafts",
    "financeAlerts",
    "financeReviewCases",
    "financeClassificationDecisions",
    "financeRecurringObligations",
  ] as const)
    replace(key, []);
  const categories = own(data.financeCategories);
  const categoryNames = ["Screening", "Production", "Living", "Income", "Post-production"];
  categories.forEach((c, i) => {
    c.name = required(categoryNames[i]);
    c.slug = c.name.toLowerCase().replaceAll(" ", "-");
  });
  const accounts = own(data.financeAccounts);
  accounts.forEach((a, i) => {
    a.name = required(["Film fund", "Next project", "Long-term savings", "Everyday card"][i]);
    a.institution = "Manual account";
    a.currencyCode = "USD";
    a.ownershipType = "individual";
    a.ownershipShareBps = 10000;
    a.balance = required([328000, 600000, 1240000, 0][i]);
  });
  const txBase = required(own(data.financeTransactions)[0]);
  const transactions: Array<[string, number, number, number, "income" | "expense"]> = [
    ["Community film grant", 500000, 3, -14, "income"],
    ["Freelance editing", 180000, 3, -10, "income"],
    ["Lantern Cinema · paid in full", 80000, 0, -2, "expense"],
    ["Sam Rivera · final sound mix", 65000, 4, -3, "expense"],
    ["Paper Room · screening posters", 12000, 0, -1, "expense"],
    ["Color House · final grade", 85000, 4, -5, "expense"],
    ["Crew expenses · settled", 45000, 1, -6, "expense"],
    ["Camera rental · returned", 40000, 1, -8, "expense"],
    ["Premiere refreshments", 25000, 0, 0, "expense"],
  ];
  replace(
    "financeTransactions",
    transactions.map(([merchant, amount, cat, offset, direction], i) => ({
      ...txBase,
      id: id(1000 + i),
      accountId: required(accounts[0]?.id),
      merchant,
      amount,
      category: categoryNames[cat],
      categoryId: categories[cat]?.id,
      currencyCode: "USD",
      categorySource: "user",
      categoryConfidence: 10000,
      merchantId: null,
      direction,
      transactionDate: day(offset),
      needsReview: false,
      pending: false,
      providerTransactionId: null,
      transferGroupId: null,
    })),
  );
  const budgetBase = required(own(data.financeBudgets)[0]);
  replace(
    "financeBudgets",
    [
      [0, 140000],
      [1, 100000],
      [4, 180000],
    ].map(([cat, limit], i) => ({
      ...budgetBase,
      id: id(1020 + i),
      category: required(categoryNames[required(cat)]),
      limit: required(limit),
      month: day(0).slice(0, 7),
    })),
  );
  own(data.financeProfiles).forEach((p) => {
    p.employer = "Independent";
    p.role = "Filmmaker & editor";
    p.employmentType = "self_employed";
    p.expectedNetPay = 360000;
    p.grossAnnualIncome = 6000000;
    p.payFrequency = "irregular";
  });
  own(data.financeIncomeStreams).forEach((p) => {
    p.displayName = "Freelance editing";
    p.payer = "Editing clients";
    p.expectedAmount = 180000;
  });
}
