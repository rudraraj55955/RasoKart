import type { ReactNode, ElementType } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  icon: ElementType;
  color: string;
  bg: string;
  href: string;
  loading?: boolean;
}

export function KpiCard({ label, value, icon: Icon, color, bg, href, loading }: KpiCardProps) {
  return (
    <Link href={href}>
      <Card className="border-border/50 cursor-pointer hover:border-border/80 transition-colors">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${loading ? "animate-pulse text-muted-foreground" : color}`}>
                {loading ? "…" : value}
              </p>
            </div>
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
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
