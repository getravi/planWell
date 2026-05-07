import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
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
} from "./ui.tsx";

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
});
