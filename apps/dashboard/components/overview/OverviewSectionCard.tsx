import type { ReactNode } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type OverviewSectionCardProps = {
  title: string;
  boundaryTitle: string;
  className?: string;
  resetKeys?: readonly unknown[];
  onRetry?: () => void;
  children: ReactNode;
};

// Titled card shared by the overview's chart and sync sections. The title sits
// outside the boundary so a failing or loading section keeps its heading; each
// section is its own boundary (Rule 40.4, 60.12).
export function OverviewSectionCard({
  title,
  boundaryTitle,
  className,
  resetKeys,
  onRetry,
  children,
}: OverviewSectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SectionBoundary
          title={boundaryTitle}
          resetKeys={resetKeys}
          onRetry={onRetry}
        >
          {children}
        </SectionBoundary>
      </CardContent>
    </Card>
  );
}
