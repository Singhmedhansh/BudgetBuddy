"use client";

/** Opens the browser's print dialog, which also offers "Save as PDF". */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-fg transition-all hover:-translate-y-px hover:bg-primary-hover print:hidden">
      Print or save as PDF
    </button>
  );
}
