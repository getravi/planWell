import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
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
  vi.restoreAllMocks();
});

describe("shadcn-style local primitives", () => {
  const rect = (values: {
    bottom: number;
    height: number;
    left: number;
    right: number;
    top: number;
    width: number;
    x: number;
    y: number;
  }) =>
    ({
      ...values,
      toJSON: () => ({}),
    }) as DOMRect;

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

  it("positions Select content inside the visible viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.getAttribute("data-slot") === "select") {
          return rect({
            bottom: 756,
            height: 36,
            left: 900,
            right: 1040,
            top: 720,
            width: 140,
            x: 900,
            y: 720,
          });
        }
        if (this.getAttribute("data-slot") === "select-content") {
          return rect({
            bottom: 0,
            height: 220,
            left: 0,
            right: 0,
            top: 0,
            width: 260,
            x: 0,
            y: 0,
          });
        }
        return rect({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 });
      },
    );

    render(
      <Select aria-label="Primary scenario" value="base">
        <option value="base">Base Case</option>
        <option value="growth">Aggressive Growth</option>
      </Select>,
    );

    await userEvent.click(screen.getByRole("combobox", { name: /primary scenario/i }));

    await waitFor(() => {
      expect(screen.getByRole("listbox").getAttribute("data-align")).toBe("end");
      expect(screen.getByRole("listbox").getAttribute("data-side")).toBe("top");
      expect(screen.getByRole("listbox").style.getPropertyValue("--select-trigger-width")).toBe(
        "140px",
      );
    });
  });

  it("renders DataTable with shadcn dashboard table slots", () => {
    render(
      <DataTable
        ariaLabel="Versions"
        columns={[
          { id: "name", header: "Version", cell: (row) => row.name },
          { id: "kind", header: "Type", cell: (row) => row.kind },
        ]}
        data={[
          { id: "actuals", name: "Actuals", kind: "Actuals" },
          { id: "base", name: "Base Case", kind: "Scenario" },
        ]}
        getRowId={(row) => row.id}
        rowLabel={(row) => row.name}
      />,
    );

    expect(screen.getByRole("table", { name: /versions/i }).className).toContain("data-table-grid");
    expect(document.querySelector('[data-slot="data-table-toolbar"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="data-table-container"]')).toBeTruthy();
    expect(screen.getByRole("row", { name: /actuals/i }).className).toContain("data-table-row");
    expect(screen.getByText("2 row(s)")).toBeTruthy();
  });
});
