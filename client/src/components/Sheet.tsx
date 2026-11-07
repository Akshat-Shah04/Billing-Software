import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  /** One line under the title saying what this does. */
  subtitle?: ReactNode;
  onClose: () => void;
  /** When given, the sheet is a form and the primary button submits it. */
  onSubmit?: () => void;
  submitLabel?: string;
  busy?: boolean;
  /** "danger" makes the confirm button red (cancelling a bill, voiding a payment). */
  tone?: "default" | "danger";
  wide?: boolean;
  submitDisabled?: boolean;
  children: ReactNode;
}

/**
 * A modal sheet on the native <dialog>: focus stays inside, Escape closes it, and there is always a visible
 * Cancel next to the main button. Only one is open at a time.
 */
export default function Sheet({ open, title, subtitle, onClose, onSubmit, submitLabel = "Save", busy, tone = "default", wide, submitDisabled, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet${wide ? " wide" : ""}`}
      aria-labelledby="sheet-title"
      onCancel={(e) => {
        // Escape: close through React state so the dialog and the state never disagree.
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      {open && (
        <form
          style={{ display: "contents" }}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit?.();
          }}
        >
          <div className="sheet-head">
            <h2 id="sheet-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="sheet-body">{children}</div>
          <div className="sheet-foot material">
            <button type="button" onClick={onClose} disabled={busy}>
              {onSubmit ? "Cancel" : "Close"}
            </button>
            {onSubmit && (
              <button type="submit" className={tone === "danger" ? "danger filled" : "primary"} disabled={busy || submitDisabled}>
                {busy ? "Working…" : submitLabel}
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}
