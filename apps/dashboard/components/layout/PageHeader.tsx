import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ScopeLine } from "@/components/display/ScopeLine";

type PageHeaderProps = {
  breadcrumb?: readonly { label: string; href?: string }[];
  // Entity title on a detail page; the page h1 stays in the top bar.
  title?: string;
  meta?: ReactNode;
  description?: ReactNode;
  scopeLine?: { label: string; names: readonly string[] };
  actions?: ReactNode;
  tabs?: ReactNode;
  // Toolbar slot, rendered last.
  children?: ReactNode;
};

// Design System -- Component Inventory, `PageHeader` and Layout, Page frame:
// breadcrumb, entity title (h2), one-line description, actions, tabs, toolbar.
export function PageHeader({
  breadcrumb,
  title,
  meta,
  description,
  scopeLine,
  actions,
  tabs,
  children,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      {breadcrumb && breadcrumb.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumb.map((crumb, index) => (
              <Fragment key={crumb.label}>
                {index > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {crumb.href ? (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      {title || meta || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {title ? (
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            ) : null}
            {meta}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {description ? (
        <p className="text-cell text-muted-foreground max-w-[72ch]">
          {description}
        </p>
      ) : null}
      {scopeLine ? (
        <ScopeLine label={scopeLine.label} names={scopeLine.names} />
      ) : null}
      {tabs ? <div className="mt-3">{tabs}</div> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
