import React from "react";

export type DriverTab = "offers" | "manifest" | "navigation";

interface DriverBottomNavProps {
  activeTab: DriverTab;
  onChangeTab: (tab: DriverTab) => void;
  pendingOffersCount: number;
  activeStopsCount: number;
}

export const DriverBottomNav: React.FC<DriverBottomNavProps> = ({
  activeTab,
  onChangeTab,
  pendingOffersCount,
  activeStopsCount,
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0c0c0e]/95 backdrop-blur-lg border-t border-[#26262c] px-4 py-2 safe-area-bottom">
      <div className="max-w-md mx-auto grid grid-cols-3 gap-2">
        {/* Offers Tab */}
        <button
          type="button"
          onClick={() => onChangeTab("offers")}
          className={`relative flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all ${
            activeTab === "offers"
              ? "text-[#8fb0ff] bg-[#8fb0ff]/10 font-bold"
              : "text-[#a3a3aa] hover:text-[#f5f5f6] font-medium"
          }`}
        >
          <div className="relative">
            <span className="text-xl">⚡</span>
            {pendingOffersCount > 0 && (
              <span className="absolute -top-1.5 -right-2 px-1.5 py-0.2 min-w-[18px] text-[10px] font-extrabold rounded-full bg-[#e8b84b] text-black flex items-center justify-center animate-bounce shadow-md">
                {pendingOffersCount}
              </span>
            )}
          </div>
          <span className="text-[11px] mt-1 tracking-tight">Live Offers</span>
        </button>

        {/* Manifest / Run List Tab */}
        <button
          type="button"
          onClick={() => onChangeTab("manifest")}
          className={`relative flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all ${
            activeTab === "manifest"
              ? "text-[#8fb0ff] bg-[#8fb0ff]/10 font-bold"
              : "text-[#a3a3aa] hover:text-[#f5f5f6] font-medium"
          }`}
        >
          <div className="relative">
            <span className="text-xl">📋</span>
            {activeStopsCount > 0 && (
              <span className="absolute -top-1.5 -right-2 px-1.5 py-0.2 min-w-[18px] text-[10px] font-extrabold rounded-full bg-[#3dd68c] text-black flex items-center justify-center shadow-md">
                {activeStopsCount}
              </span>
            )}
          </div>
          <span className="text-[11px] mt-1 tracking-tight">Run List</span>
        </button>

        {/* Turn-by-Turn Map Tab */}
        <button
          type="button"
          onClick={() => onChangeTab("navigation")}
          className={`relative flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all ${
            activeTab === "navigation"
              ? "text-[#8fb0ff] bg-[#8fb0ff]/10 font-bold"
              : "text-[#a3a3aa] hover:text-[#f5f5f6] font-medium"
          }`}
        >
          <span className="text-xl">🧭</span>
          <span className="text-[11px] mt-1 tracking-tight">Turn-by-Turn</span>
        </button>
      </div>
    </nav>
  );
};
