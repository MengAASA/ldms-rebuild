"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { pageZoom } from "@/lib/zoom";

export type SelectOption = {
  value: string;
  label: string;
  /** Secondary text on the right, e.g. a staff no. or department. Also searched. */
  hint?: string;
  /** Options with the same group are listed under one heading, in first-seen order. */
  group?: string;
  disabled?: boolean;
};

type Props = {
  /** Submitted with the form through a hidden input. */
  name: string;
  options: SelectOption[];
  /** Controlled value. Use with onChange. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Show a search box. Defaults to on for lists longer than 8, and always on with allowNew. */
  searchable?: boolean;
  /**
   * Lets the user give a value that isn't in the list: what they type in the
   * search box, turned into the value it will be saved as (e.g. tidied and in
   * capitals), is offered as `Add "…"` when no option has that value.
   */
  allowNew?: (typed: string) => string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

const SEARCH_THRESHOLD = 8;
const MAX_PANEL_WIDTH = 440;

/**
 * LDMS dropdown. Keyboard: Enter/Space/↓ opens, ↑↓ Home End move, Enter picks,
 * Esc closes, typing searches (long lists) or jumps to a match (short lists).
 */
export function Select({
  name,
  options,
  value,
  defaultValue = "",
  onChange,
  placeholder = "Choose…",
  searchable,
  allowNew,
  disabled,
  id,
  className = "",
  ...aria
}: Props) {
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const listId = `${autoId}-list`;
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  // A value given with allowNew is not among the options: it is shown as it is.
  const selected = options.find((o) => o.value === current) ?? (allowNew && current ? { value: current, label: current } : undefined);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // In page pixels (screen pixels ÷ the page zoom; see pageZoom).
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; minWidth: number; maxWidth: number; maxHeight: number } | null>(null);

  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const withSearch = !!allowNew || (searchable ?? options.length > SEARCH_THRESHOLD);

  const visible = useMemo(() => {
    const q = query.trim().replace(/\s+/g, " ").toLowerCase();
    if (!q) return options;
    const found = options.filter((o) => `${o.label} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase().includes(q));
    const typed = allowNew?.(query) ?? "";
    // What was typed, as a new value, after the matches: picking an existing one stays the easy choice.
    return typed && !options.some((o) => o.value === typed) ? [...found, { value: typed, label: `Add "${typed}"` }] : found;
  }, [options, query, allowNew]);

  const choose = useCallback(
    (o: SelectOption) => {
      if (o.disabled) return;
      if (!controlled) setInner(o.value);
      if (o.value !== current) onChange?.(o.value);
      setOpen(false);
      trigger.current?.focus();
    },
    [controlled, current, onChange],
  );

  function openList(initialQuery = "") {
    if (disabled) return;
    setQuery(initialQuery);
    const idx = options.findIndex((o) => o.value === current);
    setActive(initialQuery ? 0 : Math.max(0, idx));
    setOpen(true);
  }

  // Place the panel under the trigger, or above it when there is no room.
  // Fixed positioning keeps it clear of scrolling containers and dialogs.
  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    // Worked out in screen pixels (page sizes × zoom), then set in page pixels.
    const z = pageZoom();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 220 * z && above > below;
    // At least as wide as the trigger; wider when an option needs it, up to
    // MAX_PANEL_WIDTH and the screen. Options longer than that wrap.
    const maxWidth = Math.min(Math.max(r.width, MAX_PANEL_WIDTH * z), window.innerWidth - 16);
    const minWidth = Math.min(Math.max(r.width, 220 * z), maxWidth);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - minWidth - 8));
    setPos({
      left: left / z,
      ...(up ? { bottom: (window.innerHeight - r.top + 4) / z } : { top: (r.bottom + 4) / z }),
      minWidth: minWidth / z,
      maxWidth: maxWidth / z,
      maxHeight: Math.min(320 * z, up ? above : below) / z,
    });
  }, []);

  // Once the panel has its real width, pull it left if it would run off the screen.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !pos || !el) return;
    const z = pageZoom();
    const overflow = (el.getBoundingClientRect().right - (window.innerWidth - 8)) / z;
    if (overflow > 0) el.style.left = `${Math.max(8 / z, pos.left - overflow)}px`;
  }, [open, pos]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    if (withSearch) search.current?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, withSearch]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function move(delta: number) {
    if (!visible.length) return;
    let i = active;
    for (let step = 0; step < visible.length; step++) {
      i = (i + delta + visible.length) % visible.length;
      if (!visible[i].disabled) break;
    }
    setActive(i);
  }

  function onListKey(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Home":
        if (!withSearch) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (!withSearch) {
          e.preventDefault();
          setActive(visible.length - 1);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (visible[active]) choose(visible[active]);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // don't also close a surrounding dialog
        setOpen(false);
        trigger.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (!withSearch && e.key.length === 1) jumpTo(e.key);
    }
  }

  // Short lists: typing jumps to the first option starting with what was typed.
  function jumpTo(ch: string) {
    const now = Date.now();
    const t = typeahead.current;
    t.text = now - t.at < 600 ? t.text + ch.toLowerCase() : ch.toLowerCase();
    t.at = now;
    const i = visible.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(t.text));
    if (i >= 0) setActive(i);
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    // Keys typed quickly after opening arrive here before the search box has
    // focus; add them to the search instead of losing them.
    if (open && withSearch && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === "Backspace")) {
      e.preventDefault();
      setQuery((q) => (e.key === "Backspace" ? q.slice(0, -1) : q + e.key));
      setActive(0);
      search.current?.focus();
      return;
    }
    if (open) return onListKey(e);
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openList();
    } else if (withSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openList(e.key);
    }
  }

  return (
    <div className={`relative ${className}`}>
      <input type="hidden" name={name} value={current} />
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && !withSearch && visible[active] ? `${listId}-${active}` : undefined}
        aria-invalid={aria["aria-invalid"]}
        aria-describedby={aria["aria-describedby"]}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onTriggerKey}
        className={`select flex items-center gap-2 text-left ${open ? "border-accent shadow-[0_0_0_3px_var(--color-accent-soft)]" : ""} disabled:cursor-not-allowed`}
        style={{ backgroundImage: "none" }}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-ink-3"}`}>{selected ? selected.label : placeholder}</span>
        {selected?.hint && <span className="hidden shrink-0 truncate text-xs text-ink-3 sm:inline">{selected.hint}</span>}
        <ChevronDown size={15} aria-hidden className={`shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && pos && (
        <div
          ref={panel}
          className="fixed z-[60] flex flex-col overflow-hidden rounded-[10px] border border-rule bg-surface shadow-[var(--shadow-float)]"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: "max-content", minWidth: pos.minWidth, maxWidth: pos.maxWidth, maxHeight: pos.maxHeight }}
          onKeyDown={withSearch ? onListKey : undefined}
        >
          {withSearch && (
            <div className="flex items-center gap-2 border-b border-rule px-3 focus-within:border-accent">
              <Search size={14} aria-hidden className="shrink-0 text-ink-3" />
              <input
                ref={search}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
                aria-label="Search options"
                placeholder="Type to search"
                // Inline, because the global :focus-visible outline outranks the utility class, and the
                // panel would crop it at the top. The line under the search box shows focus instead.
                style={{ outline: "none" }}
                className="h-9 w-full bg-transparent text-[13.5px] placeholder:text-ink-3"
              />
            </div>
          )}
          <ul id={listId} role="listbox" aria-labelledby={triggerId} className="overflow-y-auto py-1">
            {visible.map((o, i) => {
              const heading = o.group && o.group !== visible[i - 1]?.group ? o.group : null;
              const isSelected = o.value === current;
              return (
                <li key={`${o.group ?? ""}:${o.value}`} role="presentation">
                  {heading && (
                    <div role="presentation" className="px-3 pt-2.5 pb-1 text-2xs font-semibold tracking-[0.08em] text-ink-3 uppercase">
                      {heading}
                    </div>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={o.disabled || undefined}
                    // Only real pointer movement highlights; a list opened from the keyboard
                    // under a resting pointer keeps the current option highlighted.
                    onMouseMove={() => active !== i && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    className={`mx-1 flex cursor-pointer items-start gap-2 rounded-md py-1.5 pr-2.5 pl-2 text-[13.5px] ${
                      o.disabled ? "cursor-not-allowed opacity-45" : i === active ? "bg-sunken" : ""
                    } ${isSelected ? "font-medium text-accent" : "text-ink"}`}
                  >
                    <Check size={14} aria-hidden className={`mt-[3px] shrink-0 ${isSelected ? "text-accent" : "invisible"}`} />
                    {/* Wrap rather than cut off, so every option can be read in full. */}
                    <span className="min-w-0 flex-1 break-words">{o.label}</span>
                    {o.hint && <span className="mt-px shrink-0 text-xs font-normal text-ink-3">{o.hint}</span>}
                  </div>
                </li>
              );
            })}
            {visible.length === 0 && <li className="px-3 py-3 text-[13px] text-ink-3">No match for &ldquo;{query}&rdquo;</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
