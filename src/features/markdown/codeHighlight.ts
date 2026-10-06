interface Highlighter {
  getLanguage(name: string): unknown;
  highlight(
    text: string,
    options: { language: string; ignoreIllegals: boolean },
  ): { value: string };
}
let loading: Promise<Highlighter> | undefined;
export function highlightCode(text: string, language: string): Promise<string> {
  const runtime = window as unknown as { hljs?: Highlighter };
  if (!loading)
    loading = new Promise((resolve, reject) => {
      if (runtime.hljs) {
        resolve(runtime.hljs);
        return;
      }
      const script = document.createElement("script");
      script.src = "/editor/dist/js/highlight.js/highlight.min.js";
      script.onload = () =>
        runtime.hljs ? resolve(runtime.hljs) : reject(new Error("代码高亮加载失败"));
      script.onerror = () => {
        loading = undefined;
        reject(new Error("代码高亮加载失败"));
      };
      document.head.appendChild(script);
    });
  return loading.then(
    (engine) =>
      engine.highlight(text, {
        language: engine.getLanguage(language) ? language : "plaintext",
        ignoreIllegals: true,
      }).value,
  );
}
