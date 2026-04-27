"use client";

import { useState, type ReactNode } from "react";
import { Link2, Sparkles, User, Bell, Shield, CreditCard, Globe } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type TabKey =
  | "accounts"
  | "prompts"
  | "profile"
  | "notifications"
  | "security"
  | "billing"
  | "integrations";

interface SettingsTabsProps {
  accountsPanel: ReactNode;
  promptsPanel: ReactNode;
}

const NAV_ITEMS: Array<{ key: TabKey; icon: typeof Link2; label: string }> = [
  { key: "accounts", icon: Link2, label: "Google Accounts" },
  { key: "prompts", icon: Sparkles, label: "Prompt Templates" },
  { key: "profile", icon: User, label: "Profile" },
  { key: "notifications", icon: Bell, label: "Notifications" },
  { key: "security", icon: Shield, label: "Security" },
  { key: "billing", icon: CreditCard, label: "Billing" },
  { key: "integrations", icon: Globe, label: "Integrations" },
];

function ComingSoon({ title }: { title: string }) {
  return (
    <Card className="p-12 text-center">
      <h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
      <p className="text-sm text-zinc-500 mt-2">Coming soon.</p>
    </Card>
  );
}

export function SettingsTabs({ accountsPanel, promptsPanel }: SettingsTabsProps) {
  const [active, setActive] = useState<TabKey>("accounts");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <Card className="h-fit p-2">
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === active;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActive(item.key)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-left",
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-zinc-600 hover:bg-zinc-50"
                )}
              >
                <item.icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </Card>

      <div className="lg:col-span-2 space-y-6">
        {active === "accounts" && accountsPanel}
        {active === "prompts" && promptsPanel}
        {active === "profile" && <ComingSoon title="Profile" />}
        {active === "notifications" && <ComingSoon title="Notifications" />}
        {active === "security" && <ComingSoon title="Security" />}
        {active === "billing" && <ComingSoon title="Billing" />}
        {active === "integrations" && <ComingSoon title="Integrations" />}
      </div>
    </div>
  );
}
