import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  Select,
} from "./ui.tsx";

afterEach(() => {
  cleanup();
});

describe("shadcn-style local primitives", () => {
  it("renders dashboard shell primitives with stable component classes", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>Forecast Model</SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <Card>
            <CardHeader>
              <CardTitle>Revenue</CardTitle>
            </CardHeader>
            <CardContent>$12.4M</CardContent>
          </Card>
        </SidebarInset>
      </SidebarProvider>,
    );

    expect(screen.getByText("Workspace").className).toContain("sidebar-group-label");
    expect(screen.getByRole("button", { name: /forecast model/i }).className).toContain(
      "sidebar-menu-button",
    );
    expect(screen.getByText("Revenue").className).toContain("card-title");
    expect(screen.getByText("$12.4M").className).toContain("card-content");
  });

  it("renders Select with shadcn-style trigger, content, and selectable items", async () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Primary scenario" value="base" onChange={onChange}>
        <option value="base">Base Case</option>
        <option value="growth">Aggressive Growth</option>
      </Select>,
    );

    const trigger = screen.getByRole("combobox", { name: /primary scenario/i });
    expect(trigger.className).toContain("select-trigger");
    expect(document.querySelector('[data-slot="select-content"]')).toBeNull();

    await userEvent.click(trigger);

    expect(screen.getByRole("listbox").className).toContain("select-content");
    expect(screen.getByRole("option", { name: /base case/i }).className).toContain("select-item");

    await userEvent.click(screen.getByRole("option", { name: /aggressive growth/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].target.value).toBe("growth");
    expect(document.querySelector('[data-slot="select-content"]')).toBeNull();
  });
});
