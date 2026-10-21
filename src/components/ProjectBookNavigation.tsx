import { BookOpen, Folder } from "lucide-react";

export function ProjectBookNavigation({
  projectsOpen,
  booksOpen,
  onProjects,
  onBooks,
}: {
  projectsOpen: boolean;
  booksOpen: boolean;
  onProjects: () => void;
  onBooks: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 mb-1">
      {[
        { label: "项目", kind: "projects", icon: Folder, active: projectsOpen, action: onProjects },
        { label: "书籍", kind: "books", icon: BookOpen, active: booksOpen, action: onBooks },
      ].map((item) => (
        <button
          key={item.label}
          data-navigation-kind={item.kind}
          aria-pressed={item.active}
          onClick={item.action}
          className="sidebar-type-entry min-w-0 flex items-center justify-start gap-2 px-3 h-8 rounded-lg border text-left text-[12px] cursor-pointer"
        >
          <item.icon size={14} strokeWidth={1.5} className="shrink-0" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
