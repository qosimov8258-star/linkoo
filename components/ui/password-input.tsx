"use client"

import { Eye, EyeOff } from "lucide-react"
import { useState, type ComponentProps } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import { cn } from "@/lib/utils"

type PasswordInputProps = Omit<ComponentProps<"input">, "type"> & {
  /** Classes of the wrapper that holds the field and the eye (its position and size in the form). */
  wrapperClassName?: string
  /** Classes of the eye button (its size and colour). */
  toggleClassName?: string
}

/**
 * A password field with an eye button on its right that shows or hides what was typed. The text is hidden again
 * whenever the field is shown anew. The wrapper is a <span>, so the field can stay inside its <label>; the button
 * comes after the input, so the label still names the input, and clicking the eye keeps the caret in the field.
 */
export function PasswordInput({ className, wrapperClassName, toggleClassName, disabled, ...props }: PasswordInputProps) {
  const { t } = useLanguage()
  const [visible, setVisible] = useState(false)
  const label = t(visible ? "Скрыть пароль" : "Показать пароль")
  const Icon = visible ? EyeOff : Eye
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <input {...props} disabled={disabled} type={visible ? "text" : "password"} className={cn(className, "pr-10")} />
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        // Keeps the focus (and the on-screen keyboard) in the field.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((current) => !current)}
        className={cn(
          "absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[#667085] outline-none hover:text-[#1D2939] focus-visible:text-[#1E4A9A] disabled:cursor-not-allowed disabled:opacity-60",
          toggleClassName,
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    </span>
  )
}
