import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

type Option = { value: string; children: ReactNode; disabled?: boolean };

// Keep option declarations beside their driver capability checks at the call site.
export function Select({
  value,
  children,
  disabled,
  onValueChange,
  "aria-label": label,
}: {
  value: string | number;
  children: ReactNode;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  "aria-label": string;
}) {
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => {
      const props = child.props as Option;
      return { ...props, value: String(props.value) };
    });
  const selected = options.findIndex((option) => option.value === String(value));
  const [open, setOpen] = useState(false);
  const [portal, setPortal] = useState<Element | null>(null);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const id = useId();
  const enabled = options
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((index) => index >= 0);
  const show = () => {
    if (trigger.current?.matches(":disabled") || !enabled.length) return;
    setActive(selected >= 0 && !options[selected]?.disabled ? selected : enabled[0]!);
    search.current = { text: "", time: 0 };
    setPortal(trigger.current?.closest(".app-shell") ?? document.body);
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled || trigger.current?.matches(":disabled")) return;
    onValueChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.parentElement!.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const height = Math.min(280, Math.max(below, above), options.length * 34 + 8);
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: below >= height ? rect.bottom + 4 : Math.max(8, rect.top - height - 4),
      width,
      maxHeight: height,
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.parentElement?.contains(event.target as Node)
      )
        close();
    };
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  useEffect(() => {
    if (!open) return;
    const closeIfDisabled = () => {
      if (trigger.current?.matches(":disabled")) setOpen(false);
    };
    closeIfDisabled();
    const observer = new MutationObserver(closeIfDisabled);
    const fieldset = trigger.current?.closest("fieldset");
    if (fieldset) observer.observe(fieldset, { attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, [open, disabled]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="select-trigger min-w-0 truncate text-left"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        title={
          typeof options[selected]?.children === "string" ? options[selected].children : undefined
        }
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (event.key === "Tab") {
            setOpen(false);
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            if (!open) {
              show();
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              choose(active);
              return;
            }
            const at = enabled.indexOf(active);
            setActive(
              event.key === "Home"
                ? enabled[0]!
                : event.key === "End"
                  ? enabled.at(-1)!
                  : enabled[
                      Math.max(
                        0,
                        Math.min(enabled.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)),
                      )
                    ]!,
            );
          } else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.nativeEvent.isComposing
          ) {
            const now = Date.now();
            search.current.text =
              (now - search.current.time > 700 ? "" : search.current.text) +
              event.key.toLocaleLowerCase();
            search.current.time = now;
            const text = (node: ReactNode): string =>
              Children.toArray(node)
                .map((part) =>
                  isValidElement(part)
                    ? text((part.props as { children: ReactNode }).children)
                    : typeof part === "string" || typeof part === "number"
                      ? String(part)
                      : "",
                )
                .join("");
            const match = enabled.find((index) =>
              text(options[index]!.children).toLocaleLowerCase().startsWith(search.current.text),
            );
            if (match !== undefined) {
              if (open) setActive(match);
              else onValueChange(options[match]!.value);
            }
          }
        }}
      >
        {options[selected]?.children ?? (String(value) || "—")}
      </button>
      {open &&
        portal &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="listbox"
            aria-label={label}
            className="select-menu fixed z-[200] overflow-y-auto p-1"
            style={position}
            onPointerDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === selected}
                aria-disabled={option.disabled || undefined}
                data-active={index === active}
                className="select-option flex min-h-8 items-center gap-2 px-2 py-1.5 text-xs"
                onPointerMove={() => {
                  if (!option.disabled) setActive(index);
                }}
                onClick={() => choose(index)}
              >
                <span className="min-w-0 flex-1 break-words">{option.children}</span>
                {index === selected && <Check size={14} className="shrink-0" aria-hidden="true" />}
              </div>
            ))}
          </div>,
          portal,
        )}
    </>
  );
}
