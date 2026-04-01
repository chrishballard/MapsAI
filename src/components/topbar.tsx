"use client";

import { signOut, useSession } from "next-auth/react";
import { Search, Bell, LogOut, ChevronDown } from "lucide-react";
import { BusinessSelector } from "./business-selector";

export function Topbar() {
  const { data: session } = useSession();

  const initials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : session?.user?.email?.[0]?.toUpperCase() ?? "U";

  return (
    <header className="h-16 border-b border-zinc-200 bg-white/80 backdrop-blur-md sticky top-0 z-30 px-8 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <BusinessSelector />
        <div className="relative max-w-sm hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search..."
            className="w-full pl-10 pr-4 py-2 bg-zinc-100 border-transparent focus:bg-white focus:border-zinc-200 focus:ring-4 focus:ring-zinc-100 rounded-xl text-sm transition-all outline-none"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className="p-2 text-zinc-500 hover:bg-zinc-100 rounded-lg transition-colors relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 border-2 border-white rounded-full" />
        </button>

        <div className="h-8 w-px bg-zinc-200" />

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-3 pl-2 pr-3 py-1 hover:bg-zinc-50 rounded-xl transition-colors group"
        >
          <div className="w-9 h-9 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold border-2 border-white shadow-sm">
            {initials}
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-zinc-900 leading-none">
              {session?.user?.name ?? session?.user?.email ?? "User"}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">Sign Out</p>
          </div>
          <LogOut className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600 transition-colors" />
        </button>
      </div>
    </header>
  );
}
