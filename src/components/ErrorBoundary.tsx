import React from 'react'

interface Props {
  fallback?: React.ReactNode
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error?: unknown
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, error: err }
  }
  componentDidCatch(error: unknown, errorInfo: unknown) {
    try {
      console.error('ErrorBoundary caught', error, errorInfo)
    } catch {
      /* no-op */
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="status error">Something went wrong loading this section.</div>
        )
      )
    }
    return this.props.children
  }
}
