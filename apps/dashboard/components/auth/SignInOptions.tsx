type SignInOptionsProps = {
  entra: boolean;
  devLogin: boolean;
  entraAction: () => Promise<void>;
  devLoginAction: () => Promise<void>;
};

const BUTTON_CLASS =
  "bg-primary text-primary-foreground ring-ring rounded-md px-5 py-2.5 font-medium outline-none focus-visible:ring-2";

export function SignInOptions({
  entra,
  devLogin,
  entraAction,
  devLoginAction,
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
        <form action={devLoginAction}>
          <button type="submit" className={BUTTON_CLASS}>
            Sign in as local developer
          </button>
        </form>
      ) : null}
    </div>
  );
}
