import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  SelectHTMLAttributes,
} from "react";
import { twMerge } from "tailwind-merge";
import { clsx } from "clsx";

export function cn(...values: Parameters<typeof clsx>): string {
  return twMerge(clsx(values));
}

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("btn", className)} data-slot="button" {...props} />;
}

export function GhostButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("btn ghost", className)} data-slot="button" {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("input", className)} data-slot="input" {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("input", className)} data-slot="select" {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("card", className)} data-slot="card" {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-header", className)} data-slot="card-header" {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("card-title", className)} data-slot="card-title" {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("card-description", className)} data-slot="card-description" {...props} />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-content", className)} data-slot="card-content" {...props} />;
}

export function Panel({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <Card className={cn("panel", className)}>{children}</Card>;
}

export function SidebarProvider({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <main className={cn("sidebar-provider", className)} data-slot="sidebar-provider" {...props} />
  );
}

export function Sidebar({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <aside className={cn("sidebar", className)} data-slot="sidebar" {...props} />;
}

export function SidebarHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sidebar-header", className)} data-slot="sidebar-header" {...props} />;
}

export function SidebarContent({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <nav className={cn("sidebar-content", className)} data-slot="sidebar-content" {...props} />
  );
}

export function SidebarGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sidebar-group", className)} data-slot="sidebar-group" {...props} />;
}

export function SidebarGroupLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("sidebar-group-label", className)}
      data-slot="sidebar-group-label"
      {...props}
    />
  );
}

export function SidebarGroupContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("sidebar-group-content", className)}
      data-slot="sidebar-group-content"
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("sidebar-menu", className)} data-slot="sidebar-menu" {...props} />;
}

export function SidebarMenuItem({ className, ...props }: HTMLAttributes<HTMLLIElement>) {
  return (
    <li className={cn("sidebar-menu-item", className)} data-slot="sidebar-menu-item" {...props} />
  );
}

export function SidebarMenuButton({
  className,
  isActive,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { isActive?: boolean }) {
  return (
    <button
      className={cn("sidebar-menu-button", isActive && "active", className)}
      data-active={isActive ? "true" : undefined}
      data-slot="sidebar-menu-button"
      {...props}
    />
  );
}

export function SidebarInset({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("sidebar-inset", className)} data-slot="sidebar-inset" {...props} />
  );
}

export function SiteHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={cn("site-header", className)} data-slot="site-header" {...props} />;
}

export function Label({ children }: PropsWithChildren) {
  return <span className="label">{children}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
