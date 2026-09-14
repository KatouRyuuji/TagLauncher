import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsField, SettingsToggle } from "./SettingsField";

describe("设置控件", () => {
  it("单输入与复合控件的标题准确关联输入", async () => {
    render(<><SettingsField label="地址"><input /></SettingsField>
      <SettingsField label="密钥" htmlFor="key"><div><input id="key" /><button>显示</button></div></SettingsField></>);
    await userEvent.click(screen.getByText("地址"));
    expect(screen.getByRole("textbox", { name: "地址", exact: true })).toHaveFocus();
    await userEvent.click(screen.getByText("密钥"));
    expect(screen.getByRole("textbox", { name: "密钥", exact: true })).toHaveFocus();
  });
  it("开关可由键盘切换，名称与说明独立朗读", async () => {
    function Demo() {
      const [checked, setChecked] = useState(false);
      return <SettingsToggle checked={checked} onChange={setChecked} title="自动备份" description="每次启动时检查。" />;
    }
    render(<Demo />);
    const control = screen.getByRole("switch", { name: "自动备份", exact: true });
    control.focus();
    await userEvent.keyboard(" ");
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control).toHaveAccessibleDescription("每次启动时检查。");
  });
});
