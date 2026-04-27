import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { DisconnectButton } from "./disconnect-button";
import { PromptTemplates } from "./prompt-templates";
import { SettingsTabs } from "./settings-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button-variants";
import { MotionDiv } from "@/components/motion-wrapper";

export default async function SettingsPage() {
  const [googleAccounts, promptTemplates] = await Promise.all([
    prisma.googleAccount.findMany({
      include: { _count: { select: { profiles: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.promptTemplate.findMany({
      include: { profile: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const accountsPanel = (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Connected Google Accounts</CardTitle>
          <p className="text-sm text-zinc-500 mt-1">
            Manage your Google Business Profile connections.
          </p>
        </div>
        <a
          href="/api/auth/google"
          className={buttonVariants({ size: "sm", className: "gap-2" })}
        >
          <Plus size={14} />
          Add Account
        </a>
      </CardHeader>

      {googleAccounts.length === 0 ? (
        <CardContent className="py-8 text-center text-zinc-500">
          No Google accounts connected yet.
        </CardContent>
      ) : (
        <CardContent className="space-y-4">
          {googleAccounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between py-2"
            >
              <div>
                <p className="text-sm font-bold text-zinc-900">
                  {account.googleEmail}
                </p>
                <p className="text-xs text-zinc-500">
                  {account._count.profiles} profile
                  {account._count.profiles !== 1 ? "s" : ""} &middot;
                  Connected{" "}
                  {account.createdAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <DisconnectButton
                accountId={account.id}
                email={account.googleEmail}
              />
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );

  const promptsPanel = (
    <Card>
      <PromptTemplates templates={promptTemplates} />
    </Card>
  );

  return (
    <MotionDiv
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <div>
        <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
          Settings
        </h1>
        <p className="text-zinc-500 mt-1">
          Manage your account preferences and configurations.
        </p>
      </div>

      <SettingsTabs accountsPanel={accountsPanel} promptsPanel={promptsPanel} />
    </MotionDiv>
  );
}
