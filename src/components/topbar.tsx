"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";

export function Topbar() {
  const { data: session } = useSession();

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-6">
      <div />
      <div className="flex items-center gap-4">
        {session?.user && (
          <span className="text-sm text-gray-600">{session.user.email}</span>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </header>
  );
}
