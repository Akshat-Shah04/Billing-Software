import type { Settings } from "../types";

/** True when Settings has at least one payment detail filled in (otherwise bills print no payment section). */
export function hasPaymentDetails(org: Settings): boolean {
  return [org.bank_account_holder, org.bank_name, org.bank_account_number, org.bank_ifsc, org.bank_branch, org.upi_id, org.payment_instructions].some(
    (v) => (v ?? "").trim() !== "",
  );
}

/** The firm's bank / UPI details, shown on a bill so the client knows where to pay. Shows nothing if empty. */
export default function PaymentDetails({ org }: { org: Settings | null }) {
  if (!org) return null;
  const lines: [string, string][] = (
    [
      ["Account name", org.bank_account_holder],
      ["Bank", org.bank_name],
      ["Account number", org.bank_account_number],
      ["IFSC", org.bank_ifsc],
      ["Branch", org.bank_branch],
      ["UPI ID", org.upi_id],
    ] as [string, string][]
  ).filter(([, value]) => value);
  if (lines.length === 0 && !org.payment_instructions) return null;

  return (
    <div className="pay-box">
      <div className="muted small">Payment details: please pay to</div>
      <table className="pay-table">
        <tbody>
          {lines.map(([label, value]) => (
            <tr key={label}>
              <td className="muted">{label}</td>
              <td>
                <strong>{value}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {org.payment_instructions && <div style={{ whiteSpace: "pre-line" }}>{org.payment_instructions}</div>}
    </div>
  );
}
