/** Accessible on/off switch (role="switch"), styled to the page tokens. */
export function Switch({ id, checked, onCheckedChange }: { id?: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)}
      style={{
        width: 38, height: 22, borderRadius: 11, padding: 2, border: "1px solid var(--rule)", cursor: "pointer",
        background: checked ? "color-mix(in oklab, var(--signal) 35%, var(--panel))" : "var(--panel)",
        display: "inline-flex", alignItems: "center", transition: "background 200ms",
      }}>
      <span style={{
        width: 16, height: 16, borderRadius: "50%", background: checked ? "var(--signal)" : "var(--faint)",
        transform: `translateX(${checked ? 16 : 0}px)`, transition: "transform 220ms cubic-bezier(.2,.7,.2,1), background 200ms",
      }} />
    </button>
  );
}
