import { Check, ChevronDown, Download } from "lucide-react";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  type SelectHTMLAttributes,
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

type SelectOption = {
  depth: number;
  disabled: boolean;
  label: string;
  value: string;
};

type SelectPlacement = {
  align: "end" | "start";
  side: "bottom" | "top";
};

export type DataTableColumn<TData> = {
  cell: (row: TData) => ReactNode;
  className?: string;
  header: ReactNode;
  headerClassName?: string;
  id: string;
};

function textFromNode(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return textFromNode(child.props.children);
      }
      return "";
    })
    .join("");
}

function optionsFromChildren(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        "data-depth"?: number | string;
        disabled?: boolean;
        value?: string | number;
      }>(child)
    ) {
      return [];
    }
    const depth = Number(child.props["data-depth"] ?? 0);
    const label = textFromNode(child.props.children);
    return [
      {
        depth: Number.isFinite(depth) && depth > 0 ? depth : 0,
        disabled: Boolean(child.props.disabled),
        label,
        value: String(child.props.value ?? label),
      },
    ];
  });
}

export function Select({
  "aria-label": ariaLabel,
  children,
  className,
  defaultValue,
  disabled,
  id,
  name,
  onBlur,
  onChange,
  onFocus,
  required,
  value,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const contentId = `${selectId}-content`;
  const options = useMemo(() => optionsFromChildren(children), [children]);
  const isControlled = value !== undefined;
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(() =>
    String(defaultValue ?? value ?? options[0]?.value ?? ""),
  );
  const [placement, setPlacement] = useState<SelectPlacement>({ align: "start", side: "bottom" });
  const [triggerWidth, setTriggerWidth] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedValue = String(isControlled ? (value ?? "") : internalValue);
  const selectedOption =
    options.find((option) => option.value === selectedValue) ??
    options.find((option) => !option.disabled);

  useEffect(() => {
    if (!isControlled && !internalValue && selectedOption?.value) {
      setInternalValue(selectedOption.value);
    }
  }, [internalValue, isControlled, selectedOption?.value]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const positionContent = () => {
      const root = rootRef.current;
      const content = contentRef.current;
      if (!root || !content) {
        return;
      }

      const viewportGap = 8;
      const rootRect = root.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const contentWidth = rootRect.width;
      const spaceBelow = window.innerHeight - rootRect.bottom - viewportGap;
      const spaceAbove = rootRect.top - viewportGap;
      setTriggerWidth(rootRect.width);
      const nextPlacement: SelectPlacement = {
        align:
          rootRect.left + contentWidth > window.innerWidth - viewportGap &&
          rootRect.right - contentWidth >= viewportGap
            ? "end"
            : "start",
        side: spaceBelow < contentRect.height && spaceAbove > spaceBelow ? "top" : "bottom",
      };

      setPlacement((current) =>
        current.align === nextPlacement.align && current.side === nextPlacement.side
          ? current
          : nextPlacement,
      );
    };

    positionContent();
    window.addEventListener("resize", positionContent);
    window.addEventListener("scroll", positionContent, true);
    return () => {
      window.removeEventListener("resize", positionContent);
      window.removeEventListener("scroll", positionContent, true);
    };
  }, [open]);

  const selectOption = (nextValue: string) => {
    if (!isControlled) {
      setInternalValue(nextValue);
    }
    onChange?.({
      currentTarget: { value: nextValue },
      target: { value: nextValue },
    } as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };

  return (
    <div className={cn("select", className)} data-slot="select" ref={rootRef}>
      {name ? <input type="hidden" name={name} required={required} value={selectedValue} /> : null}
      <button
        aria-controls={contentId}
        aria-expanded={open}
        aria-label={ariaLabel}
        className="select-trigger"
        data-slot="select-trigger"
        disabled={disabled}
        id={selectId}
        onBlur={(event) => onBlur?.(event as unknown as FocusEvent<HTMLSelectElement>)}
        onClick={() => setOpen((current) => !current)}
        onFocus={(event) => onFocus?.(event as unknown as FocusEvent<HTMLSelectElement>)}
        role="combobox"
        type="button"
      >
        <span className="select-value" data-slot="select-value">
          {selectedOption?.label ?? "Select..."}
        </span>
        <ChevronDown className={open ? "select-chevron open" : "select-chevron"} size={16} />
      </button>
      {open ? (
        <div
          className="select-content"
          data-align={placement.align}
          data-side={placement.side}
          data-slot="select-content"
          id={contentId}
          ref={contentRef}
          role="listbox"
          style={
            triggerWidth
              ? ({ "--select-trigger-width": `${triggerWidth}px` } as CSSProperties)
              : undefined
          }
        >
          {options.map((option) => (
            <button
              aria-selected={option.value === selectedValue}
              className={option.value === selectedValue ? "select-item selected" : "select-item"}
              data-slot="select-item"
              data-value={option.value}
              data-depth={option.depth}
              disabled={option.disabled}
              key={option.value}
              onClick={() => selectOption(option.value)}
              role="option"
              style={
                option.depth
                  ? ({
                      "--select-option-padding-left": `${8 + option.depth * 16}px`,
                    } as CSSProperties)
                  : undefined
              }
              type="button"
            >
              <Check
                className={option.value === selectedValue ? "select-check visible" : "select-check"}
                size={14}
              />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DataTable<TData>({
  ariaLabel,
  className,
  columns,
  data,
  emptyMessage = "No results.",
  getRowId,
  rowLabel,
  toolbar,
}: {
  ariaLabel: string;
  className?: string;
  columns: DataTableColumn<TData>[];
  data: TData[];
  emptyMessage?: string;
  getRowId: (row: TData) => string;
  rowLabel?: (row: TData) => string;
  toolbar?: ReactNode;
}) {
  return (
    <div className={cn("data-table", className)} data-slot="data-table">
      <div className="data-table-toolbar" data-slot="data-table-toolbar">
        {toolbar}
      </div>
      <div className="data-table-container" data-slot="data-table-container">
        <table aria-label={ariaLabel} className="data-table-grid" data-slot="table">
          <thead className="data-table-header" data-slot="table-header">
            <tr className="data-table-row" data-slot="table-row">
              {columns.map((column) => (
                <th
                  className={column.headerClassName}
                  data-slot="table-head"
                  key={column.id}
                  scope="col"
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="data-table-body" data-slot="table-body">
            {data.length > 0 ? (
              data.map((row) => (
                <tr
                  aria-label={rowLabel?.(row)}
                  className="data-table-row"
                  data-slot="table-row"
                  key={getRowId(row)}
                >
                  {columns.map((column) => (
                    <td className={column.className} data-slot="table-cell" key={column.id}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr className="data-table-row" data-slot="table-row">
                <td className="data-table-empty" colSpan={columns.length} data-slot="table-cell">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="data-table-footer" data-slot="data-table-footer">
        {data.length} row(s)
      </div>
    </div>
  );
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

export function ExportMenu({
  onCsv,
  onXlsx,
  onPdf,
}: {
  onCsv: () => void;
  onXlsx: () => void;
  onPdf: () => void;
}) {
  return (
    <details className="export-menu">
      <summary className="btn ghost-btn export-menu-trigger">
        <Download size={13} />
        Export
        <ChevronDown size={12} className="export-menu-chevron" />
      </summary>
      <div className="export-menu-popup">
        <button className="export-menu-item" onClick={onCsv}>
          CSV
        </button>
        <button className="export-menu-item" onClick={onXlsx}>
          Excel
        </button>
        <button className="export-menu-item" onClick={onPdf}>
          PDF
        </button>
      </div>
    </details>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
