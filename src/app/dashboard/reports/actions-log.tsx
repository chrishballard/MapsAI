import { CheckCircle2, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ActionLogItem } from "@/lib/report-metrics";

interface ActionsLogProps {
  items: ActionLogItem[];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getTypeLabel(type: ActionLogItem["type"]): string {
  if (type === "post") return "Post";
  if (type === "review_reply") return "Review";
  return "Description";
}

export function ActionsLog({ items }: ActionsLogProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Completed Actions</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-400 gap-3">
            <FileText size={32} />
            <p className="text-sm">No actions taken in this period</p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <div
                key={`${item.type}-${item.id}`}
                className="flex items-center justify-between p-4 rounded-xl border border-zinc-100 hover:bg-zinc-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-emerald-50 text-emerald-600">
                    <CheckCircle2 size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">
                      {item.label} for{" "}
                      <span className="text-brand-600">{item.profileName}</span>
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase tracking-wider"
                      >
                        {getTypeLabel(item.type)}
                      </Badge>
                      <span className="text-xs text-zinc-400">
                        {formatDate(item.time)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
