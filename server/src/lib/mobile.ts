import { z } from "zod";
import { optionalText } from "./paging.js";

/**
 * An Indian mobile number as 10 digits, or null when it is not one.
 * Spaces, dashes and brackets are ignored, and a leading +91, 91 or 0 is removed, so "+91 98250 12345",
 * "098250-12345" and "9825012345" all become "9825012345". Mobile numbers start with 6, 7, 8 or 9.
 */
export function normalizeMobile(input: string): string | null {
  let d = input.replace(/[\s\-().]/g, "");
  if (/^\+91\d{10}$/.test(d)) d = d.slice(3);
  else if (/^91\d{10}$/.test(d)) d = d.slice(2);
  else if (/^0\d{10}$/.test(d)) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export const MOBILE_MESSAGE = "must be a 10-digit mobile number, for example 9825012345";

/** An optional mobile number field: empty means none; anything else must be a valid 10-digit mobile number. */
export const optionalMobile = () =>
  optionalText(20).transform((v, ctx) => {
    if (v === null) return null;
    const m = normalizeMobile(v);
    if (!m) {
      ctx.addIssue({ code: "custom", message: MOBILE_MESSAGE });
      return z.NEVER;
    }
    return m;
  });
