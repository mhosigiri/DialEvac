import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MoreHorizontal } from "lucide-react";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  checked?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
};

const WIDTH = 224;
const EDGE = 8;

/** Reference "..." column menu. Fixed to the viewport because the board scrolls sideways and would clip it. */
export const Menu: React.FC<{ label: string; items: MenuItem[] }> = ({ label, items }) => {
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = (restoreFocus = false) => {
    setPosition(undefined);
    if (restoreFocus) trigger.current?.focus();
  };

  const open = () => {
    const box = trigger.current!.getBoundingClientRect();
    setPosition({ top: box.bottom + 6, left: Math.max(EDGE, Math.min(box.right - WIDTH, window.innerWidth - WIDTH - EDGE)) });
  };

  const isOpen = position !== undefined;
  useEffect(() => {
    if (!isOpen) return;
    panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const dismiss = (event: Event) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const dismissMove = () => close();
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", dismissMove);
    window.addEventListener("scroll", dismissMove, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", dismissMove);
      window.removeEventListener("scroll", dismissMove, true);
    };
  }, [isOpen]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...panel.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : open())}
        style={{ width: 32, height: 32, borderRadius: 999, background: "#1a1a1f", border: "1px solid #26262c", color: "#c2c2c9", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {position &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            style={{ position: "fixed", zIndex: 60, ...position, width: WIDTH, padding: 6, background: "#1a1a1f", border: "1px solid #33333a", borderRadius: 14, boxShadow: "0 12px 32px rgb(0 0 0 / 55%)" }}
          >
            {items.map((item) => (
              <React.Fragment key={item.label}>
                {item.separatorBefore && <div role="separator" style={{ height: 1, margin: "6px 4px", background: "#26262c" }} />}
                <button
                  type="button"
                  role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  onClick={() => {
                    item.onSelect();
                    close(true);
                  }}
                  className="eoc-menu-item"
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 34, padding: "0 10px", border: "none", borderRadius: 9, background: "transparent", fontSize: 13, textAlign: "left", color: item.disabled ? "#6b6b72" : "#f5f5f6", cursor: item.disabled ? "default" : "pointer" }}
                >
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.checked && <Check className="w-3.5 h-3.5" style={{ color: "#c2c2c9" }} />}
                </button>
              </React.Fragment>
            ))}
          </div>,
          document.body
        )}
    </>
  );
};
