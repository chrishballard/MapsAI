"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  FileText,
  MessageSquare,
  BarChart3,
  Settings,
  LayoutDashboard,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/profiles", label: "Businesses", icon: Building2 },
  { href: "/dashboard/posts", label: "Posts", icon: FileText },
  { href: "/dashboard/reviews", label: "Reviews", icon: MessageSquare },
  { href: "/dashboard/reports", label: "Reports", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-zinc-200 bg-white flex flex-col h-screen sticky top-0">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
            R
          </div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">
            Rankmaps
          </h1>
        </div>
        <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
          AI Local SEO
        </p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all group",
                isActive
                  ? "bg-brand-50 text-brand-700"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              )}
            >
              <Icon
                className={cn(
                  "w-5 h-5 transition-colors",
                  isActive
                    ? "text-brand-600"
                    : "text-zinc-400 group-hover:text-zinc-600"
                )}
              />
              {item.label}
              {isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 mt-auto">
        <div className="bg-zinc-900 rounded-xl p-4 text-white relative overflow-hidden group cursor-pointer">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-brand-500/20 rounded-full blur-2xl transition-all group-hover:scale-150" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-brand-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-brand-400">
                Pro Plan
              </span>
            </div>
            <p className="text-sm font-medium mb-3">
              Unlock advanced AI features
            </p>
            <button className="w-full bg-white text-zinc-900 text-xs font-bold py-2 rounded-lg hover:bg-zinc-100 transition-colors">
              Upgrade Now
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
