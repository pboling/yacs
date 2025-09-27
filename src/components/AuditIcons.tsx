import {
  CheckCircle2,
  XCircle,
  CircleHelp,
  ShieldCheck,
  Snowflake,
  Lock,
  Flame,
  Bug,
} from 'lucide-react'
import React from 'react'

export interface AuditFlags {
  verified?: boolean
  freezable?: boolean
  renounced?: boolean
  locked?: boolean
  burned?: boolean
  honeypot?: boolean
}

function IconWrap({
  children,
  title,
  color,
}: {
  children: React.ReactNode
  title: string
  color: string
}) {
  return (
    <span
      title={title}
      aria-label={title}
      style={{ display: 'inline-flex', alignItems: 'center', color }}
    >
      {children}
    </span>
  )
}

function BoolIcon({
  value,
  label,
  trueIcon,
  falseIcon,
}: {
  value: boolean | undefined
  label: string
  trueIcon: React.ReactNode
  falseIcon: React.ReactNode
}) {
  // Use theme-driven colors: up/down from CSS variables, muted for unknown
  const color = value == null ? 'var(--muted)' : value ? 'var(--accent-up)' : 'var(--accent-down)'
  const title = `${label}: ${value == null ? 'unknown' : value ? 'yes' : 'no'}`
  if (value == null)
    return (
      <IconWrap title={title} color={color}>
        <CircleHelp size={16} />
      </IconWrap>
    )
  return (
    <IconWrap title={title} color={color}>
      {value ? trueIcon : falseIcon}
    </IconWrap>
  )
}

export default function AuditIcons({ flags }: { flags: AuditFlags }) {
  const size = 16
  return (
    <div
      className="audit-icons"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, auto)',
        columnGap: 8,
        rowGap: 4,
        alignItems: 'center',
      }}
    >
      <BoolIcon
        value={flags.verified}
        label="Verified"
        trueIcon={<ShieldCheck size={size} />}
        falseIcon={<XCircle size={size} />}
      />
      <BoolIcon
        value={flags.freezable}
        label="Freezable"
        trueIcon={<Snowflake size={size} />}
        falseIcon={<CheckCircle2 size={size} />}
      />
      <BoolIcon
        value={flags.renounced}
        label="Renounced"
        trueIcon={<CheckCircle2 size={size} />}
        falseIcon={<XCircle size={size} />}
      />
      <BoolIcon
        value={flags.locked}
        label="Liquidity Locked"
        trueIcon={<Lock size={size} />}
        falseIcon={<XCircle size={size} />}
      />
      <BoolIcon
        value={flags.burned}
        label="Burned"
        trueIcon={<Flame size={size} />}
        falseIcon={<XCircle size={size} />}
      />
      <BoolIcon
        value={flags.honeypot == null ? undefined : !flags.honeypot}
        label="Not Honeypot"
        trueIcon={<CheckCircle2 size={size} />}
        falseIcon={<Bug size={size} />}
      />
    </div>
  )
}
