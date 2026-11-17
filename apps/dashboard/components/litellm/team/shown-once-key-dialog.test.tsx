import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ShownOnceKeyDialog } from "./shown-once-key-dialog";

// Source: LiteLLM spec - Writes (generateMemberKey, rotateKey: the key value
// is shown once); Design System - Management pages (shown-once dialog); L5b
// review warning (Slice B2b): focus returns to the button that opened the
// dialog; with no ref the dialog calls no preventDefault, so it never sends
// focus nowhere. Contract: `returnFocusRef` becomes optional.
function Harness() {
  const [open, setOpen] = useState(true);
  const target = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={target}>opener</button>
      {open ? (
        <ShownOnceKeyDialog
          value="sk-TEST"
          returnFocusRef={target}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

describe("ShownOnceKeyDialog focus return (L5b review warning)", () => {
  it("focuses the given button when it closes", async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "opener" })).toHaveFocus(),
    );
  });

  it("closes without a ref and without throwing", async () => {
    const onClose = vi.fn();
    render(<ShownOnceKeyDialog value="sk-TEST" onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
