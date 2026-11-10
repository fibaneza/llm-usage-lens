import { GLOBAL_ROLES, INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";

type SignInOptionsProps = {
  entra: boolean;
  devLogin: boolean;
  master?: boolean;
  entraAction: () => Promise<void>;
  devLoginAction: (formData: FormData) => Promise<void>;
  masterAction?: (formData: FormData) => Promise<void>;
};

const BUTTON_CLASS =
  "bg-primary text-primary-foreground ring-ring rounded-md px-5 py-2.5 font-medium outline-none focus-visible:ring-2";
const FIELD_CLASS =
  "border-border bg-background text-foreground ring-ring rounded-md border px-3 py-2 outline-none focus-visible:ring-2";

export function SignInOptions({
  entra,
  devLogin,
  master = false,
  entraAction,
  devLoginAction,
  masterAction,
}: SignInOptionsProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      {entra ? (
        <form action={entraAction}>
          <button type="submit" className={BUTTON_CLASS}>
            Sign in with Microsoft
          </button>
        </form>
      ) : null}
      {devLogin ? (
        <form action={devLoginAction} className="flex flex-col gap-3">
          <label className="text-foreground flex flex-col gap-1 text-left text-sm">
            Role
            <select
              name="role"
              defaultValue={INTERNAL_ADMIN_ROLE}
              className={FIELD_CLASS}
            >
              {GLOBAL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={BUTTON_CLASS}>
            Sign in as local developer
          </button>
        </form>
      ) : null}
      {master && masterAction ? (
        <form action={masterAction} className="flex flex-col gap-3">
          <input
            name="username"
            autoComplete="username"
            aria-label="Username"
            required
            className={FIELD_CLASS}
          />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            aria-label="Password"
            required
            className={FIELD_CLASS}
          />
          <input
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Authenticator code"
            className={FIELD_CLASS}
          />
          <button type="submit" className={BUTTON_CLASS}>
            Sign in as master user
          </button>
        </form>
      ) : null}
    </div>
  );
}
