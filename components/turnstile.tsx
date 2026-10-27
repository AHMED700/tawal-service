'use client';
import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
type Widget = {
  render: (node: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Widget;
  }
}
export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const node = useRef<HTMLDivElement>(null),
    widget = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const render = useCallback(() => {
    if (
      !node.current ||
      !window.turnstile ||
      !sitekey ||
      widget.current !== null
    )
      return;
    widget.current = window.turnstile.render(node.current, {
      sitekey,
      action: 'school_ticket',
      language: 'ar',
      callback: onToken,
      'expired-callback': () => onToken(''),
      'error-callback': () => {
        onToken('');
        setFailed(true);
      },
    });
  }, [sitekey, onToken]);
  useEffect(() => {
    render();
    return () => {
      if (widget.current !== null) {
        window.turnstile?.remove(widget.current);
        widget.current = null;
      }
    };
  }, [render]);
  if (!sitekey)
    return (
      <p role="status">
        استقبال البلاغات غير متاح مؤقتاً حتى اكتمال إعداد الحماية.
      </p>
    );
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={render}
        onError={() => setFailed(true)}
      />
      <div ref={node} />
      {failed && (
        <p role="alert">
          تعذر تحميل التحقق الأمني. تحقق من الاتصال ثم أعد تحميل الصفحة.
        </p>
      )}
    </>
  );
}
