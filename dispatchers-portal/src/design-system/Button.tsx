import React from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const HEIGHT: Record<ButtonSize, string> = {
  sm: "32px",
  md: "40px",
  lg: "48px",
};

const PAD_X: Record<ButtonSize, string> = { sm: "12px", md: "16px", lg: "20px" };

function styleFor(variant: ButtonVariant): React.CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: "#ffffff",
        color: "#0a0a0c",
        border: "1px solid transparent",
      };
    case "secondary":
      return {
        background: "#1a1a1f",
        color: "#f5f5f6",
        border: "1px solid #2e2e36",
      };
    case "ghost":
      return {
        background: "transparent",
        color: "#c2c2c9",
        border: "1px solid transparent",
      };
    case "danger":
      return {
        background: "rgb(248 113 113 / 14%)",
        color: "#f87171",
        border: "1px solid rgb(248 113 113 / 35%)",
      };
    case "success":
      return {
        background: "#3dd68c",
        color: "#0a0a0c",
        border: "1px solid transparent",
      };
  }
}

function hoverFor(variant: ButtonVariant): string {
  switch (variant) {
    case "primary":
      return "#e4e4e9";
    case "secondary":
      return "#232329";
    case "ghost":
      return "#232329";
    case "danger":
      return "rgb(248 113 113 / 14%)";
    case "success":
      return "#2fbf7d";
  }
}

/** Primary white / secondary outline / ghost / danger / success. */
export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  loading = false,
  leadingIcon,
  trailingIcon,
  fullWidth = false,
  disabled,
  style,
  children,
  ...rest
}) => {
  const isDisabled = disabled || loading;
  return (
    <button
      disabled={isDisabled}
      style={{
        ...styleFor(variant),
        minHeight: HEIGHT[size],
        paddingLeft: PAD_X[size],
        paddingRight: PAD_X[size],
        paddingTop: size === "sm" ? 6 : 8,
        paddingBottom: size === "sm" ? 6 : 8,
        boxSizing: "border-box",
        borderRadius: "10px",
        fontSize: size === "sm" ? 12.5 : 13.5,
        fontWeight: 600,
        letterSpacing: "-0.005em",
        lineHeight: 1.25,
        width: fullWidth ? "100%" : undefined,
        maxWidth: "100%",
        minWidth: 0,
        opacity: isDisabled ? 0.5 : 1,
        cursor: isDisabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        whiteSpace: "normal",
        overflowWrap: "break-word",
        textAlign: "center",
        flexShrink: 1,
        transition: "background 140ms ease, color 140ms ease, border-color 140ms ease, transform 80ms ease",
        fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
      onMouseEnter={(e) => {
        if (isDisabled) return;
        e.currentTarget.style.background = hoverFor(variant);
      }}
      onMouseLeave={(e) => {
        if (isDisabled) return;
        Object.assign(e.currentTarget.style, styleFor(variant));
      }}
      onMouseDown={(e) => {
        if (isDisabled) return;
        e.currentTarget.style.transform = "translateY(1px)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
      {...rest}
    >
      {leadingIcon}
      {loading ? "Loading…" : children}
      {trailingIcon}
    </button>
  );
};
