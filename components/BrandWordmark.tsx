type BrandWordmarkProps = {
  dark?: boolean
  compact?: boolean
  className?: string
}

export default function BrandWordmark({ dark = false, compact = false, className = '' }: BrandWordmarkProps) {
  return (
    <span
      aria-label="Good Trivia Company"
      className={`inline-flex items-baseline whitespace-nowrap font-extrabold tracking-tight ${className}`}
      style={{ color: dark ? '#F4F1FF' : '#18171F' }}
    >
      <span style={{ color: '#7C3AED' }}>Good</span>
      <span>&nbsp;Trivia</span>
      <span
        className="ml-1.5 uppercase"
        style={{
          color: dark ? '#A9A4BF' : '#77738C',
          fontSize: compact ? '0.54em' : '0.48em',
          letterSpacing: '0.13em',
        }}
      >
        Company
      </span>
    </span>
  )
}
