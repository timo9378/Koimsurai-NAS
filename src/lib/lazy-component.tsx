import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

/**
 * `next/dynamic` 的等價替代（Vite / 純 SPA 版）。
 *
 * 直接換成 `React.lazy` 的話有兩個不相容處，會讓三個呼叫端都要改寫：
 *   1. `lazy` 要求模組的 **default** 匯出，而這裡載入的都是具名匯出
 *      （`.then(m => m.Terminal)`）。
 *   2. `next/dynamic` 的 `loading` 選項是內建的；`lazy` 得由呼叫端自己包 `<Suspense>`。
 *
 * 包成這支之後呼叫端寫法與原本幾乎一樣，遷移的 diff 只有 import 那行。
 * 原本的 `ssr: false` 不必對應 —— 這包已經沒有 SSR。
 */
export function lazyComponent<P extends object>(
  loader: () => Promise<ComponentType<P>>,
  loading?: ReactNode,
) {
  const Lazy = lazy(() => loader().then((Component) => ({ default: Component })));
  return function LazyComponent(props: P) {
    return (
      <Suspense fallback={loading ?? null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
