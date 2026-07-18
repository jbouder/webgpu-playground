import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Called with the caught error + component stack so it can feed the bus. */
  onCaught: (error: Error, componentStack: string) => void
}

/**
 * The "React error boundary feed" source. Catches render-time throws from its
 * subtree and pipes them into the event stream instead of white-screening the
 * page. The parent remounts this via a React `key` after each caught crash, so
 * the injected error is recoverable without a self-setState-on-update.
 */
export class ErrorBoundary extends Component<Props, { crashed: boolean }> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onCaught(error, info.componentStack ?? '')
  }

  render() {
    if (this.state.crashed) {
      return <div className="obs-boundary-caught">⚠️ Component crashed — caught by the error boundary.</div>
    }
    return this.props.children
  }
}
