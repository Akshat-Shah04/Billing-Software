import { describe, expect, it } from "vitest";
import { calculateTotals } from "../src/lib/money.js";

describe("calculateTotals", () => {
  it("adds up line items with no GST", () => {
    const t = calculateTotals(
      [
        { quantity: 2, unit_price_paise: 150_000 },
        { quantity: 1, unit_price_paise: 50_050 },
      ],
      0,
    );
    expect(t).toEqual({ subtotal_paise: 350_050, gst_paise: 0, reimbursement_paise: 0, total_paise: 350_050 });
  });

  it("applies 18% GST exactly", () => {
    const t = calculateTotals([{ quantity: 1, unit_price_paise: 100_000 }], 18);
    expect(t).toEqual({ subtotal_paise: 100_000, gst_paise: 18_000, reimbursement_paise: 0, total_paise: 118_000 });
  });

  it("rounds half a paisa up", () => {
    // 5 paise * 10% = 0.5 paise -> rounds to 1
    expect(calculateTotals([{ quantity: 1, unit_price_paise: 5 }], 10).gst_paise).toBe(1);
    // 4 paise * 10% = 0.4 paise -> rounds to 0
    expect(calculateTotals([{ quantity: 1, unit_price_paise: 4 }], 10).gst_paise).toBe(0);
  });

  it("handles fractional rates without floating point drift", () => {
    // 2.5% of 10.00 rupees = 0.25 rupees = 25 paise
    expect(calculateTotals([{ quantity: 1, unit_price_paise: 1000 }], 2.5).gst_paise).toBe(25);
  });
});
