export interface LineInput {
  quantity: number;
  unit_price_paise: number;
}

export interface Totals {
  subtotal_paise: number;
  gst_paise: number;
  total_paise: number;
}

/**
 * All amounts are integer paise. GST uses integer maths on basis points
 * (18% = 1800 bp) and rounds half up, so the result is exact and repeatable.
 */
export function calculateTotals(items: LineInput[], gstRatePercent: number): Totals {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price_paise, 0);
  const rateBp = Math.round(gstRatePercent * 100);
  const gst = Math.floor((subtotal * rateBp + 5000) / 10000);
  return { subtotal_paise: subtotal, gst_paise: gst, total_paise: subtotal + gst };
}
