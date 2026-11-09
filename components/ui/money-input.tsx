"use client"

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react"

import { normalizeNumber, parseNumberInput, positionAfter, significantBefore } from "@/lib/number-input"

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type">

/**
 * An amount / price / rate field that is typed like the reference's: "85 000 000" (spaces between the
 * thousands, also when pasted), "1 234.5" (comma or point; at most `decimals` decimals). A text field, so the
 * browser never refuses the spaces as a number field does. `value` is the field's text (any spelling: "85000000"
 * shows as "85 000 000"); `onValueChange` gets the normalized text, which parseAmount / parseNumberInput read.
 * The caret stays where it was typed although spaces come and go.
 */
export const MoneyInput = forwardRef<HTMLInputElement, BaseProps & { value: string | number | null | undefined; onValueChange: (value: string) => void; decimals?: number }>(
  function MoneyInput({ value, onValueChange, decimals = 3, ...rest }, ref) {
    const inner = useRef<HTMLInputElement>(null)
    const caret = useRef<number | null>(null)
    useImperativeHandle(ref, () => inner.current as HTMLInputElement)
    const shown = normalizeNumber(value, decimals)

    useLayoutEffect(() => {
      const input = inner.current
      const wanted = caret.current
      caret.current = null
      if (!input || wanted === null || document.activeElement !== input) return
      const position = positionAfter(input.value, wanted)
      input.setSelectionRange(position, position)
    })

    return (
      <input
        autoComplete="off"
        {...rest}
        ref={inner}
        type="text"
        inputMode="decimal"
        value={shown}
        onChange={(event) => {
          const raw = event.target.value
          caret.current = significantBefore(raw, event.target.selectionStart ?? raw.length)
          onValueChange(normalizeNumber(raw, decimals))
        }}
      />
    )
  },
)

/**
 * MoneyInput for a value kept as a number: the typed text stays as typed ("1.", "0.0") while it reads as the same
 * number, and follows the number when it changes elsewhere. `onNumberChange` gets NaN for an empty field.
 */
export const MoneyNumberInput = forwardRef<HTMLInputElement, BaseProps & { value: number | null | undefined; onNumberChange: (value: number) => void; decimals?: number }>(
  function MoneyNumberInput({ value, onNumberChange, decimals = 3, ...rest }, ref) {
    const [text, setText] = useState(() => (value === null || value === undefined || Number.isNaN(value) ? "" : normalizeNumber(String(value), decimals)))
    useEffect(() => {
      const current = parseNumberInput(text)
      const next = value === null || value === undefined || Number.isNaN(value) ? NaN : value
      if (Number.isNaN(next) ? !Number.isNaN(current) : current !== next) setText(Number.isNaN(next) ? "" : normalizeNumber(String(next), decimals))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, decimals])
    return (
      <MoneyInput
        {...rest}
        ref={ref}
        decimals={decimals}
        value={text}
        onValueChange={(next) => {
          setText(next)
          onNumberChange(parseNumberInput(next))
        }}
      />
    )
  },
)
