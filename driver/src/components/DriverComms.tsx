import React, { useState } from "react";
import type { Message } from "../module_bindings/types";

interface DriverCommsProps {
  householdId?: bigint;
  messages: readonly Message[];
  onSendMessage: (text: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

const QUICK_STATUSES = [
  "⚡ Copy dispatch, rolling now",
  "📍 Arrived on scene at address",
  "♿ Resident safely on board",
  "⚠️ High water obstacle, taking detour",
  "🏁 Arrived at shelter, dropoff complete",
];

export const DriverComms: React.FC<DriverCommsProps> = ({
  householdId,
  messages,
  onSendMessage,
  isOpen,
  onClose,
}) => {
  const [customText, setCustomText] = useState("");

  if (!isOpen) return null;

  // Messages for active case or field comms
  const relevantMessages = householdId
    ? messages.filter((m) => m.householdId === householdId)
    : messages;

  const sortedMessages = [...relevantMessages].sort(
    (a, b) => Number(a.at.toMillis() - b.at.toMillis())
  );

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    onSendMessage(text.trim());
    setCustomText("");
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#131316] border border-[#26262c] rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#26262c]">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full bg-[#8fb0ff] animate-pulse" />
            <div>
              <h3 className="text-base font-bold text-[#f5f5f6]">Dispatch Radio & Comms</h3>
              <p className="text-[11px] text-[#a3a3aa]">Direct tactical channel with EOC Dispatchers</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[#1a1a1f] hover:bg-[#26262c] text-[#c2c2c9] flex items-center justify-center text-sm font-bold"
          >
            ✕
          </button>
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto no-scrollbar py-3 space-y-2.5 min-h-[160px] max-h-[300px]">
          {sortedMessages.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#a3a3aa] italic">
              No messages exchanged yet. Use quick status buttons below to report field telemetry to EOC.
            </div>
          ) : (
            sortedMessages.map((m) => {
              const isFromDispatch = m.direction === "out";
              return (
                <div
                  key={m.id.toString()}
                  className={`p-3 rounded-xl max-w-[85%] text-xs leading-relaxed ${
                    isFromDispatch
                      ? "bg-[#1a1a1f] border border-[#2e2e36] text-[#f5f5f6] mr-auto"
                      : "bg-[#8fb0ff]/15 border border-[#8fb0ff]/30 text-[#f5f5f6] ml-auto"
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center justify-between gap-3 text-[#a3a3aa]">
                    <span>{isFromDispatch ? "EOC Dispatcher" : "Vehicle 104"}</span>
                  </div>
                  <div>{m.body}</div>
                </div>
              );
            })
          )}
        </div>

        {/* Quick Status Buttons */}
        <div className="py-2 border-t border-[#26262c] space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#a3a3aa]">
            Quick Status Reports:
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {QUICK_STATUSES.map((status, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSend(status)}
                className="text-left px-3 py-2 rounded-xl bg-[#1a1a1f] hover:bg-[#26262c] border border-[#2e2e36] text-xs text-[#c2c2c9] hover:text-white transition-colors active:scale-95 truncate"
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Text Input */}
        <div className="pt-2 flex items-center gap-2">
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend(customText)}
            placeholder="Type status or question to dispatcher..."
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#1a1a1f] border border-[#2e2e36] text-xs text-[#f5f5f6] focus:border-[#8fb0ff] focus:outline-none"
          />
          <button
            type="button"
            disabled={!customText.trim()}
            onClick={() => handleSend(customText)}
            className="px-4 py-2.5 rounded-xl bg-[#8fb0ff] hover:bg-[#a8c4ff] text-black font-bold text-xs disabled:opacity-40 transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};
