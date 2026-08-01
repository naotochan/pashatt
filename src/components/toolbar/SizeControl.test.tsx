import { describe, it, expect, vi } from "vitest";
import { useState, type ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SizeControl } from "./SizeControl";
import { LocalizationProviderStandalone } from "../../lib/localization";

function renderJa(ui: ReactElement) {
  return render(
    <LocalizationProviderStandalone initialLanguage="japanese">{ui}</LocalizationProviderStandalone>
  );
}

function StatefulSizeControl({
  initial,
  onChange,
}: {
  initial: number;
  onChange: (n: number) => void;
}) {
  const [size, setSize] = useState(initial);
  return (
    <SizeControl
      tool="pen"
      size={size}
      color="#ff0000"
      onChange={(n) => {
        setSize(n);
        onChange(n);
      }}
    />
  );
}

describe("SizeControl", () => {
  it("shows px unit next to the size value when the slider value is itself pixels", () => {
    renderJa(<SizeControl tool="pen" size={8} color="#ff0000" onChange={vi.fn()} />);
    expect(screen.getByText("px")).toBeInTheDocument();
    expect(screen.getByLabelText("太さの数値")).toHaveValue(8);
  });

  it("labels only the effective size as px for multiplier tools", () => {
    renderJa(<SizeControl tool="highlighter" size={4} color="#ffff00" onChange={vi.fn()} />);
    expect(screen.getByText("ハイライト")).toBeInTheDocument();
    // 4 は倍率であって px ではないので、px を名乗るのは実効サイズだけ
    expect(screen.getByText("32px")).toBeInTheDocument();
    expect(screen.queryByText("px")).not.toBeInTheDocument();
  });

  it("exposes the effective size to assistive tech via aria-valuetext", () => {
    renderJa(<SizeControl tool="highlighter" size={4} color="#ffff00" onChange={vi.fn()} />);
    expect(screen.getByLabelText("ハイライト")).toHaveAttribute("aria-valuetext", "32px");
  });

  it("shows a live size preview while dragging the slider and hides it on release", async () => {
    const user = userEvent.setup();
    renderJa(<SizeControl tool="pen" size={8} color="#ff3b30" onChange={vi.fn()} />);
    const slider = screen.getByLabelText("太さ");

    await user.pointer({ keys: "[MouseLeft>]", target: slider });
    expect(screen.getByText("8px")).toBeInTheDocument();

    await user.pointer({ keys: "[/MouseLeft]" });
    expect(screen.queryByText("8px")).not.toBeInTheDocument();
  });

  it("keeps the preview open while the numeric field has focus", async () => {
    const user = userEvent.setup();
    renderJa(<SizeControl tool="pen" size={8} color="#ff3b30" onChange={vi.fn()} />);

    // クリックは pointerup を伴う。数値入力にフォーカスした場合はそれで閉じてはいけない
    await user.click(screen.getByLabelText("太さの数値"));
    expect(screen.getByText("8px")).toBeInTheDocument();
  });

  // userEvent は内部でタイマーを使うので、フェイクタイマー下では fireEvent を使う
  it("auto-hides the preview after keyboard adjustment", () => {
    vi.useFakeTimers();
    try {
      renderJa(<StatefulSizeControl initial={8} onChange={vi.fn()} />);
      const slider = screen.getByLabelText("太さ");

      // keydown の直後に change も飛ぶ。change 側が自動クローズを潰してはいけない
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      fireEvent.change(slider, { target: { value: "9" } });
      expect(screen.getByText("9px")).toBeInTheDocument();

      act(() => void vi.advanceTimersByTime(1500));
      expect(screen.queryByText("9px")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the preview open when dragging the slider straight from the numeric field", () => {
    renderJa(<SizeControl tool="pen" size={8} color="#ff3b30" onChange={vi.fn()} />);
    const field = screen.getByLabelText("太さの数値");

    fireEvent.focus(field);
    // 数値入力 → スライダーへ直行すると、pointerdown の後に blur が届く
    fireEvent.pointerDown(screen.getByLabelText("太さ"));
    fireEvent.blur(field);

    expect(screen.getByText("8px")).toBeInTheDocument();
  });

  it("clamps numeric input to the brush size range", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderJa(<StatefulSizeControl initial={8} onChange={onChange} />);

    const input = screen.getByLabelText("太さの数値");
    await user.clear(input);
    await user.type(input, "99");

    expect(onChange).toHaveBeenLastCalledWith(40);
    expect(input).toHaveValue(40);
  });
});
