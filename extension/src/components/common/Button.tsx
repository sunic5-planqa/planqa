import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'outline-pill'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  return <button className={`btn btn-${variant} ${className ?? ''}`.trim()} {...rest} />
}
