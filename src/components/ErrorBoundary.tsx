import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // In production, send to error tracking service (Sentry, etc.)
    // Example: Sentry.captureException(error, { extra: errorInfo });
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          className="surface-card mx-auto max-w-md rounded-3xl p-8 text-center"
          role="alert"
          aria-live="assertive"
        >
          <div className="text-5xl mb-4">😰</div>
          <h2 className="font-display text-xl font-black text-primary-token mb-2">
            حدث خطأ غير متوقع
          </h2>
          <p className="text-secondary-token mb-6">
            نعتذر، حدث خطأ في التطبيق. يرجى تحديث الصفحة والمحاولة مرة أخرى.
          </p>
          <details className="text-right mb-4">
            <summary className="font-display text-sm font-bold text-accent-token cursor-pointer">
              تفاصيل الخطأ (للمطورين)
            </summary>
            <pre className="mt-2 text-[11px] text-left bg-black/5 p-3 rounded overflow-auto">
              {this.state.error?.message}
              {this.state.error?.stack}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            className="btn-token btn-primary-token"
          >
            🔄 تحديث الصفحة
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}