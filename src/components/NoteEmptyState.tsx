import { FileText, PanelLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

export function NoteEmptyState({
  loading,
  sidebarCollapsed,
  onExpandSidebar,
}: {
  loading: boolean;
  sidebarCollapsed: boolean;
  onExpandSidebar(): void;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="relative flex flex-1 min-h-0 items-center justify-center px-6"
      aria-label={t("main.editor.noSelectionTitle")}
    >
      {sidebarCollapsed && (
        <button
          className="absolute top-2 left-4 w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm cursor-pointer"
          onClick={onExpandSidebar}
          aria-label={t("main.window.expandSidebar")}
          title={t("main.window.expandSidebar")}
        >
          <PanelLeft size={14} />
        </button>
      )}
      <div className="text-center max-w-sm pb-10" role={loading ? "status" : undefined}>
        <FileText
          size={32}
          strokeWidth={1.2}
          className="mx-auto mb-4 text-ink-ghost/40"
          aria-hidden="true"
        />
        <h1 className="text-[16px] font-medium text-ink-faint">
          {t(loading ? "main.editor.loadingNotes" : "main.editor.noSelectionTitle")}
        </h1>
        {!loading && (
          <p className="mt-2 text-[12px] leading-relaxed text-ink-ghost">
            {t("main.editor.noSelectionDescription")}
          </p>
        )}
      </div>
    </section>
  );
}
