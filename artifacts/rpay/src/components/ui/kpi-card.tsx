import type { ReactNode, ElementType } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: ReactNode;
  icon: ElementType;
  color: string;
  bg: string;
  href: string;
  isLoading?: boolean;
  trend?: { value: number; label?: string };
  "aria-label"?: string;
}

export function KpiCard({
  title,
  value,
  icon: Icon,
  color,
  bg,
  href,
  isLoading,
  trend,
  "aria-label": ariaLabel,
}: KpiCardProps) {
  if (isLoading) {
    return (
      <div
        className="animate-pulse rounded-lg border border-border/50 bg-muted/20 h-[88px]"
        aria-label={ariaLabel ?? title}
        aria-busy="true"
      />
    );
  }

  return (
    <Link href={href} aria-label={ariaLabel ?? `${title}: ${value}`}>
      <Card className="border-border/50 cursor-pointer hover:border-border/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <CardContent className="pt-6 pb-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1 mr-3">
              <p className="text-sm text-muted-foreground truncate">{title}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              {trend != null && (
                <p className={`text-xs mt-0.5 flex items-center gap-0.5 ${trend.value >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {trend.value >= 0
                    ? <TrendingUp className="h-3 w-3" />
                    : <TrendingDown className="h-3 w-3" />}
                  {trend.value >= 0 ? "+" : ""}{trend.value}%
                  {trend.label && <span className="text-muted-foreground ml-1">{trend.label}</span>}
                </p>
              )}
            </div>
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bg}`}>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

type GridCols = 2 | 3 | 4 | 5 | 6;

const COLS_CLASS: Record<GridCols, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
};

export function KpiGrid({ children, cols = 5 }: { children: ReactNode; cols?: GridCols }) {
  return (
    <div className={`grid gap-4 ${COLS_CLASS[cols]}`}>
      {children}
    </div>
  );
}
