"use client";

import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Component, Suspense, type ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SectionBoundaryProps = {
  title: string;
  fallback?: ReactNode;
  // An errored boundary clears itself when any of these values changes (e.g.
  // the page's date range), without a Retry click.
  resetKeys?: readonly unknown[];
  // Runs after a Retry click, so a parent can reset sibling boundaries that
  // share the failed query.
  onRetry?: () => void;
  // Rendered above the alert while the section is in error, for controls the
  // user needs to change the request that failed.
  errorControls?: ReactNode;
  children: ReactNode;
};

type ErrorBoundaryProps = {
  title: string;
  errorControls?: ReactNode;
  resetKeys: readonly unknown[];
  onReset: () => void;
  children: ReactNode;
};

type ErrorBoundaryState = { hasError: boolean };

// React has no hook-based error boundary, so this is the one place a class
// component is required. It isolates one failing section from the page
// (Rule 40.4, 60.12; Design System -- Component Inventory, `ErrorBoundary`).
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidUpdate(prev: ErrorBoundaryProps) {
    if (!this.state.hasError) return;
    const { resetKeys } = this.props;
    const changed =
      resetKeys.length !== prev.resetKeys.length ||
      resetKeys.some((key, i) => !Object.is(key, prev.resetKeys[i]));
    if (changed) this.setState({ hasError: false });
  }

  private readonly retry = () => {
    this.props.onReset();
    this.setState({ hasError: false });
  };

  override render() {
    if (!this.state.hasError) return this.props.children;

    const alert = (
      <Alert
        variant="destructive"
        className="flex items-center justify-between gap-3 py-2"
      >
        <p className="text-cell font-medium">{`Couldn't load ${this.props.title}.`}</p>
        <Button type="button" variant="outline" size="sm" onClick={this.retry}>
          Retry
        </Button>
      </Alert>
    );
    if (this.props.errorControls === undefined) return alert;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          {this.props.errorControls}
        </div>
        {alert}
      </div>
    );
  }
}

export function SectionBoundary({
  title,
  fallback,
  resetKeys = [],
  onRetry,
  errorControls,
  children,
}: SectionBoundaryProps) {
  // Clears TanStack Query's error state so Retry refetches a query that threw
  // into this boundary instead of re-throwing its cached error.
  const { reset } = useQueryErrorResetBoundary();

  return (
    <ErrorBoundary
      title={title}
      errorControls={errorControls}
      resetKeys={resetKeys}
      onReset={() => {
        reset();
        onRetry?.();
      }}
    >
      <Suspense fallback={fallback ?? <Skeleton className="h-40 w-full" />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
