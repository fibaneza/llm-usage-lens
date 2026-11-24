import { OPERATION_INFO } from "./operation-families";

type Op = {
  name: string;
  enabled: boolean;
  source: string;
  unavailable?: string;
};

function OperationRow({
  op,
  canEdit,
  pending,
  onToggle,
}: {
  op: Op;
  canEdit: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  // Source `file` means config.yaml sets the operation: shown, never edited
  // here (System Architecture — Configuration file, A6; the server refuses a
  // write regardless, T39).
  const locked = op.source === "file" || op.unavailable !== undefined;
  const description =
    OPERATION_INFO[op.name]?.description ?? "Unknown operation";
  return (
    <li
      data-testid={`litellm-op-${op.name}`}
      className="flex items-center justify-between gap-3 py-1 text-sm"
    >
      <span className="flex min-w-0 flex-col">
        <span className="font-mono">{op.name}</span>
        <span
          data-testid={`litellm-op-desc-${op.name}`}
          className="text-muted-foreground text-xs"
        >
          {description}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span
          id={`litellm-op-source-${op.name}`}
          data-testid={`litellm-op-source-${op.name}`}
          className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs"
        >
          {op.unavailable ?? (locked ? "Set in config.yaml" : op.source)}
        </span>
        {canEdit ? (
          <button
            type="button"
            role="switch"
            aria-checked={op.enabled}
            aria-label={op.name}
            aria-describedby={
              locked ? `litellm-op-source-${op.name}` : undefined
            }
            disabled={pending || locked}
            onClick={onToggle}
            className={`focus-visible:ring-ring relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 ${
              op.enabled ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              aria-hidden="true"
              className={`bg-background block size-4 rounded-full transition-transform ${
                op.enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        ) : (
          <span className="w-8 text-right">{op.enabled ? "On" : "Off"}</span>
        )}
      </span>
    </li>
  );
}

export function OperationGroup({
  id,
  label,
  description,
  ops,
  canEdit,
  pending,
  onToggle,
}: {
  id: string;
  label: string;
  description: string;
  ops: Op[];
  canEdit: boolean;
  pending: boolean;
  onToggle: (op: string, enabled: boolean) => void;
}) {
  const descId = `litellm-group-desc-${id}`;
  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={descId}
      className="flex flex-col gap-1"
    >
      <h4 className="text-sm font-medium">{label}</h4>
      <p id={descId} className="text-muted-foreground text-xs">
        {description}
      </p>
      <ul className="divide-border divide-y">
        {ops.map((op) => (
          <OperationRow
            key={op.name}
            op={op}
            canEdit={canEdit}
            pending={pending}
            onToggle={() => onToggle(op.name, !op.enabled)}
          />
        ))}
      </ul>
    </div>
  );
}
