import React from "react";
import { Search } from "lucide-react";

interface SearchBarProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: boolean;
}

/** Reference search / AI-prompt bar: raised fill, subtle border, left icon. */
export const SearchBar: React.FC<SearchBarProps> = ({
  label,
  icon = true,
  style,
  ...rest
}) => (
  <label style={{ display: "block", width: "100%" }}>
    {label && (
      <span
        style={{
          display: "block",
          fontSize: 12,
          color: "#9a9aa0",
          marginBottom: 6,
        }}
      >
        {label}
      </span>
    )}
    <span style={{ position: "relative", display: "block", width: "100%" }}>
      {icon && (
        <Search
          size={15}
          style={{
            position: "absolute",
            left: 13,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#9a9aa0",
            pointerEvents: "none",
          }}
        />
      )}
      <input
        {...rest}
        style={{
          width: "100%",
          minHeight: "40px",
          background: "#1a1a1f",
          border: "1px solid #26262c",
          borderRadius: "12px",
          color: "#f5f5f6",
          fontSize: 13,
          padding: icon ? "0 14px 0 36px" : "0 14px",
          outline: "none",
          fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          boxSizing: "border-box",
          ...style,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "#8fb0ff";
          e.currentTarget.style.boxShadow = "0 0 0 2px rgb(143 176 255 / 60%)";
          rest.onFocus?.(e as React.FocusEvent<HTMLInputElement>);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "#26262c";
          e.currentTarget.style.boxShadow = "none";
          rest.onBlur?.(e as React.FocusEvent<HTMLInputElement>);
        }}
      />
    </span>
  </label>
);
